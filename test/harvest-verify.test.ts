/**
 * T-404. One question is under test here and it is not a matter of taste: does
 * the quoted sentence exist in the text the session was given?
 *
 * The tests that matter most are the negative ones. A verifier that accepts
 * everything true is worthless if it also accepts things that are nearly true —
 * and "nearly true" is precisely the shape of a fabrication, since a model
 * inventing a sentence invents one that sounds like the transcript it just read.
 * So the normalisation boundary is pinned from both sides: a quote that differs
 * only in whitespace passes, and a quote that differs by one word, one letter of
 * case, or one space inside a token is discarded.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { register, runHarvestVerify } from '../src/commands/harvest-verify.js';
import { parseDraft, type DraftEvidence, type DraftRecord } from '../src/core/harvest.js';
import {
  MAX_REPAIR_ROUNDS,
  REJECTION_MARKERS,
  buildRepairFeedback,
  formatResult,
  planRepair,
  verifyDraft,
  type RejectedRecord,
  type RepairRound,
  type Sources,
} from '../src/core/harvest-verify.js';
import type { Trailer } from '../src/core/types.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/harvest-verify/', import.meta.url));
/** T-403's own fixtures. Read only — they belong to the harvest ticket. */
const HARVEST_FIXTURES = fileURLToPath(new URL('./fixtures/harvest/', import.meta.url));

const fixture = (name: string): string => join(FIXTURES, name);
const read = (name: string): string => readFileSync(fixture(name), 'utf8');

const TRANSCRIPT_FILE = fixture('session-transcript.txt');
const DIFF_FILE = fixture('staged.diff');

const sources: Sources = {
  transcript: read('session-transcript.txt'),
  diff: read('staged.diff'),
};

/** Transcript line 4, verbatim. Every normalisation test is a mutation of this. */
const TRUE_QUOTE = 'The report API caps a single response at 5 MB.';

const draftOf = (name: string): DraftRecord[] => parseDraft(read(name)).records;

const cite = (
  key: string,
  quote: string,
  source: DraftEvidence['source'] = 'transcript',
): DraftEvidence => ({ key, source, quote, locator: 'L4-L4' });

const recordOf = (trailers: Trailer[], evidence: DraftEvidence[]): DraftRecord => ({
  trailers,
  evidence,
});

/** A one-trailer record whose only citation is `quote`. */
const limitCiting = (quote: string): DraftRecord =>
  recordOf([{ key: 'Limit', value: 'the report API caps a response at 5 MB' }], [
    cite('Limit', quote),
  ]);

let workspace = '';

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'commitlore-verify-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('verifyDraft — citation existence', () => {
  it('discards a record whose quote is nowhere in the transcript', () => {
    const result = verifyDraft(draftOf('draft-fabricated.json'), sources);

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe('evidence-not-found');
    expect(result.rejected[0]?.detail).toContain('the transcript does not contain');
    expect(result.rejected[0]?.detail).toContain('We agreed the export must finish inside 30');
  });

  it('costs the truthful records nothing when one record is fabricated', () => {
    const result = verifyDraft(draftOf('draft-fabricated.json'), sources);

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.record.trailers[0]?.key).toBe('Warn');
  });

  it('accepts a quote cut straight out of the source', () => {
    const result = verifyDraft([limitCiting(TRUE_QUOTE)], sources);

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });

  it('refuses Verified even when its quote exists in the diff', () => {
    const quote = 'export const exportNightly = async (): Promise<Buffer> => {';
    const record = recordOf(
      [{ key: 'Verified', value: 'the export has unit tests' }],
      [cite('Verified', quote, 'diff')],
    );

    const result = verifyDraft([record], sources);

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('verified-unsupported');
  });

  it('accepts every claim of a wholly truthful draft', () => {
    const result = verifyDraft(draftOf('draft-truthful.json'), sources);

    expect(formatResult(result)).toBe('1 record(s) verified, 0 discarded\n');
    expect(result.accepted[0]?.record.evidence).toHaveLength(8);
  });

  it('discards a citation into a source that is empty', () => {
    const record = recordOf(
      [{ key: 'Blast', value: 'module' }],
      [cite('Blast', 'export const exportNightly', 'diff')],
    );
    const result = verifyDraft([record], { transcript: sources.transcript, diff: '' });

    expect(result.rejected[0]?.reason).toBe('evidence-not-found');
    expect(result.rejected[0]?.detail).toContain('the diff is empty');
  });

  it('treats an all-whitespace quote as absent, not as trivially present', () => {
    const result = verifyDraft([limitCiting('   \n\t  ')], sources);

    expect(result.rejected[0]?.reason).toBe('evidence-not-found');
  });
});

describe('verifyDraft — the normalisation boundary', () => {
  it('accepts a quote that differs only in whitespace and line breaks', () => {
    const rewrapped = 'The report API caps\n     a single    response\nat 5 MB.';
    expect(rewrapped).not.toBe(TRUE_QUOTE);

    const result = verifyDraft([limitCiting(rewrapped)], sources);
    expect(result.rejected).toEqual([]);
  });

  it('accepts a quote padded with leading and trailing whitespace', () => {
    const result = verifyDraft([limitCiting(`\n  ${TRUE_QUOTE}  \n`)], sources);
    expect(result.rejected).toEqual([]);
  });

  it('discards a quote with one word changed', () => {
    const swapped = 'The report API caps every response at 5 MB.';
    const result = verifyDraft([limitCiting(swapped)], sources);

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('evidence-not-found');
  });

  it('discards a quote that differs only in case', () => {
    const result = verifyDraft([limitCiting(TRUE_QUOTE.toLowerCase())], sources);

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('evidence-not-found');
  });

  it('discards a quote that loses a space inside the span', () => {
    // Whitespace runs collapse; they do not disappear. "5 MB" is not "5MB".
    for (const mangled of ['The report API caps a single response at 5MB.', 'at5 MB']) {
      expect(verifyDraft([limitCiting(mangled)], sources).rejected[0]?.reason).toBe(
        'evidence-not-found',
      );
    }
  });

  it('accepts a fragment of a real sentence — the known cost of substring matching', () => {
    // A quote is checked for presence, not for being a whole utterance. This is
    // the loosest thing the verifier does, and it is pinned here so that it stays
    // a decision rather than becoming a discovery: a citation may stop before the
    // clause that would have qualified it.
    const fragment = 'The report API caps a single response';
    expect(verifyDraft([limitCiting(fragment)], sources).rejected).toEqual([]);
  });

  it('does not fall back to word overlap when the sentence is not there', () => {
    const shuffled = 'A single response at 5 MB is what the report API caps.';
    const result = verifyDraft([limitCiting(shuffled)], sources);

    expect(result.rejected[0]?.reason).toBe('evidence-not-found');
  });
});

describe('verifyDraft — Ruled-out rejection context', () => {
  it('accepts a Ruled-out whose quote sits next to a rejection marker', () => {
    const result = verifyDraft(draftOf('draft-truthful.json'), sources);
    expect(result.rejected).toEqual([]);
  });

  it('discards a Ruled-out that only proves the alternative was mentioned', () => {
    const result = verifyDraft(draftOf('draft-ruled-out-mention.json'), sources);

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('ruled-out-no-rejection');
    expect(result.rejected[0]?.detail).toContain('mentions it, which is not the same as rejecting it');
  });

  it('finds a marker in the line before or after the quote, not only inside it', () => {
    const transcript = [
      'assistant: We could put the export on a background worker.',
      'assistant: That needs a second deploy target and we cannot pay for one.',
      'assistant: I will page the rows.',
    ].join('\n');
    const record = recordOf(
      [{ key: 'Ruled-out', value: 'background worker | needs a second deploy target' }],
      [cite('Ruled-out', 'We could put the export on a background worker.')],
    );

    const result = verifyDraft([record], { transcript, diff: '' });
    expect(result.rejected).toEqual([]);
  });

  it('does not reach across four lines for a marker', () => {
    const transcript = [
      'assistant: We are rejecting the background worker.',
      'user: Fine.',
      'user: Different topic.',
      'assistant: Anyway.',
      'assistant: Redis caching came up in passing.',
    ].join('\n');
    const record = recordOf(
      [{ key: 'Ruled-out', value: 'Redis caching | nobody looked at it' }],
      [cite('Ruled-out', 'Redis caching came up in passing.')],
    );

    const result = verifyDraft([record], { transcript, diff: '' });
    expect(result.rejected[0]?.reason).toBe('ruled-out-no-rejection');
  });

  it('leaves every other key alone — only Ruled-out needs a rejection', () => {
    const record = recordOf(
      [{ key: 'Limit', value: 'the report API caps a response at 5 MB' }],
      [cite('Limit', TRUE_QUOTE)],
    );

    expect(verifyDraft([record], sources).rejected).toEqual([]);
  });

  it('keeps the marker table small enough to stay honest', () => {
    expect(REJECTION_MARKERS.length).toBeLessThan(60);
    expect(new Set(REJECTION_MARKERS).size).toBe(REJECTION_MARKERS.length);
    // A marker so generic it matches ordinary prose would launder mentions into rejections.
    for (const marker of ['the', 'a', 'is', 'not', 'or', '것']) {
      expect(REJECTION_MARKERS).not.toContain(marker);
    }
  });
});

describe('verifyDraft — vocabulary', () => {
  it('discards a record whose enum value is not in the vocabulary', () => {
    const record = recordOf(
      [{ key: 'Blast', value: 'wide' }],
      [cite('Blast', 'export const exportNightly', 'diff')],
    );

    const result = verifyDraft([record], sources);
    expect(result.rejected[0]?.reason).toBe('enum');
    expect(result.rejected[0]?.detail).toContain('want local|module|system');
  });

  it('discards a record that invents a key', () => {
    const record = recordOf(
      [{ key: 'Constraint', value: 'the report API caps a response at 5 MB' }],
      [cite('Constraint', TRUE_QUOTE)],
    );

    const result = verifyDraft([record], sources);
    expect(result.rejected[0]?.reason).toBe('unknown-key');
  });

  it('discards a record whose value does not match its grammar', () => {
    const record = recordOf(
      [{ key: 'Ruled-out', value: 'background worker with no reason after it' }],
      [cite('Ruled-out', 'A background worker means a second deploy target, and we are rejecting that.', 'transcript')],
    );

    const result = verifyDraft([record], sources);
    expect(result.rejected[0]?.reason).toBe('format');
    expect(result.rejected[0]?.detail).toContain('alternative | reason');
  });

  it('reports the fabrication before the enum when a record does both', () => {
    const record = recordOf(
      [{ key: 'Blast', value: 'wide' }],
      [cite('Blast', 'a sentence nobody said', 'diff')],
    );

    expect(verifyDraft([record], sources).rejected[0]?.reason).toBe('evidence-not-found');
  });
});

describe('verifyDraft — missing evidence', () => {
  it('discards a record that cites nothing at all', () => {
    const record = recordOf([{ key: 'Limit', value: 'the API caps a response at 5 MB' }], []);

    const result = verifyDraft([record], sources);
    expect(result.rejected[0]?.reason).toBe('evidence-missing');
    expect(result.rejected[0]?.detail).toBe('the record cites nothing');
  });

  it('discards a record whose claim no citation covers', () => {
    const record = recordOf(
      [
        { key: 'Limit', value: 'the report API caps a response at 5 MB' },
        { key: 'Warn', value: 'keep a page under 4 MB' },
      ],
      [cite('Limit', TRUE_QUOTE)],
    );

    const result = verifyDraft([record], sources);
    expect(result.rejected[0]?.reason).toBe('evidence-missing');
    expect(result.rejected[0]?.detail).toContain('"Warn"');
  });

  it('asks for no citation for identity and lifecycle keys', () => {
    const record = recordOf(
      [
        { key: 'Limit', value: 'the report API caps a response at 5 MB' },
        { key: 'Record-Id', value: 'r-3d91c7' },
        { key: 'Provenance', value: 'authored' },
      ],
      [cite('Limit', TRUE_QUOTE)],
    );

    expect(verifyDraft([record], sources).rejected).toEqual([]);
  });
});

describe('the bounded repair loop', () => {
  const rejectedFrom = (records: DraftRecord[]): RejectedRecord[] =>
    verifyDraft(records, sources).rejected;

  it('stops after MAX_REPAIR_ROUNDS against a generator that never improves', () => {
    const draft = draftOf('draft-fabricated.json');
    const rounds: RepairRound[] = [];
    let attempted = 0;

    // The worst case the bound exists for: a session that returns the same
    // unfindable quote every time. The guard is a tripwire, not a limit -- if it
    // is what ends this loop, the loop is unbounded and the assertion below fails.
    for (let guard = 0; guard < 50; guard += 1) {
      const next = planRepair(attempted, rejectedFrom(draft));
      if (next === null) break;
      rounds.push(next);
      attempted += 1;
    }

    expect(attempted).toBe(MAX_REPAIR_ROUNDS);
    expect(rounds.map((round) => round.round)).toEqual([1, 2]);
    expect(planRepair(MAX_REPAIR_ROUNDS, rejectedFrom(draft))).toBeNull();
  });

  it('plans no round when the draft came back clean', () => {
    expect(planRepair(0, rejectedFrom(draftOf('draft-truthful.json')))).toBeNull();
    expect(planRepair(0, [])).toBeNull();
  });

  it('feeds back the reason, the record, and what to do about it', () => {
    const prompt = buildRepairFeedback(rejectedFrom(draftOf('draft-fabricated.json')));

    expect(prompt).toContain('evidence-not-found');
    expect(prompt).toContain('Limit: the export must finish inside 30 seconds');
    expect(prompt).toContain('character for character');
    expect(prompt).toContain('a missing record is better than a false one');
    expect(prompt).toContain('do not weaken a quote to make it match');
  });

  it('tells a session with a groundless Ruled-out what would fix it', () => {
    const prompt = buildRepairFeedback(rejectedFrom(draftOf('draft-ruled-out-mention.json')));

    expect(prompt).toContain('ruled-out-no-rejection');
    expect(prompt).toContain('where the alternative was actually turned down');
  });

  it('has nothing to say when nothing was rejected', () => {
    expect(buildRepairFeedback([])).toBe('');
  });

  it('builds the same feedback byte for byte on every call', () => {
    const rejected = rejectedFrom(draftOf('draft-fabricated.json'));
    expect(buildRepairFeedback(rejected)).toBe(buildRepairFeedback(rejected));
  });
});

describe('commitlore harvest-verify', () => {
  const run = (options: Parameters<typeof runHarvestVerify>[0]) =>
    runHarvestVerify({ transcript: TRANSCRIPT_FILE, diff: DIFF_FILE, ...options });

  it('prints the survivors and the reasons, and exits 0', () => {
    const outcome = run({ draft: fixture('draft-fabricated.json') });

    expect(outcome.exitCode).toBe(0);
    expect(JSON.parse(outcome.stdout)).toEqual({
      records: [
        {
          trailers: [
            { key: 'Warn', value: 'keep a page under 4 MB so the 5 MB cap is never what fails' },
          ],
          evidence: [
            {
              key: 'Warn',
              source: 'transcript',
              quote: 'I page at 2000 rows and stop at 4 MB so the cap is never what fails.',
              locator: 'L5-L5',
            },
          ],
        },
      ],
    });
    expect(outcome.stderr).toContain('discarded record (evidence-not-found)');
  });

  it('exits 0 when every record is discarded — a commit is not ours to fail', () => {
    const outcome = run({ draft: fixture('draft-ruled-out-mention.json') });

    expect(outcome.exitCode).toBe(0);
    expect(JSON.parse(outcome.stdout)).toEqual({ records: [] });
    expect(outcome.stderr).toContain('ruled-out-no-rejection');
  });

  it('emits the full report under --json', () => {
    const outcome = run({ draft: fixture('draft-fabricated.json'), json: true });
    const report = JSON.parse(outcome.stdout) as {
      accepted: DraftRecord[];
      rejected: { reason: string; detail: string; record: DraftRecord }[];
      malformed: { index: number; rule: string; detail: string }[];
    };

    expect(Object.keys(report).sort()).toEqual(['accepted', 'malformed', 'rejected']);
    expect(report.accepted).toHaveLength(1);
    expect(report.malformed).toEqual([]);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0]?.reason).toBe('evidence-not-found');
    expect(report.rejected[0]?.detail).toContain('does not contain');
    expect(report.rejected[0]?.record.trailers[0]).toEqual({
      key: 'Limit',
      value: 'the export must finish inside 30 seconds',
    });
  });

  it('separates what the parser refused from what the verifier refused', () => {
    const outcome = run({ draft: fixture('draft-bad-enum.json'), json: true });
    const report = JSON.parse(outcome.stdout) as {
      accepted: unknown[];
      rejected: unknown[];
      malformed: { rule: string }[];
    };

    expect(report.accepted).toEqual([]);
    expect(report.rejected).toEqual([]);
    expect(report.malformed[0]?.rule).toBe('vocabulary');
    expect(outcome.exitCode).toBe(0);
  });

  it('emits the repair prompt under --repair-prompt', () => {
    const outcome = run({ draft: fixture('draft-fabricated.json'), repairPrompt: true });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('# CommitLore harvest — repair');
    expect(outcome.stdout).toContain('evidence-not-found');
    expect(outcome.stdout).not.toContain('"records"');
  });

  it('writes to --out instead of stdout', () => {
    const out = join(workspace, 'verified.json');
    const outcome = run({ draft: fixture('draft-truthful.json'), out });

    expect(outcome.stdout).toBe('');
    expect(JSON.parse(readFileSync(out, 'utf8')).records).toHaveLength(1);
  });

  it('fails with one line and no stack trace on a draft that is not JSON', () => {
    const outcome = run({ draft: fixture('draft-broken.json') });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain('commitlore: draft is not valid JSON');
    expect(outcome.stderr).not.toMatch(/\n\s+at /);
    expect(outcome.stderr.split('\n').filter((line) => line !== '')).toHaveLength(1);
  });

  it('fails on a source it was told to read but cannot', () => {
    const outcome = run({
      draft: fixture('draft-truthful.json'),
      transcript: join(workspace, 'nope.txt'),
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('cannot read --transcript');
    expect(outcome.stderr).not.toMatch(/\n\s+at /);
  });

  it('refuses to verify against sources it was not given', () => {
    expect(runHarvestVerify({ diff: DIFF_FILE, transcript: TRANSCRIPT_FILE }).exitCode).toBe(2);
    expect(runHarvestVerify({ draft: fixture('draft-truthful.json') }).stderr).toContain(
      'missing --transcript',
    );
  });

  /**
   * #329: a draft that is prose rather than the contract's JSON object was
   * reported as a missing transcript, and the transcript was not the problem.
   * The reporter went looking for a file they did not need yet, for a draft that
   * was never going to parse -- twice, before the real message appeared.
   *
   * The failure it hides is worth the ordering: a session that emitted prose
   * believed it had staged records. Nothing contradicts that belief until
   * somebody verifies, and the first thing they hear should be what is wrong.
   */
  it('says the draft is not a draft before asking for inputs it has not been given', () => {
    const prose = join(workspace, 'prose.txt');
    writeFileSync(prose, 'CommitLore reviewed the change and found two records.\n');

    const outcome = runHarvestVerify({ draft: prose });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('not valid JSON');
    expect(outcome.stderr, 'the transcript is not what is wrong here').not.toContain(
      'missing --transcript',
    );
  });

  it('still reports a missing transcript when the draft is fine', () => {
    // The ordering change must not swallow the usage error it moved behind.
    const outcome = runHarvestVerify({ draft: fixture('draft-truthful.json') });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('missing --transcript');
  });

  it('reports an unreadable draft before a missing transcript', () => {
    const outcome = runHarvestVerify({ draft: join(workspace, 'absent.json') });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stderr).toContain('cannot read --draft');
    expect(outcome.stderr).not.toContain('missing --transcript');
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
        [
          'harvest-verify',
          '--draft',
          fixture('draft-truthful.json'),
          '--transcript',
          TRANSCRIPT_FILE,
          '--diff',
          DIFF_FILE,
        ],
        { from: 'user' },
      );
    } finally {
      process.stdout.write = write;
      process.exitCode = previousExitCode;
    }

    expect(JSON.parse(chunks.join('')).records).toHaveLength(1);
  });
});

describe('against T-403 output', () => {
  const harvestFixture = (name: string): string => join(HARVEST_FIXTURES, name);
  const readHarvest = (name: string): string => readFileSync(harvestFixture(name), 'utf8');

  it('verifies the draft T-403 calls well-formed against the sources it was harvested from', () => {
    const result = verifyDraft(parseDraft(readHarvest('draft-valid.json')).records, {
      transcript: readHarvest('session-transcript.txt'),
      diff: readHarvest('staged.diff'),
    });

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });

  it('discards that same draft when the sources are somebody else’s', () => {
    const result = verifyDraft(parseDraft(readHarvest('draft-valid.json')).records, sources);

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.reason).toBe('evidence-not-found');
  });
});
