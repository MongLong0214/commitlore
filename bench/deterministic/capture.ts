import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CHARS_PER_TOKEN } from '../../dist/core/inject.js';
import { CLI_ENTRY } from '../hooks-settings.ts';
import { command, timing } from './shared.ts';
import type { CaptureCostRow, RowBase } from './types.ts';

export interface CaptureTokenInputs {
  readonly harvest_tokens: number;
  readonly verify_tokens: number;
  readonly accepted_records: number;
}

interface VerificationCounts {
  readonly accepted: number;
  readonly rejected: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fixturePath = (repoRoot: string, name: string): string =>
  join(repoRoot, 'test', 'fixtures', 'harvest-verify', name);

export const tokensForCharacters = (characters: number): number =>
  Math.ceil(characters / CHARS_PER_TOKEN);

export const floorTokensPerAcceptedRecord = (input: CaptureTokenInputs): number => {
  if (input.accepted_records < 1) {
    throw new Error('capture cost requires at least one accepted record');
  }
  return (input.harvest_tokens + input.verify_tokens) / input.accepted_records;
};

const verificationCounts = (output: string): VerificationCounts => {
  const parsed: unknown = JSON.parse(output);
  if (!isRecord(parsed)) {
    throw new Error('harvest-verify --json did not produce an object');
  }
  const accepted = parsed['accepted'];
  const rejected = parsed['rejected'];
  const malformed = parsed['malformed'];
  if (!Array.isArray(accepted) || !Array.isArray(rejected) || !Array.isArray(malformed)) {
    throw new Error('harvest-verify --json did not produce verification counts');
  }
  return { accepted: accepted.length, rejected: rejected.length + malformed.length };
};

export const measureCaptureCost = (
  base: RowBase,
  repoRoot: string,
  runs: number,
): CaptureCostRow => {
  const transcript = fixturePath(repoRoot, 'session-transcript.txt');
  const diff = fixturePath(repoRoot, 'staged.diff');
  const draft = fixturePath(repoRoot, 'draft-truthful.json');
  const harvestArgs = ['harvest', '--prompt-only', '--transcript', transcript, '--diff', diff];
  const verifyArgs = [
    'harvest-verify',
    '--json',
    '--draft',
    draft,
    '--transcript',
    transcript,
    '--diff',
    diff,
  ];
  const harvest = (): string =>
    command(process.execPath, [CLI_ENTRY, ...harvestArgs], { cwd: repoRoot }).stdout;
  const verify = (): string =>
    command(process.execPath, [CLI_ENTRY, ...verifyArgs], { cwd: repoRoot }).stdout;
  const harvestOutput = harvest();
  const verifyOutput = verify();
  const verification = verificationCounts(verifyOutput);
  const draftInput = readFileSync(draft, 'utf8');
  const cachedPrefix = [transcript, diff].map((path) => readFileSync(path, 'utf8'));
  const verifyInput = [draftInput, ...cachedPrefix];
  const harvestTokens = tokensForCharacters(harvestOutput.length);
  const verifyTokens = tokensForCharacters(
    verifyInput.reduce((characters, input) => characters + input.length, 0),
  );
  const cacheReadTokens = tokensForCharacters(
    cachedPrefix.reduce((characters, input) => characters + input.length, 0),
  );

  return {
    ...base,
    metric: 'capture_cost',
    fixture: 'test/fixtures/harvest-verify/draft-truthful.json',
    accepted_records: verification.accepted,
    rejected_records: verification.rejected,
    harvest: {
      output_bytes: Buffer.byteLength(harvestOutput),
      output_tokens: harvestTokens,
      timing: timing(harvest, runs),
    },
    verify: {
      input_bytes: verifyInput.reduce((bytes, input) => bytes + Buffer.byteLength(input), 0),
      input_tokens: verifyTokens,
      timing: timing(verify, runs),
    },
    cache_read: {
      input_bytes: cachedPrefix.reduce((bytes, input) => bytes + Buffer.byteLength(input), 0),
      input_tokens: cacheReadTokens,
    },
    marginal_tokens_per_accepted_record: floorTokensPerAcceptedRecord({
      harvest_tokens: harvestTokens,
      verify_tokens: verifyTokens - cacheReadTokens,
      accepted_records: verification.accepted,
    }),
    tokens_including_cache_reads_per_accepted_record: floorTokensPerAcceptedRecord({
      harvest_tokens: harvestTokens,
      verify_tokens: verifyTokens,
      accepted_records: verification.accepted,
    }),
  };
};
