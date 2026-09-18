/**
 * `commitlore commit` — consider, then commit, in one call.
 *
 * The five-step flow (`prepare` → draft → `verify` → `stage` → `git commit`)
 * works and is not the problem. The problem is that it runs only when the agent
 * remembers all five, and measured on this repository's own history that is
 * 204 of 249 substantive commits. The remaining 18% is not a capability gap; it
 * is a product that requires five things to be remembered in order.
 *
 * So this is one call. What it does not do is decide whether there is anything
 * to record: `records: []` is a complete, first-class answer, and the flow
 * having *run* is the only thing anything downstream is allowed to require. An
 * agent that must produce a record will produce one, and a false record is
 * permanent — which is why nothing here, and nothing in the gate this feeds,
 * ever asks for a non-empty result.
 *
 * **It composes no commit message.** The records reach the commit through the
 * installed `prepare-commit-msg` hook, exactly as they do when a person runs
 * `git commit` after `stage_capture`. Building a second application path here
 * would mean two places that know how a record becomes a trailer block, and the
 * first divergence between them would be silent — a record applied one way in
 * one route and another way in the other.
 *
 * **All or nothing.** A draft with any refused record commits nothing and binds
 * nothing. A caller whose quotes were wrong gets told which, and has two legal
 * moves: fix them, or say `records: []`. Committing the survivors would make
 * the refusal invisible at exactly the moment it matters.
 */

import { execFileSync } from 'node:child_process';

import type { Command } from 'commander';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clearConsideration, writeConsideration } from '../core/commit-consideration.js';
import { execGit, execGitOrThrow } from '../core/git.js';
import { PREPARE_COMMIT_MSG_HOOK_NAME } from '../hooks/prepare-commit-msg.js';
import { runCapture } from './capture.js';

export type CommitOutcome =
  /** Committed, and every verified record is in the message. */
  | 'recorded'
  /** Committed with nothing to record. A complete answer, not a failure. */
  | 'empty'
  /** A record did not verify. Nothing committed, nothing bound. */
  | 'refused'
  /** Verified and bound; the caller asked to run `git commit` itself. */
  | 'staged'
  /** Git refused the commit — a hook of the user's own, or a bad message. */
  | 'commit_failed'
  /** Committed, and the records are not in the message that landed. */
  | 'stripped'
  /** Nothing was attempted: not a repository, nothing staged, no hook. */
  | 'error';

export interface CommitResult {
  outcome: CommitOutcome;
  /** The commit that was created, when one was. */
  commit: string | null;
  /** How many records the commit carries. */
  records: number;
  /** Everything refused, with the reason the verifier gave. */
  rejected: readonly { index: number; rule: string; detail?: string }[];
  /** One line per thing the caller needs to know, in the order it matters. */
  lines: readonly string[];
}

export interface CommitOptions {
  cwd: string;
  message: string;
  /** The session transcript. Not required when the caller records nothing. */
  transcript?: string;
  transcriptPath?: string;
  /** The draft, as bytes or a path. Absent means "nothing to record". */
  draft?: string;
  draftPath?: string;
  amend?: boolean;
  /** `git commit -a`: stage tracked changes first. */
  all?: boolean;
  /** False verifies and binds without committing, for a caller that wants git's own flags. */
  commit?: boolean;
  now?: Date;
}

const result = (
  outcome: CommitOutcome,
  lines: readonly string[],
  over: Partial<CommitResult> = {},
): CommitResult => ({ outcome, commit: null, records: 0, rejected: [], lines, ...over });

/** Whether this repository's `prepare-commit-msg` hook is ours, so records can land. */
const recordsCanBeApplied = (cwd: string): boolean => {
  const resolved = execGit(['rev-parse', '--git-path', `hooks/${PREPARE_COMMIT_MSG_HOOK_NAME}`], { cwd });
  if (resolved.code !== 0) return false;
  const path = join(cwd, resolved.stdout.trim());
  if (!existsSync(path)) return false;
  try {
    return readFileSync(path, 'utf8').includes('commitlore');
  } catch {
    return false;
  }
};

const somethingIsStaged = (cwd: string): boolean =>
  execGitOrThrow(['diff', '--cached', '--name-only'], { cwd }).trim() !== '';

const headMessage = (cwd: string): string => {
  const shown = execGit(['log', '-1', '--format=%B'], { cwd });
  return shown.code === 0 ? shown.stdout : '';
};

/**
 * Whether a commit message carries a record.
 *
 * Asked of the message that landed rather than of the transaction that was
 * staged, because those are the same thing only until something else rewrites
 * it — and a caller told "recorded" about a commit carrying nothing is the
 * silence this product exists to remove.
 *
 * Exported because the branch it feeds cannot be reached through the hooks this
 * product installs: the chained `prepare-commit-msg` runs *before* ours, so
 * nothing in the supported layout writes after we do. It is insurance against a
 * layout somebody else builds, and this is the seam that lets the decision be
 * tested without one.
 */
export const recordLanded = (message: string): boolean => /^Record-Id:/m.test(message);

/**
 * Runs `git commit` the way the user would, with their hooks.
 *
 * Never `--no-verify`: the hook that applies the records is the same hook that
 * flag skips, so bypassing it would drop exactly what this call exists to
 * carry. A failing hook of the user's own is reported with what it said.
 */
const runGitCommit = (cwd: string, message: string, amend: boolean): { ok: boolean; stderr: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-commit-'));
  const messagePath = join(dir, 'COMMIT_MSG');
  try {
    writeFileSync(messagePath, message.endsWith('\n') ? message : `${message}\n`);
    execFileSync('git', ['commit', ...(amend ? ['--amend'] : []), '-F', messagePath], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stderr: '' };
  } catch (error) {
    const spawned = error as { stderr?: string | Buffer; stdout?: string | Buffer };
    const said = `${String(spawned.stderr ?? '')}${String(spawned.stdout ?? '')}`.trim();
    return { ok: false, stderr: said };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const runCommit = (opts: CommitOptions): CommitResult => {
  const { cwd } = opts;
  const commitIt = opts.commit !== false;

  if (execGit(['rev-parse', '--show-toplevel'], { cwd }).code !== 0) {
    return result('error', ['not inside a git repository']);
  }

  if (opts.all === true) {
    const staged = execGit(['add', '-u'], { cwd });
    if (staged.code !== 0) return result('error', [`git add -u failed: ${staged.stderr.trim()}`]);
  }

  // An amend with nothing staged is a message-only amend, which is legitimate.
  if (!somethingIsStaged(cwd) && opts.amend !== true) {
    return result('error', [
      'nothing is staged, so there is no change to record or commit',
      'stage what this commit should carry, or pass --all for tracked changes',
    ]);
  }

  const hasDraft = opts.draft !== undefined || opts.draftPath !== undefined;
  const hasTranscript = opts.transcript !== undefined || opts.transcriptPath !== undefined;

  if (hasDraft && !hasTranscript) {
    return result('error', [
      'records were given with no transcript to verify them against',
      'every record is checked against the session it came from; without one there is nothing to check',
    ]);
  }

  if (!commitIt && !recordsCanBeApplied(cwd)) {
    return result('error', [
      `this repository has no commitlore ${PREPARE_COMMIT_MSG_HOOK_NAME} hook, so a staged record would never reach a commit`,
      'run commitlore hooks install, or let this command make the commit itself',
    ]);
  }

  // Nothing to record: no transaction, no verification, no pending file. The
  // consideration is the whole of what this branch produces, and that is the
  // point -- "considered, nothing found" has to be as cheap as it is common.
  if (!hasDraft) {
    writeConsideration({
      cwd,
      outcome: 'empty',
      records: 0,
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });
    if (!commitIt) {
      return result('staged', ['considered, nothing to record — run git commit when ready']);
    }
    const committed = runGitCommit(cwd, opts.message, opts.amend === true);
    if (!committed.ok) {
      clearConsideration(cwd);
      return result('commit_failed', ['git refused the commit', committed.stderr]);
    }
    return result('empty', ['committed with nothing recorded — a complete answer, not a gap'], {
      commit: execGitOrThrow(['rev-parse', 'HEAD'], { cwd }).trim(),
    });
  }

  const capture = runCapture({
    cwd,
    ...(opts.transcript === undefined ? {} : { transcript: opts.transcript }),
    ...(opts.transcriptPath === undefined ? {} : { transcriptPath: opts.transcriptPath }),
    ...(opts.draft === undefined ? {} : { draft: opts.draft }),
    ...(opts.draftPath === undefined ? {} : { draftPath: opts.draftPath }),
  });

  const rejected = capture.rejected ?? [];

  /*
   * All or nothing, and the refusal is reported rather than routed around. The
   * two legal next moves are named because a caller that is only told "refused"
   * reliably tries the same draft again.
   */
  if (rejected.length > 0 || capture.outcome === 'rejected') {
    return result(
      'refused',
      [
        `${String(rejected.length)} record(s) did not verify, so nothing was committed and nothing was bound`,
        'correct the quotes against the transcript, or commit with no records — both are normal',
      ],
      { rejected },
    );
  }

  if (capture.outcome !== 'staged') {
    // A draft that parsed to nothing is the same statement as passing none.
    writeConsideration({
      cwd,
      outcome: 'empty',
      records: 0,
      ...(opts.now === undefined ? {} : { now: opts.now }),
    });
    if (!commitIt) return result('staged', ['the draft held no records — run git commit when ready']);
    const committed = runGitCommit(cwd, opts.message, opts.amend === true);
    if (!committed.ok) {
      clearConsideration(cwd);
      return result('commit_failed', ['git refused the commit', committed.stderr]);
    }
    return result('empty', ['committed with nothing recorded — the draft held no records'], {
      commit: execGitOrThrow(['rev-parse', 'HEAD'], { cwd }).trim(),
    });
  }

  if (!recordsCanBeApplied(cwd)) {
    return result('error', [
      `a record is staged, and this repository has no commitlore ${PREPARE_COMMIT_MSG_HOOK_NAME} hook to apply it`,
      'run commitlore hooks install, then commit again',
    ]);
  }

  writeConsideration({
    cwd,
    outcome: 'recorded',
    records: 1,
    ...(opts.now === undefined ? {} : { now: opts.now }),
  });

  if (!commitIt) {
    return result('staged', [
      'verified and staged — run git commit, and the hook will apply the record',
    ], { records: 1 });
  }

  const committed = runGitCommit(cwd, opts.message, opts.amend === true);
  if (!committed.ok) {
    // The binding goes with the attempt that failed. Leaving it would let the
    // next commit inherit a consideration made for a commit that never happened.
    clearConsideration(cwd);
    return result('commit_failed', ['git refused the commit', committed.stderr]);
  }

  const head = execGitOrThrow(['rev-parse', 'HEAD'], { cwd }).trim();
  const landed = headMessage(cwd);

  /*
   * Asked of the commit that exists, not of the transaction that was staged. A
   * `prepare-commit-msg` of the user's own, running after ours, can rewrite the
   * message — and the caller would otherwise be told "recorded" about a commit
   * carrying nothing.
   */
  if (!recordLanded(landed)) {
    return result('stripped', [
      'the commit was created and carries no record — something rewrote the message after ours',
      'commitlore doctor reports which hooks run here',
    ], { commit: head });
  }

  return result('recorded', ['committed with its record'], { commit: head, records: 1 });
};

const exitCodeFor = (outcome: CommitOutcome): 0 | 1 | 2 | 3 => {
  switch (outcome) {
    case 'recorded':
    case 'empty':
    case 'staged':
      return 0;
    // A refusal and a failed commit are both "ran, and something needs you".
    // Neither is a usage error and neither is the tool breaking.
    case 'refused':
    case 'commit_failed':
    case 'stripped':
      return 1;
    case 'error':
      return 2;
  }
};

export const register = (program: Command): void => {
  program
    .command('commit')
    .description('consider this change and commit it in one call; recording nothing is a complete answer')
    .requiredOption('-m, --message <message>', 'the commit message, subject and body')
    .option('--transcript <path>', 'the session transcript the records are checked against')
    .option('--records <path>', 'a draft JSON file; omit it to commit with nothing recorded')
    .option('--none', 'state that there is nothing to record (the same as omitting --records)')
    .option('--amend', 'amend the previous commit rather than making a new one')
    .option('-a, --all', 'stage tracked changes first, the way git commit -a does')
    .option('--no-commit', 'verify and bind without committing, and run git commit yourself')
    .option('--json', 'emit the result as JSON')
    .addHelpText(
      'after',
      '\nOne call in place of prepare -> draft -> verify -> stage -> git commit. It composes no ' +
        'message of its own: the records reach the commit through the installed prepare-commit-msg ' +
        'hook, the same way they do when you stage a capture and commit by hand.' +
        '\n\nRecording nothing is normal and expected. Most commits carry nothing a diff cannot show, ' +
        'and `commitlore commit -m "..."` with no --records is the complete answer for them -- not a ' +
        'shortfall, and nothing downstream asks for more.' +
        '\n\nAll or nothing: if any record fails verification the commit does not happen and nothing ' +
        'is bound, because committing the survivors would hide the refusal at the moment it matters. ' +
        'Correct the quotes against the transcript, or commit with no records.' +
        '\n\nExit codes: 0 committed (with or without a record) or bound; 1 a record was refused, git ' +
        'refused the commit, or the message that landed carries no record; 2 nothing could be ' +
        'attempted -- not a repository, nothing staged, or no hook to apply a record.',
    )
    .action((options: {
      message: string;
      transcript?: string;
      records?: string;
      none?: boolean;
      amend?: boolean;
      all?: boolean;
      commit?: boolean;
      json?: boolean;
    }) => {
      const outcome = runCommit({
        cwd: process.cwd(),
        message: options.message,
        ...(options.transcript === undefined ? {} : { transcriptPath: options.transcript }),
        ...(options.none === true || options.records === undefined ? {} : { draftPath: options.records }),
        ...(options.amend === true ? { amend: true } : {}),
        ...(options.all === true ? { all: true } : {}),
        ...(options.commit === false ? { commit: false } : {}),
      });

      if (options.json === true) {
        process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
      } else {
        const stream = exitCodeFor(outcome.outcome) === 0 ? process.stdout : process.stderr;
        for (const line of outcome.lines) stream.write(`commitlore commit: ${line}\n`);
        for (const refusal of outcome.rejected) {
          stream.write(`  record ${String(refusal.index)}: ${refusal.rule}${refusal.detail === undefined ? '' : ` -- ${refusal.detail}`}\n`);
        }
      }
      process.exitCode = exitCodeFor(outcome.outcome);
    });
};
