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

import { spawnSync } from 'node:child_process';

import type { Command } from 'commander';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { clearConsideration, writeConsideration } from '../core/commit-consideration.js';
import { execGit, execGitOrThrow } from '../core/git.js';
import {
  PREPARE_COMMIT_MSG_HOOK_MARKER,
  PREPARE_COMMIT_MSG_HOOK_NAME,
} from '../hooks/prepare-commit-msg.js';
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
  /** Nothing was committed: not a repository, nothing staged, no hook, or the capture failed. */
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

/**
 * Whether this repository's `prepare-commit-msg` hook is ours *and will run*.
 *
 * `resolve`, not `join`: from a linked worktree `--git-path` answers with an
 * absolute path into the common directory, and joining that onto cwd produces
 * `<worktree>/<absolute path>` -- a path that never exists, so this reported
 * "no hook" in exactly the repositories that have one. Measured against a real
 * worktree. The installer resolves; this looked somewhere else.
 *
 * The marker rather than the word `commitlore`, because a foreign hook that
 * mentions us in a comment is not ours. The execute bit because git runs only
 * executable hooks, and one without it is installed and inert -- which reads
 * identically to installed and working from a file read alone.
 */
const recordsCanBeApplied = (cwd: string): boolean => {
  const reported = execGit(['rev-parse', '--git-path', `hooks/${PREPARE_COMMIT_MSG_HOOK_NAME}`], { cwd });
  if (reported.code !== 0) return false;
  const path = resolve(cwd, reported.stdout.trim());
  if (!existsSync(path)) return false;
  try {
    if (!readFileSync(path, 'utf8').includes(PREPARE_COMMIT_MSG_HOOK_MARKER)) return false;
    accessSync(path, constants.X_OK);
    return true;
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
const runGitCommit = (cwd: string, message: string, amend: boolean): { ok: boolean; said: string } => {
  const before = execGit(['rev-parse', 'HEAD'], { cwd }).stdout.trim();
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-commit-'));
  const messagePath = join(dir, 'COMMIT_MSG');
  try {
    writeFileSync(messagePath, message.endsWith('\n') ? message : `${message}\n`);
    const run = spawnSync('git', ['commit', ...(amend ? ['--amend'] : []), '-F', messagePath], {
      cwd,
      encoding: 'utf8',
      // The repository's own `execGit` uses 64 MiB, and the 1 MiB default is
      // reachable: a `post-commit` hook printing 2 MiB made a commit that had
      // already happened report as failed, with the binding cleared under it.
      maxBuffer: 1 << 26,
    });
    const said = `${run.stderr ?? ''}${run.stdout ?? ''}`.trim();
    const after = execGit(['rev-parse', 'HEAD'], { cwd }).stdout.trim();
    /*
     * Whether a commit happened, asked of HEAD rather than of an exit status.
     * The two agree until something *after* the commit fails -- a `post-commit`
     * hook, a buffer, a signal -- and then the status says "no commit" about a
     * commit that exists. That is the one answer that must never be wrong here,
     * because the caller's next move on a failure is to try again.
     */
    return { ok: after !== '' && after !== before, said };
  } catch (error) {
    return { ok: false, said: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * Commit, then report what actually landed.
 *
 * Every path goes through here, and every one reads the message that exists
 * rather than the transaction that was staged. The two agree until they do not:
 * a capture staged by the older five-step flow is applied by the same hook, so
 * a call carrying no records of its own would otherwise commit a record and
 * report `empty` -- a true commit described by a false result and a false
 * binding, which is the silence this product exists to remove.
 */
const commitAndReport = (cwd: string, opts: CommitOptions, staged: number): CommitResult => {
  const committed = runGitCommit(cwd, opts.message, opts.amend === true);
  if (!committed.ok) {
    // The binding belongs to the attempt that failed. Leaving it would let the
    // next commit inherit a consideration made for one that never happened.
    clearConsideration(cwd);
    return result('commit_failed', [
      'git did not create a commit',
      ...(committed.said === '' ? [] : [committed.said]),
    ]);
  }

  const head = execGitOrThrow(['rev-parse', 'HEAD'], { cwd }).trim();
  const landed = recordLanded(headMessage(cwd));

  if (staged > 0 && !landed) {
    return result(
      'stripped',
      [
        'the commit was created and carries no record, though one was staged for it',
        ...(committed.said === '' ? [] : [committed.said]),
        'commitlore doctor reports which hooks run here, and whether ours is one of them',
      ],
      { commit: head },
    );
  }
  if (landed) {
    return result(
      'recorded',
      [staged > 0 ? 'committed with its record' : 'committed, and it carries a record staged before this call'],
      { commit: head, records: 1 },
    );
  }
  return result('empty', ['committed with nothing recorded — a complete answer, not a gap'], {
    commit: head,
  });
};

export const runCommit = (opts: CommitOptions): CommitResult => {
  const { cwd } = opts;
  const commitIt = opts.commit !== false;

  if (execGit(['rev-parse', '--show-toplevel'], { cwd }).code !== 0) {
    return result('error', ['not inside a git repository']);
  }

  /*
   * `--all` has to stage before anything else, because the tree the records are
   * verified against is the tree that will be committed -- and with `-a` that
   * tree does not exist until something stages it.
   *
   * So this is *not* `git commit -a`, and the difference shows on a refusal:
   * `git commit -a` that fails leaves the index untouched, while this leaves
   * the tracked changes staged. That is stated in the help and in the refusal
   * rather than left for somebody to find in `git status`.
   */
  if (opts.all === true) {
    const staged = execGit(['add', '-u'], { cwd });
    if (staged.code !== 0) return result('error', [`git add -u failed: ${staged.stderr.trim()}`]);
  }
  const stagedByAll = opts.all === true;

  const hasDraft = opts.draft !== undefined || opts.draftPath !== undefined;
  const hasTranscript = opts.transcript !== undefined || opts.transcriptPath !== undefined;


  // An amend with nothing staged is a message-only amend, which is legitimate.
  if (!somethingIsStaged(cwd) && opts.amend !== true) {
    return result('error', [
      'nothing is staged, so there is no change to record or commit',
      'stage what this commit should carry, or pass --all for tracked changes',
    ]);
  }

  if (hasDraft && !hasTranscript) {
    return result('error', [
      'records were given with no transcript to verify them against',
      'every record is checked against the session it came from; without one there is nothing to check',
    ]);
  }

  /*
   * Only when there is a record for the hook to apply. A caller that is
   * recording nothing and wants to run the commit itself needs no hook at all,
   * and refusing it was refusing a correct call -- the same over-refusal this
   * whole feature exists to avoid, one layer in.
   */
  if (!commitIt && hasDraft && !recordsCanBeApplied(cwd)) {
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
    return commitAndReport(cwd, opts, 0);
  }

  const capture = runCapture({
    cwd,
    ...(opts.transcript === undefined ? {} : { transcript: opts.transcript }),
    ...(opts.transcriptPath === undefined ? {} : { transcriptPath: opts.transcriptPath }),
    ...(opts.draft === undefined ? {} : { draft: opts.draft }),
    ...(opts.draftPath === undefined ? {} : { draftPath: opts.draftPath }),
    allOrNothing: true,
    // The records describe the commit the amend produces, so their diff
    // evidence is checked against its parent rather than against HEAD (#1129).
    ...(opts.amend === true ? { amend: true } : {}),
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
        ...(stagedByAll
          ? ['--all already staged your tracked changes; they are still staged, unlike a failed git commit -a']
          : []),
      ],
      { rejected },
    );
  }

  /*
   * #1127. A capture that failed is not a draft that held nothing. Every
   * outcome but `staged` used to fall through to the branch below, so a draft
   * whose records all verified -- and then exceeded `max_records_per_commit` at
   * stage -- committed with none of them and called that a complete answer.
   */
  if (capture.outcome === 'usage' || capture.outcome === 'operational' || capture.outcome === 'internal') {
    return result('error', [
      'the capture failed, so nothing was committed and nothing was bound',
      ...(capture.error === undefined ? [] : [capture.error]),
      ...(stagedByAll
        ? ['--all already staged your tracked changes; they are still staged, unlike a failed git commit -a']
        : []),
    ]);
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
    return commitAndReport(cwd, opts, 0);
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

  return commitAndReport(cwd, opts, 1);
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
    .option('-a, --all', 'stage tracked changes first — unlike git commit -a, they stay staged if the commit is refused')
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
        'refused the commit, or the message that landed carries no record; 2 nothing was committed ' +
        'because nothing could be attempted -- not a repository, nothing staged, no hook to apply a ' +
        'record -- or because the capture itself failed, such as a draft holding more records than ' +
        'max_records_per_commit allows.',
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
      const attempt = (): CommitResult => runCommit({
        cwd: process.cwd(),
        message: options.message,
        ...(options.transcript === undefined ? {} : { transcriptPath: options.transcript }),
        ...(options.none === true || options.records === undefined ? {} : { draftPath: options.records }),
        ...(options.amend === true ? { amend: true } : {}),
        ...(options.all === true ? { all: true } : {}),
        ...(options.commit === false ? { commit: false } : {}),
      });

      /*
       * `runCommit` reaches git through helpers that throw, and a `--json`
       * caller that gets prose and exit 2 instead of an envelope has to parse
       * the failure it was promised it could read. Everything becomes an
       * `error` outcome with the message in `lines`.
       */
      let outcome: CommitResult;
      try {
        outcome = attempt();
      } catch (error) {
        outcome = result('error', [error instanceof Error ? error.message : String(error)]);
      }

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
