/**
 * T-403. Two contracts are under test here, and neither of them involves a
 * model:
 *
 * - the prompt handed to the user's session must be generated from SPEC §3 and
 *   `src/core/types.ts`, so that changing a constant changes the prompt instead
 *   of silently teaching sessions a vocabulary the validator rejects;
 * - the draft handed back must be checked, never repaired.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { register, runHarvest } from '../src/commands/harvest.js';
import {
  EXAMPLE_DRAFT,
  buildHarvestPrompt,
  loadVocabulary,
  parseDraft,
  parseVocabulary,
} from '../src/core/harvest.js';
import {
  BLAST_VALUES,
  CERTAINTY_VALUES,
  KNOWN_KEYS,
  UNDO_VALUES,
  type Trailer,
} from '../src/core/types.js';
import { createTestRepo } from './git-fixtures.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/harvest/', import.meta.url));
const SPEC_PATH = fileURLToPath(new URL('../spec/SPEC.md', import.meta.url));

const fixture = (name: string): string => join(FIXTURES, name);
const read = (name: string): string => readFileSync(fixture(name), 'utf8');

const TRANSCRIPT_FILE = fixture('session-transcript.txt');
const DIFF_FILE = fixture('staged.diff');
const transcript = read('session-transcript.txt');
const diff = read('staged.diff');

const prompt = buildHarvestPrompt({ transcript, diff });

/** The generated part of the prompt, isolated from the fixture text it carries. */
const vocabularyBlock = prompt.slice(prompt.indexOf('## Vocabulary'), prompt.indexOf('## Output'));

let workspace = '';

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'commitlore-harvest-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('harvest prompt contract', () => {
  it('states every harvestable key while excluding Verified', () => {
    const vocabulary = loadVocabulary();
    expect(vocabulary).toHaveLength(16);
    for (const entry of vocabulary.filter((entry) => entry.key !== 'Verified')) {
      expect(vocabularyBlock).toContain(`- \`${entry.key}:\` = `);
    }
    for (const key of KNOWN_KEYS.filter((entry) => entry !== 'Verified')) {
      expect(vocabularyBlock).toContain(`- \`${key}:\` = `);
    }
    expect(vocabularyBlock).not.toContain('- `Verified:` = ');
    expect(vocabularyBlock).toContain('- `X-<Name>:` = ');
  });

  it('renders enum grammars from types.ts, not from a hardcoded copy', () => {
    expect(vocabularyBlock).toContain(
      `- \`Blast:\` = ${BLAST_VALUES.join(' | ')} (single-valued)`,
    );
    expect(vocabularyBlock).toContain(`- \`Undo:\` = ${UNDO_VALUES.join(' | ')} (single-valued)`);
    expect(vocabularyBlock).toContain(
      `- \`Certainty:\` = ${CERTAINTY_VALUES.join(' | ')} (single-valued)`,
    );
  });

  it('offers no enum value that types.ts does not define', () => {
    for (const synonym of ['wide', 'narrow', 'clean', 'high', 'level-3']) {
      expect(vocabularyBlock).not.toContain(synonym);
    }
  });

  it('marks cardinality the way SINGLE_VALUED does', () => {
    expect(vocabularyBlock).toContain('- `Limit:` = free text (repeatable)');
    expect(vocabularyBlock).toContain('- `Record-Id:` = r-[a-z0-9]{6,} (single-valued)');
  });

  it('refuses a SPEC whose enum has drifted from types.ts', () => {
    const drifted = readFileSync(SPEC_PATH, 'utf8').replace('`system`', '`wide`');
    expect(() => parseVocabulary(drifted)).toThrow(/drifted from src\/core\/types\.ts/);
  });

  it('refuses a SPEC whose key set has drifted from KNOWN_KEYS', () => {
    const drifted = readFileSync(SPEC_PATH, 'utf8').replace('| `Warn:`', '| `Warning:`');
    expect(() => parseVocabulary(drifted)).toThrow(/KNOWN_KEYS/);
  });

  it('refuses a SPEC whose vocabulary tables have been retitled', () => {
    const drifted = readFileSync(SPEC_PATH, 'utf8').replace(
      '### 3.1 Decision context',
      '### 3.1 Decisions',
    );
    expect(() => parseVocabulary(drifted)).toThrow(/§3 tables are/);
  });

  it('carries the fabrication rules the ADR requires', () => {
    expect(prompt).toContain('A missing record is better than a false one.');
    expect(prompt).toContain('Do not infer.');
    expect(prompt).toContain('Record nothing for a trivial change.');
    expect(prompt).toContain('Quote verbatim.');
  });

  it('names the keys a citation must cover', () => {
    const claims = loadVocabulary()
      .filter((entry) => entry.claim && entry.key !== 'Verified')
      .map((entry) => entry.key);
    expect(claims).toEqual([
      'Limit',
      'Ruled-out',
      'Warn',
      'Blast',
      'Undo',
      'Certainty',
      'Unverified',
    ]);
    expect(prompt).toContain(`  ${claims.join(', ')}.`);
  });

  it('numbers transcript lines so a locator can name a range', () => {
    expect(prompt).toContain('4 | user: Go with backoff.');
    expect(prompt).toContain('never the "NN | " line-number prefix');
  });

  it('embeds an example that parseDraft itself accepts', () => {
    expect(prompt).toContain(JSON.stringify(EXAMPLE_DRAFT, null, 2));
    const review = parseDraft(JSON.stringify(EXAMPLE_DRAFT));
    expect(review.rejected).toEqual([]);
    expect(review.records).toHaveLength(1);
  });

  it('is byte-identical across runs', () => {
    expect(buildHarvestPrompt({ transcript, diff })).toBe(prompt);
    const first = runHarvest({ promptOnly: true, transcript: TRANSCRIPT_FILE, diff: DIFF_FILE });
    const second = runHarvest({ promptOnly: true, transcript: TRANSCRIPT_FILE, diff: DIFF_FILE });
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toBe(prompt);
  });
});

describe('parseDraft', () => {
  it('accepts a well-formed draft and preserves its evidence verbatim', () => {
    const raw = read('draft-valid.json');
    const review = parseDraft(raw);
    const source = JSON.parse(raw) as { records: [{ trailers: Trailer[]; evidence: unknown[] }] };

    expect(review.rejected).toEqual([]);
    expect(review.records).toHaveLength(1);
    expect(review.records[0]?.trailers).toEqual(source.records[0].trailers);
    expect(review.records[0]?.evidence).toEqual(source.records[0].evidence);
  });

  it('does not require evidence for identity and lifecycle keys', () => {
    const review = parseDraft(read('draft-valid.json'));
    const keys = (review.records[0]?.trailers ?? []).map((trailer) => trailer.key);
    const cited = new Set((review.records[0]?.evidence ?? []).map((entry) => entry.key));
    expect(keys).toContain('Record-Id');
    expect(cited.has('Record-Id')).toBe(false);
  });

  it('discards a record with no evidence, with a reason', () => {
    const review = parseDraft(read('draft-missing-evidence.json'));
    expect(review.records).toEqual([]);
    expect(review.rejected.map((entry) => entry.rule)).toEqual([
      'missing-evidence',
      'missing-evidence',
    ]);
    expect(review.rejected[0]?.detail).toContain('no "evidence"');
    expect(review.rejected[1]?.detail).toContain('empty');
  });

  it('discards a record whose enum value is not in the vocabulary', () => {
    const review = parseDraft(read('draft-bad-enum.json'));
    expect(review.records).toHaveLength(1);
    expect(review.rejected).toHaveLength(1);
    expect(review.rejected[0]?.rule).toBe('vocabulary');
    expect(review.rejected[0]?.violations).toEqual([
      {
        key: 'Blast',
        value: 'wide',
        rule: 'enum',
        got: 'wide',
        want: BLAST_VALUES.join('|'),
      },
      {
        key: 'Undo',
        value: 'clean',
        rule: 'enum',
        got: 'clean',
        want: UNDO_VALUES.join('|'),
      },
    ]);
  });

  it('discards a record that invents a key', () => {
    const review = parseDraft(read('draft-unknown-key.json'));
    expect(review.records).toEqual([]);
    expect(review.rejected[0]?.rule).toBe('vocabulary');
    expect(review.rejected[0]?.violations[0]).toMatchObject({
      key: 'Constraint',
      rule: 'unknown-key',
    });
  });

  it('discards evidence that cites a trailer the record does not carry', () => {
    const review = parseDraft(
      JSON.stringify({
        records: [
          {
            trailers: [{ key: 'Warn', value: 'watch the retry budget' }],
            evidence: [
              { key: 'Blast', source: 'diff', quote: 'putObject', locator: '@@ -8,6 +8,18 @@' },
            ],
          },
        ],
      }),
    );
    expect(review.records).toEqual([]);
    expect(review.rejected[0]?.rule).toBe('evidence-orphan');
    expect(review.rejected[0]?.detail).toContain('"Blast"');
  });

  it('discards a record whose claim nobody cites', () => {
    const review = parseDraft(
      JSON.stringify({
        records: [
          {
            trailers: [
              { key: 'Limit', value: 'the CDN times out at 30s' },
              { key: 'Warn', value: 'watch the retry budget' },
            ],
            evidence: [
              { key: 'Warn', source: 'transcript', quote: 'retry budget', locator: 'L5-L5' },
            ],
          },
        ],
      }),
    );
    expect(review.records).toEqual([]);
    expect(review.rejected[0]?.rule).toBe('evidence-gap');
    expect(review.rejected[0]?.detail).toContain('"Limit"');
  });

  it('rejects an unparseable evidence source instead of guessing one', () => {
    const review = parseDraft(
      JSON.stringify({
        records: [
          {
            trailers: [{ key: 'Warn', value: 'watch the retry budget' }],
            evidence: [{ key: 'Warn', source: 'memory', quote: 'x', locator: 'L1-L1' }],
          },
        ],
      }),
    );
    expect(review.rejected[0]?.rule).toBe('malformed-evidence');
    expect(review.rejected[0]?.detail).toContain('transcript or diff');
  });

  it('never coerces a value into a trailer', () => {
    const review = parseDraft(
      JSON.stringify({
        records: [
          {
            trailers: [{ key: 'Blast', value: 30 }],
            evidence: [{ key: 'Blast', source: 'diff', quote: 'x', locator: '@@' }],
          },
        ],
      }),
    );
    expect(review.records).toEqual([]);
    expect(review.rejected[0]?.rule).toBe('malformed-trailers');
    expect(review.rejected[0]?.detail).toContain('value is not a string');
  });

  it('adds no trailer the draft did not contain', () => {
    const raw = JSON.stringify({
      records: [
        {
          trailers: [{ key: 'Warn', value: 'watch the retry budget' }],
          evidence: [
            { key: 'Warn', source: 'transcript', quote: 'retry budget', locator: 'L5-L5' },
          ],
        },
      ],
    });
    const review = parseDraft(raw);
    expect(review.records[0]?.trailers).toEqual([{ key: 'Warn', value: 'watch the retry budget' }]);
  });

  it('discards a record carrying a field the contract does not define', () => {
    const review = parseDraft(
      JSON.stringify({
        records: [
          {
            trailers: [{ key: 'Warn', value: 'watch the retry budget' }],
            evidence: [
              { key: 'Warn', source: 'transcript', quote: 'retry budget', locator: 'L5-L5' },
            ],
            confidence: 0.9,
          },
        ],
      }),
    );
    expect(review.rejected[0]?.rule).toBe('unknown-field');
    expect(review.rejected[0]?.detail).toContain('confidence');
  });

  it('throws a readable error on a draft that is not JSON', () => {
    expect(() => parseDraft(read('draft-broken.json'))).toThrow(/draft is not valid JSON/);
  });

  it('says so when the draft came back inside a code fence', () => {
    expect(() => parseDraft('```json\n{"records": []}\n```')).toThrow(/markdown code fence/);
  });

  it('refuses a document that is not an object with records', () => {
    expect(() => parseDraft('[]')).toThrow(/"records" array/);
    expect(() => parseDraft('{"record": []}')).toThrow(/unknown top-level field/);
  });
});

describe('commitlore harvest', () => {
  it('prints the contract under --prompt-only and exits 0', () => {
    const outcome = runHarvest({
      promptOnly: true,
      transcript: TRANSCRIPT_FILE,
      diff: DIFF_FILE,
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stderr).toBe('');
    expect(outcome.stdout).toBe(prompt);
  });

  it('writes to --out instead of stdout', () => {
    const out = join(workspace, 'prompt.txt');
    const outcome = runHarvest({
      promptOnly: true,
      transcript: TRANSCRIPT_FILE,
      diff: DIFF_FILE,
      out,
    });
    expect(outcome.stdout).toBe('');
    expect(readFileSync(out, 'utf8')).toBe(prompt);
  });

  it('skips silently when no model is available', () => {
    const outcome = runHarvest({ transcript: TRANSCRIPT_FILE, diff: DIFF_FILE });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr.split('\n').filter((line) => line !== '')).toHaveLength(1);
    expect(outcome.stderr).toContain('harvest skipped');
  });

  it('skips when nothing is staged and no --diff was given', () => {
    const repo = mkdtempSync(join(workspace, 'repo-'));
    createTestRepo({ path: repo });

    const outcome = runHarvest({ promptOnly: true, transcript: TRANSCRIPT_FILE, cwd: repo });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain('nothing staged');
  });

  it('prints the surviving records under --draft, and the reasons on stderr', () => {
    const outcome = runHarvest({ draft: fixture('draft-bad-enum.json') });
    expect(outcome.exitCode).toBe(0);
    expect(JSON.parse(outcome.stdout)).toEqual({
      records: [
        {
          trailers: [{ key: 'Certainty', value: 'firm' }],
          evidence: [
            {
              key: 'Certainty',
              source: 'transcript',
              quote: '5 attempts, 200ms base delay, full jitter',
              locator: 'L5-L5',
            },
          ],
        },
      ],
    });
    expect(outcome.stderr).toContain('discarded record 0 (vocabulary)');
    expect(outcome.stderr).toContain('want local|module|system');
  });

  it('fails with one line and no stack trace on a broken draft', () => {
    const outcome = runHarvest({ draft: fixture('draft-broken.json') });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain('commitlore: draft is not valid JSON');
    expect(outcome.stderr).not.toMatch(/\n\s+at /);
    expect(outcome.stderr.split('\n').filter((line) => line !== '')).toHaveLength(1);
  });

  it('fails on a path it was told to read but cannot', () => {
    const outcome = runHarvest({ promptOnly: true, transcript: join(workspace, 'nope.txt') });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('cannot read --transcript');
    expect(outcome.stderr).not.toMatch(/\n\s+at /);
  });

  it('refuses to build a prompt and check a draft at once', () => {
    const outcome = runHarvest({ promptOnly: true, draft: fixture('draft-valid.json') });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('mutually exclusive');
  });

  it('registers itself on a commander program', async () => {
    const program = new Command();
    program.exitOverride();
    register(program);

    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    const previousExitCode = process.exitCode;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      await program.parseAsync(
        ['harvest', '--prompt-only', '--transcript', TRANSCRIPT_FILE, '--diff', DIFF_FILE],
        { from: 'user' },
      );
    } finally {
      process.stdout.write = write;
      process.exitCode = previousExitCode;
    }

    expect(chunks.join('')).toBe(prompt);
  });
});
