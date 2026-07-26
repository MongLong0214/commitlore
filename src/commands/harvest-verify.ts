/**
 * `commitlore harvest-verify` — the gate between a draft and the protocol
 * (T-404, ADR-0006 §5).
 *
 * Two things run here, in order: T-403's format check on the document, then the
 * verifier's citation check on what survived it. Records that clear both are
 * printed in the same `{"records": [...]}` shape `harvest --draft` emits, so the
 * two commands compose.
 *
 * Exit codes carry the whole non-blocking policy. A draft where every single
 * record was fabricated exits 0 — the commit it sits next to is not this
 * command's to fail (ADR-0006: 전량 실패 시 비차단, PRD-F4 요구 4). Only a caller
 * mistake exits 2: a missing option, a path that cannot be read, a draft that is
 * not a draft. That distinction is the difference between a feature people
 * leave on and one they uninstall the first time it eats a commit.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import type { Command } from 'commander';

import { parseDraft, type DraftRecord, type DraftRejection } from '../core/harvest.js';
import {
  buildRepairFeedback,
  verifyDraft,
  type RejectedRecord,
  type VerifyResult,
} from '../core/harvest-verify.js';

export interface HarvestVerifyOptions {
  draft?: string | undefined;
  transcript?: string | undefined;
  diff?: string | undefined;
  out?: string | undefined;
  json?: boolean | undefined;
  repairPrompt?: boolean | undefined;
}

/** What the command would print. Returned rather than written so it is testable. */
export interface HarvestVerifyOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const PREFIX = 'commitlore:';

/** The only failure mode: the caller gave this command something it cannot work with. */
const BAD_INPUT = 2;

const readTextFile = (path: string, label: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read ${label}: ${detail}`);
  }
};

const required = (value: string | undefined, flag: string): string => {
  if (value === undefined) throw new Error(`missing ${flag}`);
  return value;
};

const formatMalformed = (rejection: DraftRejection): string =>
  `${PREFIX} discarded record ${rejection.index} (${rejection.rule}): ${rejection.detail}\n`;

const formatRejected = (entry: RejectedRecord): string =>
  `${PREFIX} discarded record (${entry.reason}): ${entry.detail}\n`;

/**
 * The machine-readable report. `accepted` is flattened to bare records so that
 * `--json | jq .accepted` and the plain output describe the same thing;
 * `malformed` keeps T-403's rejections separate from the verifier's, because a
 * draft the parser could not read never reached a citation check and saying it
 * failed one would be a lie.
 */
const jsonPayload = (result: VerifyResult, malformed: DraftRejection[]): string =>
  `${JSON.stringify(
    {
      accepted: result.accepted.map((entry) => entry.record),
      rejected: result.rejected.map((entry) => ({
        reason: entry.reason,
        detail: entry.detail,
        record: entry.record,
      })),
      malformed: malformed.map((entry) => ({
        index: entry.index,
        rule: entry.rule,
        detail: entry.detail,
      })),
    },
    null,
    2,
  )}\n`;

const recordsPayload = (records: DraftRecord[]): string =>
  `${JSON.stringify({ records }, null, 2)}\n`;

const emit = (payload: string, out: string | undefined): string => {
  if (out === undefined) return payload;
  try {
    writeFileSync(out, payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot write --out: ${detail}`);
  }
  return '';
};

const stdoutFor = (
  options: HarvestVerifyOptions,
  result: VerifyResult,
  malformed: DraftRejection[],
): string => {
  if (options.repairPrompt === true) return buildRepairFeedback(result.rejected);
  if (options.json === true) return jsonPayload(result, malformed);
  return recordsPayload(result.accepted.map((entry) => entry.record));
};

const harvestVerify = (options: HarvestVerifyOptions): HarvestVerifyOutcome => {
  const draftPath = required(options.draft, '--draft');
  const transcriptPath = required(options.transcript, '--transcript');
  const diffPath = required(options.diff, '--diff');

  const review = parseDraft(readTextFile(draftPath, `--draft ${JSON.stringify(draftPath)}`));
  const result = verifyDraft(review.records, {
    transcript: readTextFile(transcriptPath, `--transcript ${JSON.stringify(transcriptPath)}`),
    diff: readTextFile(diffPath, `--diff ${JSON.stringify(diffPath)}`),
  });

  const stderr = [
    ...review.rejected.map(formatMalformed),
    ...result.rejected.map(formatRejected),
  ].join('');

  return {
    stdout: emit(stdoutFor(options, result, review.rejected), options.out),
    stderr,
    exitCode: 0,
  };
};

/**
 * One line, always. Node's own JSON parse errors quote the offending source
 * back — `...\"r 4 MB\" },],\n \"\"... is not valid JSON` — and a draft that
 * failed to parse is exactly the input most likely to carry a newline into that
 * quotation. Left alone it turns a one-line failure into something that reads
 * like a stack trace in the middle of somebody's commit.
 */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * Runs the command and reports what it would print. Failures come back as an
 * outcome rather than an exception so the caller prints one line and never a
 * stack trace — a stack trace in the middle of somebody's commit is noise that
 * tells them nothing they can act on.
 */
export const runHarvestVerify = (options: HarvestVerifyOptions): HarvestVerifyOutcome => {
  try {
    return harvestVerify(options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { stdout: '', stderr: `${PREFIX} ${oneLine(detail)}\n`, exitCode: BAD_INPUT };
  }
};

export const register = (program: Command): void => {
  program
    .command('harvest-verify')
    .description('check a harvested draft against the transcript and diff it claims to quote')
    .option('--draft <file>', 'the draft a session produced')
    .option('--transcript <file>', 'the transcript the draft was harvested from')
    .option('--diff <file>', 'the diff the draft was harvested from')
    .option('--out <file>', 'write the output here instead of stdout')
    .option('--json', 'emit the full report, discarded records included')
    .option('--repair-prompt', 'emit the feedback prompt for another draft attempt')
    .action((options: HarvestVerifyOptions) => {
      const outcome = runHarvestVerify(options);
      if (outcome.stdout !== '') process.stdout.write(outcome.stdout);
      if (outcome.stderr !== '') process.stderr.write(outcome.stderr);
      process.exitCode = outcome.exitCode;
    });
};
