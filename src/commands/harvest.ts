/**
 * `commitlore harvest` — hand the prompt contract to the session, take the draft
 * back (T-403, ADR-0006 §5).
 *
 * The command has three modes and one of them is doing nothing:
 *
 * - `--prompt-only` prints the contract. The user's agent session reads it,
 *   asks its own model, and writes a draft. This is the integration path.
 * - `--draft <f>` format-checks that draft and prints what survived.
 * - Neither: there is no model here, so there is nothing to do. Exit 0, print
 *   nothing, say so once on stderr.
 *
 * That last mode is the important one. Harvest runs next to a commit, and a
 * commit must never fail because an optional enrichment step had nothing to
 * work with (ADR-0006: 전량 실패 시 비차단). Only two things are errors here: a
 * path the user named that cannot be read, and a draft that is not a draft.
 * Both are usage errors, so both exit 2 (SPEC §10) -- neither is a finding,
 * and harvest never gates on what a draft contains (a discarded record is
 * reported on stderr, not failed on).
 */

import { readFileSync, writeFileSync } from 'node:fs';

import type { Command } from 'commander';

import { execGit } from '../core/git.js';
import { buildHarvestContract, buildHarvestPrompt, parseDraft, type DraftRejection } from '../core/harvest.js';

export interface HarvestOptions {
  transcript?: string | undefined;
  diff?: string | undefined;
  out?: string | undefined;
  promptOnly?: boolean | undefined;
  draft?: string | undefined;
  cwd?: string | undefined;
}

/** What the command would print. Returned rather than written so it is testable. */
export interface HarvestOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const PREFIX = 'commitlore:';

/** The only failure mode: a usage error, never a finding (SPEC §10). */
const USAGE_EXIT_CODE = 2;

/** Nothing to harvest is a normal outcome, not a failure. */
const skip = (reason: string): HarvestOutcome => ({
  stdout: '',
  stderr: `${PREFIX} harvest skipped — ${reason}\n`,
  exitCode: 0,
});

const readTextFile = (path: string, label: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read ${label}: ${detail}`);
  }
};

const emit = (payload: string, out: string | undefined): HarvestOutcome => {
  if (out === undefined) return { stdout: payload, stderr: '', exitCode: 0 };
  try {
    writeFileSync(out, payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot write --out: ${detail}`);
  }
  return { stdout: '', stderr: '', exitCode: 0 };
};

/**
 * `--diff` when given, the staged diff otherwise. A repository that git will
 * not answer for is a skip, not an error: harvest is invoked from hooks in
 * places (bare checkouts, fresh clones) where that is simply the situation.
 */
const resolveDiff = (options: HarvestOptions): string | null => {
  if (options.diff !== undefined) {
    const text = readTextFile(options.diff, `--diff ${JSON.stringify(options.diff)}`);
    return text.trim() === '' ? null : text;
  }
  const result = execGit(
    ['diff', '--cached'],
    options.cwd === undefined ? {} : { cwd: options.cwd },
  );
  if (result.code !== 0) return null;
  return result.stdout.trim() === '' ? null : result.stdout;
};

const formatRejection = (rejection: DraftRejection): string =>
  `${PREFIX} discarded record ${rejection.index} (${rejection.rule}): ${rejection.detail}\n`;

const runDraftMode = (draft: string, out: string | undefined): HarvestOutcome => {
  const review = parseDraft(readTextFile(draft, `--draft ${JSON.stringify(draft)}`));
  const payload = `${JSON.stringify({ records: review.records }, null, 2)}\n`;
  const outcome = emit(payload, out);
  return { ...outcome, stderr: review.rejected.map(formatRejection).join('') };
};

const runPromptMode = (options: HarvestOptions): HarvestOutcome => {
  if (options.transcript === undefined) {
    // No transcript: emit the static contract (rules + vocabulary + output format).
    // The contract is what a session needs *before* it has produced a transcript.
    return emit(buildHarvestContract(), options.out);
  }
  const transcript = readTextFile(
    options.transcript,
    `--transcript ${JSON.stringify(options.transcript)}`,
  );
  if (transcript.trim() === '') return skip('the transcript is empty');

  const diff = resolveDiff(options);
  if (diff === null) {
    // No diff is not a reason to withhold the contract (#310). The contract is
    // static text, and this is the one document that defines a valid draft -- a
    // caller reaching for it is usually trying to learn the format, which is
    // exactly when nothing is staged yet. `harvest` without --prompt-only
    // prescribes --prompt-only, so suppressing it here made the prescription
    // produce zero bytes: the same shape as #296, a remedy named under
    // conditions in which it does not work.
    //
    // The transcript is still read and validated above, so an empty one is still
    // reported. What is dropped is only the diff-derived section.
    return emit(buildHarvestContract(), options.out);
  }

  return emit(buildHarvestPrompt({ transcript, diff }), options.out);
};

const harvest = (options: HarvestOptions): HarvestOutcome => {
  const promptOnly = options.promptOnly === true;

  if (promptOnly && options.draft !== undefined) {
    throw new Error('--prompt-only and --draft are mutually exclusive');
  }
  if (options.draft !== undefined) return runDraftMode(options.draft, options.out);
  if (!promptOnly) {
    return skip('this build has no model of its own; pass --prompt-only to get the contract');
  }
  return runPromptMode(options);
};

/**
 * Runs the command and reports what it would print. Failures come back as an
 * outcome rather than an exception so the caller prints one line and never a
 * stack trace — a stack trace in the middle of somebody's commit is noise that
 * tells them nothing they can act on.
 */
export const runHarvest = (options: HarvestOptions): HarvestOutcome => {
  try {
    return harvest(options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { stdout: '', stderr: `${PREFIX} ${detail}\n`, exitCode: USAGE_EXIT_CODE };
  }
};

export const register = (program: Command): void => {
  program
    .command('harvest')
    .description('build the harvest prompt contract, or check a draft a session produced')
    .option('--transcript <file>', 'agent session transcript to harvest from')
    .option('--diff <file>', 'diff to harvest from (default: the staged diff)')
    .option('--out <file>', 'write the output here instead of stdout')
    .option('--prompt-only', 'print the prompt contract for the session and exit')
    .option('--draft <file>', 'check a draft the session produced and print what survived')
    .addHelpText(
      'after',
      '\nExit codes: 0 ran (nothing to harvest counts as ran), 2 a usage error -- an unreadable path or a draft ' +
        'that is not a draft (SPEC §10).',
    )
    .action((options: HarvestOptions) => {
      const outcome = runHarvest(options);
      if (outcome.stdout !== '') process.stdout.write(outcome.stdout);
      if (outcome.stderr !== '') process.stderr.write(outcome.stderr);
      process.exitCode = outcome.exitCode;
    });
};
