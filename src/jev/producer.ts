/**
 * The optional commit producer — #1048, ADR #1045 D1/D2/D5/D6.
 *
 * One function: `produce`. It is reached only from the internal commit-msg
 * dispatcher, only with an enabled activation, and it adds a *producer* — never
 * a second verifier. Every judgement about whether a record may exist is made by
 * native code that was already there: `prepareCaptureContext`,
 * `verifyCaptureRecords`, `stageCaptureRecord` and `runValidate`.
 *
 * ## The order, and why each step is where it is
 *
 * 1. **Eligibility, before any I/O that costs anything.** Policy, message,
 *    staged change, operation form, foreign hook. A commit that is not eligible
 *    must reach native validation having read no transcript and opened no socket.
 * 2. **Snapshot.** cwd, worktree, gitdir, HEAD, the inherited effective index,
 *    diff, tree, policy hash, the original message bytes, the source window.
 * 3. **One bounded request, outside every native pending lock.** Nothing is
 *    written yet, so a timeout costs the commit its latency and nothing else.
 * 4. **Recheck.** Anything that moved means skip. Never retry: a retry inside a
 *    commit hook is a second chance bought with the user's commit latency.
 * 5. **Native prepare, then compare its bindings against the snapshot.** The
 *    comparison is the point — checking immediately *before* prepare leaves the
 *    window between the check and prepare's own reads, which is exactly the race
 *    the ADR calls out.
 * 6. **Native verify** against that same canonical source and diff. Only an
 *    accepted result with *this* call's receipt may go on.
 * 7. **Compose into a private temporary file and run the real validator on it,
 *    before the real message is touched.** A candidate that does not validate is
 *    discarded whole; the original is never edited and then repaired.
 * 8. **Final recheck, stage with the owned receipt, then publish atomically.**
 *    The bytes published are byte-for-byte the bytes that validated.
 *
 * ## What it will not do
 *
 * It never turns a native failure into a success — `runValidate`'s result for
 * the bytes that are actually in the file is what comes back, on every path. It
 * never appends to a message a foreign hook already approved. It never stages
 * user code, resets, commits, pushes, or unsets `GIT_INDEX_FILE`. It never
 * retries, repairs, or asks again. And it cleans up only the one pending
 * transaction it created, by nonce, because deleting pending files by pattern is
 * deleting somebody else's capture.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolvePolicy } from '../core/capture-policy.js';
import { prepareCaptureContext } from '../core/capture-prepare.js';
import { verifyCaptureRecords } from '../core/capture-verify.js';
import { stageCaptureRecord } from '../core/capture-stage.js';
import { execGit } from '../core/git.js';
import { deletePending, listPendingNonces, markApplied, readPending } from '../core/pending.js';
import { parseRecordBlocks } from '../core/trailers.js';
import { KNOWN_KEYS, type Trailer } from '../core/types.js';
import { CHAINED_HOOK_NAME } from '../hooks/commit-msg.js';
import { composeWithTrailerBlock, pendingTrailerBlock } from '../hooks/prepare-commit-msg.js';
import { runValidate, type ValidateResult } from '../commands/validate.js';
import type { JevEnabled } from './activation.js';
import { askJev, describeOutcome, type JevOutcome } from './client.js';
import { assembleDrafts, describeDiscovery, planDiscovery, type ChangeContext } from './discover.js';
import { readClaudeSource, sourceStillCurrent } from './source-claude.js';
import { describeSource, type ConversationSource } from './source.js';

const RECORD_KEYS = new Set<string>(KNOWN_KEYS);

/** Bounded diff context for relevance. A diff is never a reason (#1047). */
const DIFF_EXCERPT_BYTES = 4 * 1024;
const MAX_CHANGED_PATHS = 24;

/**
 * Why the producer did not run, or ran and produced nothing.
 *
 * Closed, and `skipped` is deliberately never collapsed into "nothing useful
 * found": a commit form this prototype does not support has not been assessed,
 * and reporting it as assessed would be the false-negative the PRD forbids.
 */
export type SkipCause =
  | 'policy-not-auto'
  | 'not-unattended'
  | 'message-empty'
  | 'message-has-record'
  | 'competing-capture'
  | 'foreign-chained-hook'
  | 'no-staged-change'
  | 'unsupported-operation'
  | 'alternate-index'
  | 'unborn-head'
  | 'source-unavailable'
  | 'no-candidates'
  | 'provider-unavailable'
  | 'no-draft'
  | 'source-moved'
  | 'binding-moved'
  | 'verify-refused'
  | 'candidate-invalid'
  | 'stage-refused'
  | 'publish-failed';

export interface ProduceOutcome {
  /** True only when the real message file now holds the validated candidate. */
  readonly published: boolean;
  readonly cause?: SkipCause;
  /** Lines for the optional diagnostic. Never source text, never a key. */
  readonly notes: readonly string[];
  /** The nonce this invocation owned, when it created one. */
  readonly nonce?: string;
  /** Present when a request was dispatched, for the usage report. */
  readonly outcome?: JevOutcome;
}

export interface ProduceInput {
  readonly messageFile: string;
  readonly cwd: string;
  readonly activation: JevEnabled;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Injected by tests so a real request is never needed to exercise a branch. */
  readonly ask?: typeof askJev;
}

const skip = (cause: SkipCause, notes: readonly string[] = []): ProduceOutcome => ({
  published: false,
  cause,
  notes,
});

const gitValue = (cwd: string, args: readonly string[]): string | null => {
  const result = execGit([...args], { cwd });
  if (result.code !== 0) return null;
  const value = result.stdout.trim();
  return value === '' ? null : value;
};

/**
 * Whether the message says anything.
 *
 * Comments and scissors content are dropped the way git drops them, because an
 * "empty" commit message is empty *after* git is done with it. A producer that
 * treated a template full of `#` lines as substantive would turn a cancelled
 * commit into a successful one carrying an automatic record — which is the
 * outcome #1048 forbids by name.
 */
const substantive = (message: string): boolean => {
  for (const raw of message.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (/^#\s{0,8}-{3,}\s{0,8}>8\s{0,8}-{3,}/.test(line)) break;
    if (line.startsWith('#')) continue;
    if (line.trim() !== '') return true;
  }
  return false;
};

const hasRecordBlock = (message: string): boolean =>
  parseRecordBlocks(message).some((block: readonly Trailer[]) =>
    block.some((trailer) => RECORD_KEYS.has(trailer.key)),
  );

/**
 * An operation this prototype does not assess.
 *
 * The amend marker is **read, never consumed**. `runValidate` consumes it, and
 * it is the only signal that tells an amend from an ordinary commit — taking it
 * here would leave native validation unable to apply its own duplicate rule to
 * the amend it is about to check.
 *
 * ## What that signal does and does not cover, measured
 *
 * `prepare-commit-msg` writes the marker only when git hands it `commit HEAD`,
 * which is the editor-driven amend. With `-m` or `-F`, an amend is
 * byte-for-byte indistinguishable from an ordinary commit at both hook points:
 * git passes `[.git/COMMIT_EDITMSG] [message] []` for both, the hook
 * environment is the same seven `GIT_*` variables, and `GIT_REFLOG_ACTION` is
 * unset in each. So no marker is written and this check cannot fire.
 *
 * That blind spot is native's, not a new one — `r-amendmarker638` recorded it —
 * and it is deliberately not worked around here. The candidates that were
 * considered and rejected: comparing `GIT_AUTHOR_DATE` against HEAD's author
 * date (an ordinary commit made in the same second as HEAD false-positives, and
 * `--reset-author` false-negatives), and inferring the operation from the diff
 * shape (an amend that adds a hunk looks like an ordinary commit). A guess
 * whose false negative is the hazard is worse than a named limit.
 */
const IN_PROGRESS_MARKERS = [
  'rebase-merge',
  'rebase-apply',
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'BISECT_LOG',
  'sequencer',
  'commitlore-amend',
] as const;

const operationInProgress = (cwd: string): string | null => {
  for (const name of IN_PROGRESS_MARKERS) {
    const located = gitValue(cwd, ['rev-parse', '--git-path', name]);
    if (located === null) continue;
    if (existsSync(resolve(cwd, located))) return name;
  }
  return null;
};

/**
 * True when git handed this hook an index that is not the worktree's own.
 *
 * `--git-path index` honours `GIT_INDEX_FILE` and would merely echo the
 * temporary path; the repository git-dir does not, and its `index` is the
 * persistent one. A path-limited commit is the ordinary way to reach this, and a
 * record bound to a full index must not attach to it.
 */
const usesAlternateIndex = (cwd: string): boolean => {
  const current = process.env['GIT_INDEX_FILE'];
  if (current === undefined || current === '') return false;
  const gitDir = gitValue(cwd, ['rev-parse', '--git-dir']);
  if (gitDir === null) return false;
  return resolve(cwd, current) !== resolve(cwd, gitDir, 'index');
};

/**
 * A foreign `commit-msg` hook in the chain.
 *
 * Derived from the resolved hooks directory — `--git-path hooks` honours
 * `core.hooksPath`, so a repository that moved its hooks is answered correctly
 * rather than by a guessed `.git/hooks`. Only the execute bit matters: git runs
 * an executable hook, so an un-executable one was already inert.
 *
 * Its presence is a skip and not a reorder. It checked the original message and
 * approved it; appending text it never saw would make its approval a statement
 * about different bytes. Running it a second time is worse — a hook with a side
 * effect would perform it twice.
 */
const foreignChainedHook = (cwd: string): boolean => {
  const hooksDir = gitValue(cwd, ['rev-parse', '--git-path', 'hooks']);
  if (hooksDir === null) return false;
  const path = resolve(cwd, hooksDir, CHAINED_HOOK_NAME);
  try {
    const stats = statSync(path);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
};

/**
 * Native captures that are not ours and could still land.
 *
 * `applyCaptureRecord` in `prepare-commit-msg` has already run by the time a
 * `commit-msg` hook exists, so an eligible native capture has normally already
 * appended itself and is caught by `hasRecordBlock`. This covers the rest: a
 * capture verified or staged but not yet applied, and — read again at step 8 —
 * one that arrived while the request was in flight.
 *
 * On a competing capture the optional candidate is abandoned. It is not ranked,
 * not merged, and not preferred: inventing a priority rule between an authored
 * capture and an automatic one is a decision the ADR reserves.
 */
const competingCaptures = (cwd: string, own: string | null): number => {
  const listed = listPendingNonces(cwd);
  if (listed.state !== 'ready') return 0;
  let count = 0;
  for (const nonce of listed.nonces) {
    if (nonce === own) continue;
    const pending = readPending(nonce, { cwd });
    if (pending === null) continue;
    if (pending.consumed) continue;
    if (pending.phase === 'verified' || pending.phase === 'staged' || pending.phase === 'applied') {
      count += 1;
    }
  }
  return count;
};

interface Snapshot {
  readonly worktree: string;
  readonly gitdir: string;
  readonly head: string;
  readonly diff: string;
  readonly diffHash: string;
  readonly tree: string;
  readonly policyHash: string;
  readonly message: string;
  readonly changedPaths: readonly string[];
}

const takeSnapshot = (cwd: string, message: string): Snapshot | null => {
  const worktree = gitValue(cwd, ['rev-parse', '--show-toplevel']);
  const gitdir = gitValue(cwd, ['rev-parse', '--absolute-git-dir']);
  const head = gitValue(cwd, ['rev-parse', 'HEAD']);
  if (worktree === null || gitdir === null || head === null) return null;

  // `--cached` with no pathspec, and `GIT_INDEX_FILE` deliberately left exactly
  // as git set it: the inherited effective index is the index this commit is
  // being made from, and substituting the repository's own would bind a record
  // to a tree that is not being committed.
  const diffResult = execGit(['diff', '--cached'], { cwd });
  if (diffResult.code !== 0) return null;
  const diff = diffResult.stdout;

  const tree = gitValue(cwd, ['write-tree']);
  if (tree === null) return null;

  const names = execGit(['diff', '--cached', '--name-only'], { cwd });
  const changedPaths =
    names.code === 0
      ? names.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '').slice(0, MAX_CHANGED_PATHS)
      : [];

  return {
    worktree: resolve(worktree),
    gitdir: resolve(gitdir),
    head,
    diff,
    diffHash: createHash('sha256').update(diff).digest('hex'),
    tree,
    policyHash: resolvePolicy(cwd).identityHash,
    message,
    changedPaths,
  };
};

/** True when nothing the transaction binds to has moved. */
const snapshotIntact = (cwd: string, before: Snapshot, messageFile: string): boolean => {
  const after = takeSnapshot(cwd, before.message);
  if (after === null) return false;
  if (after.head !== before.head) return false;
  if (after.diffHash !== before.diffHash) return false;
  if (after.tree !== before.tree) return false;
  if (after.policyHash !== before.policyHash) return false;
  if (after.worktree !== before.worktree || after.gitdir !== before.gitdir) return false;
  try {
    return readFileSync(messageFile, 'utf8') === before.message;
  } catch {
    return false;
  }
};

const diffExcerpt = (diff: string): string => {
  const buffer = Buffer.from(diff, 'utf8');
  if (buffer.byteLength <= DIFF_EXCERPT_BYTES) return diff;
  // Cut at a line boundary from the end: the tail of `git diff --cached` is the
  // most recently staged hunk, and a half line invites a quote from a fragment.
  const tail = buffer.subarray(buffer.byteLength - DIFF_EXCERPT_BYTES).toString('utf8');
  const at = tail.indexOf('\n');
  return at === -1 ? tail : tail.slice(at + 1);
};

/**
 * Writes bytes through a temporary file in the same directory, then renames.
 *
 * The original survives until the rename succeeds. A partial write into the
 * message file git is about to read is a corrupted commit message, and a crash
 * between truncate and write would leave one.
 */
const publishAtomic = (path: string, bytes: string): boolean => {
  const temporary = `${path}.commitlore-jev-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(temporary, bytes, 'utf8');
    renameSync(temporary, path);
    return true;
  } catch {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Already gone, or never created.
    }
    return false;
  }
};

/** Retires only this invocation's pending transaction, by nonce. */
const retireOwn = (cwd: string, nonce: string): void => {
  try {
    deletePending(nonce, { cwd });
  } catch {
    // A pending file that cannot be removed is a file the existing expiry and
    // `capture gc` already own. It must not become a reason to report failure
    // on a commit whose validation succeeded.
  }
};

/**
 * The producer.
 *
 * Returns `published: false` for every outcome except the one where the real
 * message file now holds bytes that `runValidate` accepted. The caller runs
 * native validation on whatever is in the file afterwards — which is the same
 * call on both paths, and the reason a failure here cannot become a success.
 */
export const produce = async (input: ProduceInput): Promise<ProduceOutcome> => {
  const { cwd, messageFile } = input;
  const notes: string[] = [];

  // ---- 1. Eligibility, before any optional I/O ---------------------------
  const policy = resolvePolicy(cwd);
  if (policy.policy.mode !== 'auto') return skip('policy-not-auto');
  if (!policy.policy.unattended) return skip('not-unattended');

  let message: string;
  try {
    message = readFileSync(messageFile, 'utf8');
  } catch {
    return skip('message-empty');
  }
  if (!substantive(message)) return skip('message-empty');
  if (hasRecordBlock(message)) return skip('message-has-record');
  if (foreignChainedHook(cwd)) return skip('foreign-chained-hook');

  const inProgress = operationInProgress(cwd);
  if (inProgress !== null) {
    return skip(inProgress === 'commitlore-amend' ? 'unsupported-operation' : 'unsupported-operation', [
      `operation marker present: ${inProgress}`,
    ]);
  }
  if (usesAlternateIndex(cwd)) return skip('alternate-index');
  if (gitValue(cwd, ['rev-parse', 'HEAD']) === null) return skip('unborn-head');
  if (competingCaptures(cwd, null) > 0) return skip('competing-capture');

  const snapshot = takeSnapshot(cwd, message);
  if (snapshot === null) return skip('unsupported-operation');
  if (snapshot.diff.trim() === '') return skip('no-staged-change');

  // ---- 2. Source ---------------------------------------------------------
  const sourceResult = readClaudeSource({ cwd, env: input.env });
  notes.push(`source: ${describeSource(sourceResult)}`);
  if (sourceResult.status !== 'available') return skip('source-unavailable', notes);
  const source: ConversationSource = sourceResult.source;
  if (source.worktree !== snapshot.worktree || source.gitdir !== snapshot.gitdir) {
    return skip('source-unavailable', [...notes, 'source is bound to another working tree']);
  }

  const change: ChangeContext = {
    paths: snapshot.changedPaths,
    diffExcerpt: diffExcerpt(snapshot.diff),
  };
  const plan = planDiscovery(source, change);
  notes.push(
    `candidates: ${String(plan.coverage.candidatesAsked)} asked of ` +
      `${String(plan.coverage.candidatesEnumerated)} enumerated` +
      (plan.coverage.candidatesWithheld === 0
        ? ''
        : `, ${String(plan.coverage.candidatesWithheld)} withheld (${plan.coverage.withheldRules.join(', ')})`),
  );
  if (plan.questions.length === 0) return skip('no-candidates', notes);

  // ---- 3. One request, outside every native lock -------------------------
  const ask = input.ask ?? askJev;
  const outcome = await ask({
    key: input.activation.key,
    state: plan.state,
    questions: plan.questions,
  });
  notes.push(`jev: ${describeOutcome(outcome)}`);
  if (outcome.status !== 'answered') {
    return { published: false, cause: 'provider-unavailable', notes, outcome };
  }

  const discovered = assembleDrafts({ plan, outcome, recordCap: policy.policy.max_records_per_commit });
  notes.push(`discovery: ${describeDiscovery(discovered)}`);
  if (discovered.records.length === 0) {
    return { published: false, cause: 'no-draft', notes, outcome };
  }

  // ---- 4. Recheck --------------------------------------------------------
  if (!sourceStillCurrent(source)) {
    return { published: false, cause: 'source-moved', notes, outcome };
  }
  if (!snapshotIntact(cwd, snapshot, messageFile)) {
    return { published: false, cause: 'binding-moved', notes, outcome };
  }

  // ---- 5. Native prepare, then compare its bindings ----------------------
  let nonce: string;
  let prepared: ReturnType<typeof prepareCaptureContext>;
  try {
    prepared = prepareCaptureContext({ cwd, transcript: source.text, unattended: true });
    nonce = prepared.nonce;
  } catch (error) {
    return {
      published: false,
      cause: 'verify-refused',
      notes: [...notes, `prepare refused: ${error instanceof Error ? error.message : String(error)}`],
      outcome,
    };
  }

  // The comparison the ADR insists on. Checking just before `prepare` leaves the
  // window between that check and prepare's own reads; comparing what prepare
  // actually bound against the snapshot closes it, because these three values
  // *are* what the transaction binds to.
  if (
    prepared.base_head !== snapshot.head ||
    prepared.staged_diff_hash !== snapshot.diffHash ||
    prepared.staged_tree_oid !== snapshot.tree
  ) {
    retireOwn(cwd, nonce);
    return { published: false, cause: 'binding-moved', notes, outcome, nonce };
  }

  // ---- 6. Native verify --------------------------------------------------
  const verified = verifyCaptureRecords({
    nonce,
    draft: discovered.records.map((record) => ({
      trailers: [...record.trailers],
      evidence: [...record.evidence],
    })),
    transcript: source.text,
    diff: snapshot.diff,
    cwd,
  });
  const receipt = verified.receipt;
  if (
    verified.accepted.length === 0 ||
    verified.incomplete ||
    verified.source_mismatch !== undefined ||
    receipt === undefined
  ) {
    retireOwn(cwd, nonce);
    return {
      published: false,
      cause: 'verify-refused',
      notes: [
        ...notes,
        `verify: ${verified.validation_result}, ${String(verified.accepted.length)} accepted, ` +
          `${String(verified.rejected.length)} refused` +
          (verified.source_mismatch === undefined ? '' : `, source mismatch ${verified.source_mismatch}`),
      ],
      outcome,
      nonce,
    };
  }
  notes.push(`verify: ${String(verified.accepted.length)} accepted, ${String(verified.rejected.length)} refused`);

  // ---- 7. Compose and validate the candidate, real message untouched -----
  const stored = readPending(nonce, { cwd });
  if (stored === null) {
    retireOwn(cwd, nonce);
    return { published: false, cause: 'verify-refused', notes, outcome, nonce };
  }
  const trailerBlock = pendingTrailerBlock(stored.records);
  if (trailerBlock === '') {
    retireOwn(cwd, nonce);
    return { published: false, cause: 'verify-refused', notes, outcome, nonce };
  }
  const candidate = composeWithTrailerBlock(snapshot.message, trailerBlock);

  const scratchDir = gitValue(cwd, ['rev-parse', '--git-path', 'commitlore']);
  if (scratchDir === null) {
    retireOwn(cwd, nonce);
    return { published: false, cause: 'candidate-invalid', notes, outcome, nonce };
  }
  const scratch = resolve(cwd, scratchDir, `jev-candidate-${nonce}.txt`);
  let preview: ValidateResult;
  try {
    mkdirSync(resolve(scratch, '..'), { recursive: true });
    writeFileSync(scratch, candidate, 'utf8');
    // The real validator, on the real repository, against the candidate bytes.
    // Safe as a preview here only because amend and replay were excluded at
    // step 1: `runValidate` consumes the amend marker, and on those forms this
    // call would take a signal native validation still needs.
    preview = runValidate({ messageFile: scratch, cwd });
  } catch (error) {
    retireOwn(cwd, nonce);
    return {
      published: false,
      cause: 'candidate-invalid',
      notes: [...notes, `candidate preview failed: ${error instanceof Error ? error.message : String(error)}`],
      outcome,
      nonce,
    };
  } finally {
    try {
      rmSync(scratch, { force: true });
    } catch {
      // A leftover scratch file is inert: it is named by this nonce, is not a
      // pending transaction, and is never read again.
    }
  }

  if (preview.code !== 0 || preview.secrets.length > 0) {
    retireOwn(cwd, nonce);
    return {
      published: false,
      cause: 'candidate-invalid',
      notes: [
        ...notes,
        `candidate refused by validate: exit ${String(preview.code)}, ` +
          `${String(preview.violations.length)} violation(s), ${String(preview.secrets.length)} secret(s)`,
      ],
      outcome,
      nonce,
    };
  }

  // ---- 8. Final recheck, stage, publish ----------------------------------
  if (!snapshotIntact(cwd, snapshot, messageFile) || !sourceStillCurrent(source)) {
    retireOwn(cwd, nonce);
    return { published: false, cause: 'binding-moved', notes, outcome, nonce };
  }
  if (competingCaptures(cwd, nonce) > 0) {
    retireOwn(cwd, nonce);
    return { published: false, cause: 'competing-capture', notes, outcome, nonce };
  }

  let staged: string | null;
  try {
    staged = stageCaptureRecord({ nonce, cwd, receipt });
  } catch (error) {
    retireOwn(cwd, nonce);
    return {
      published: false,
      cause: 'stage-refused',
      notes: [...notes, `stage refused: ${error instanceof Error ? error.message : String(error)}`],
      outcome,
      nonce,
    };
  }
  if (staged !== nonce) {
    retireOwn(cwd, nonce);
    return { published: false, cause: 'stage-refused', notes, outcome, nonce };
  }

  if (!publishAtomic(messageFile, candidate)) {
    // The original is still in place: `publishAtomic` renames or does nothing.
    // The transaction stays staged rather than being deleted, because its
    // records are verified and the ordinary expiry owns them from here.
    return { published: false, cause: 'publish-failed', notes, outcome, nonce };
  }

  try {
    markApplied(nonce, createHash('sha256').update(trailerBlock).digest('hex'), { cwd });
  } catch {
    // Best effort, exactly as the native application treats it: the bytes are
    // already published, and `post-commit` reconciles from the commit itself.
  }

  notes.push('published: the validated candidate is the commit message');
  return { published: true, notes, outcome, nonce };
};
