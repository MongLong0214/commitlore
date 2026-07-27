/**
 * `commitlore squash-preserve` — carry a branch's records onto the commit that
 * squashed it (T-302, ADR-0004, PRD-F3 AC 1·2).
 *
 * Two contracts hold this command in place, because a GitHub Action will run it
 * unattended on every merge:
 *
 *   exit 0  the plan was produced (and applied, if asked). Conflicts warn here.
 *   exit 2  the range is not a range, names nothing, is empty, or a write failed
 *
 * Both codes follow SPEC §10: 2 is a usage error, and this command never emits
 * 1, because a conflict is a warning and never a failure. Two commits
 * disagreeing about a record is a normal thing for a branch to do, and
 * blocking a merge over it would teach people to stop writing records — the
 * opposite of the point.
 *
 * Doing nothing is the default. With neither `--message-file` nor `--target`
 * the command prints what it would write and touches nothing, so it is safe to
 * run against somebody else's repository to see what a merge would inherit.
 *
 * Nothing here pushes. `refs/notes/commitlore` is written locally and published
 * by whoever owns the remote (ADR-0004).
 */

import { readFileSync, writeFileSync } from 'node:fs';

import type { Command } from 'commander';

import { execGit } from '../core/git.js';
import {
  attachToNotes,
  collectRange,
  planSquash,
  renderMessage,
  type SquashPlan,
} from '../core/squash.js';
import { serializeTrailers } from '../core/trailers.js';

export interface SquashPreserveInput {
  range?: string;
  /** The merge commit to mirror the inherited record onto. */
  target?: string;
  /** A merge message draft to rewrite in place. */
  messageFile?: string;
  json?: boolean;
  /** Overwrite an existing note on `--target`. */
  force?: boolean;
  cwd?: string;
}

/** Exit code plus the streams the caller writes, so tests can drive this in-process. */
export interface SquashPreserveOutcome {
  code: 0 | 2;
  stdout: string;
  stderr: string;
  plan: SquashPlan | null;
}

const PREFIX = 'commitlore:';

const USAGE =
  'usage: commitlore squash-preserve <base>..<head> [--target <sha>] [--message-file <file>] [--json] [--force]';

const SHORT_SHA = 8;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const firstLine = (text: string): string => (text.trim().split('\n')[0] ?? '').trim();

const shortSha = (sha: string): string => (sha.length > SHORT_SHA ? sha.slice(0, SHORT_SHA) : sha);

const usageError = (message: string): SquashPreserveOutcome => ({
  code: 2,
  stdout: '',
  stderr: `${PREFIX} ${message}\n${USAGE}\n`,
  plan: null,
});

/**
 * How many commits the range holds, records or not.
 *
 * `collectRange` returns only the commits that recorded something, so it cannot
 * tell "the branch had nothing to say" from "this range is empty". The first is
 * an ordinary merge and must exit 0; the second is a wrong argument and must
 * exit 2. One extra `rev-list` buys that distinction.
 */
const countCommits = (range: string, cwd: string | undefined): number => {
  const result = execGit(
    ['rev-list', '--count', '--end-of-options', range, '--'],
    cwd === undefined ? {} : { cwd },
  );
  if (result.code !== 0) {
    throw new Error(`cannot walk range ${JSON.stringify(range)}: ${firstLine(result.stderr)}`);
  }
  return Number(result.stdout.trim());
};

/**
 * The warnings a plan carries. Conflicts are one line each; unidentified
 * records beyond the first that a later re-parse cannot tell apart from body
 * prose are one line for the whole plan.
 *
 * Neither is silent. A record dropped without a word is worse than one never
 * written, because the next reader has no way to know a claim used to exist.
 */
const warningsFor = (plan: SquashPlan): string[] => {
  const lines = plan.conflicts.map(
    (conflict) =>
      `${PREFIX} conflict on ${conflict.recordId} — kept the version from ${shortSha(conflict.kept)}, ` +
      `dropped ${conflict.dropped.map(shortSha).join(', ')}`,
  );

  // Every block that already had a `Record-Id` keeps it (SPEC §2.4) — this
  // plan cannot lose an identity the way the pre-multi-record format did.
  // What remains a real limitation: `parseRecordBlocks` only recognizes a
  // *non-final* block by its declared identity, so if more than one inherited
  // record never declared one, only the last block written stays findable if
  // this note or message is re-parsed later from stored text. The plan itself
  // — and this run's `--json` output — still names every one of them.
  const unidentified = plan.blocks.filter(
    (block) => !block.some((trailer) => trailer.key === 'Record-Id'),
  ).length;

  if (unidentified > 1) {
    lines.push(
      `${PREFIX} ${unidentified} inherited records declared no Record-Id — only the last one ` +
        'written stays recoverable if this note or message is re-parsed later; this plan (and ' +
        '--json) still lists all of them',
    );
  }

  return lines;
};

const readDraft = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${JSON.stringify(path)}: ${messageOf(error)}`);
  }
};

const writeDraft = (path: string, text: string): void => {
  try {
    writeFileSync(path, text);
  } catch (error) {
    throw new Error(`cannot write ${JSON.stringify(path)}: ${messageOf(error)}`);
  }
};

interface Applied {
  messageFile: string | null;
  target: string | null;
}

/**
 * Runs the command and reports what it would print. Input failures come back as
 * a `code`, never as an exception, so the caller prints one line rather than a
 * stack trace into somebody's merge.
 */
export const runSquashPreserve = (input: SquashPreserveInput = {}): SquashPreserveOutcome => {
  const range = input.range;
  if (range === undefined || range === '') return usageError('a range is required');

  let plan: SquashPlan;
  let commits: number;
  try {
    commits = countCommits(range, input.cwd);
    if (commits === 0) {
      return usageError(
        `the range ${JSON.stringify(range)} holds no commits — nothing was squashed`,
      );
    }
    plan = planSquash(
      collectRange(range, input.cwd === undefined ? {} : { cwd: input.cwd }),
    );
  } catch (error) {
    return usageError(messageOf(error));
  }

  const warnings = warningsFor(plan)
    .map((line) => `${line}\n`)
    .join('');

  // A branch that recorded nothing is an ordinary branch (SPEC §4). There is
  // nothing to write and nothing to complain about.
  if (plan.sources.length === 0) {
    const notice = `${PREFIX} no records in ${range} (${commits} commit(s)) — nothing to preserve\n`;
    return {
      code: 0,
      stdout: input.json === true ? `${JSON.stringify({ range, ...plan }, null, 2)}\n` : '',
      stderr: notice,
      plan,
    };
  }

  const applied: Applied = { messageFile: null, target: null };
  try {
    if (input.target !== undefined) {
      attachToNotes(input.target, plan, {
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.force === undefined ? {} : { force: input.force }),
      });
      applied.target = input.target;
    }
    if (input.messageFile !== undefined) {
      writeDraft(input.messageFile, renderMessage(readDraft(input.messageFile), plan));
      applied.messageFile = input.messageFile;
    }
  } catch (error) {
    return { code: 2, stdout: '', stderr: `${warnings}${PREFIX} ${messageOf(error)}\n`, plan };
  }

  if (input.json === true) {
    return {
      code: 0,
      stdout: `${JSON.stringify({ range, ...plan, applied }, null, 2)}\n`,
      stderr: warnings,
      plan,
    };
  }

  const summary =
    `${PREFIX} ${plan.sources.length} record(s) from ${commits} commit(s) in ${range}` +
    `${plan.conflicts.length === 0 ? '' : `, ${plan.conflicts.length} conflict(s)`}`;

  const wrote: string[] = [];
  if (applied.target !== null) wrote.push(`the notes mirror for ${shortSha(applied.target)}`);
  if (applied.messageFile !== null) wrote.push(applied.messageFile);

  if (wrote.length === 0) {
    return {
      code: 0,
      stdout: plan.blocks.map(serializeTrailers).join('\n'),
      stderr: `${warnings}${summary} — plan only; pass --message-file or --target to apply\n`,
      plan,
    };
  }

  return { code: 0, stdout: '', stderr: `${warnings}${summary} — wrote ${wrote.join(' and ')}\n`, plan };
};

/** Commander's parsed flags for this command. */
interface SquashPreserveFlags {
  target?: string;
  messageFile?: string;
  json?: boolean;
  force?: boolean;
}

export const register = (program: Command): void => {
  program
    .command('squash-preserve')
    .description('carry the records of a squashed branch onto the merge commit (ADR-0004)')
    .argument('<range>', '<base>..<head> — the commits the squash collapses')
    .option('--target <sha>', 'mirror the inherited record onto this merge commit')
    .option('--message-file <file>', 'rewrite this merge message draft with the inherited trailers')
    .option('--json', 'emit the plan as JSON')
    .option('--force', 'replace an existing note on --target')
    .addHelpText(
      'after',
      '\nWith neither --message-file nor --target the plan is printed and nothing is written.' +
        '\nNotes are written locally; publishing them (git push origin refs/notes/commitlore) is yours to do.' +
        '\nExit codes: 0 done — conflicts warn but do not block, 2 bad range, empty range, or a failed write (SPEC §10).',
    )
    .action((range: string, flags: SquashPreserveFlags) => {
      const outcome = runSquashPreserve({
        range,
        ...(flags.target === undefined ? {} : { target: flags.target }),
        ...(flags.messageFile === undefined ? {} : { messageFile: flags.messageFile }),
        ...(flags.json === undefined ? {} : { json: flags.json }),
        ...(flags.force === undefined ? {} : { force: flags.force }),
      });

      if (outcome.stdout !== '') process.stdout.write(outcome.stdout);
      if (outcome.stderr !== '') process.stderr.write(outcome.stderr);
      if (outcome.code !== 0) process.exitCode = outcome.code;
    });
};
