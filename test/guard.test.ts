/**
 * T-405 acceptance: `commitlore guard`, the route SPEC §5 assigns to
 * `Ruled-out:` and the one place CommitLore's central claim is executable.
 *
 * The ticket AC has two halves and neither is optional:
 *
 *   1. A re-proposal is flagged — including one worded differently from the
 *      record, which is the only interesting case. An agent that repeats a
 *      rejected idea does not repeat the sentence.
 *   2. Ten unrelated proposals produce fewer than one false positive. This
 *      suite measures the margin rather than asserting a boolean, because a
 *      hook that fires on every edit is uninstalled the day it cries wolf, and
 *      "passes today" is not the same as "has room".
 *
 * Everything else here pins a property the matcher inherits from
 * `core/query.ts` and could silently lose: the path scope, the lifecycle fold
 * (a rejection that was superseded must not block anything), the `--at`
 * replay, and byte-identical output for identical input.
 *
 * Fixtures live in `spec/fixtures/guard/`; the `redis-cache` record is the
 * AnnalsBench re-encounter task verbatim (T-701), so this suite and the
 * benchmark are arguing about the same rejection.
 *
 * Every repository is built under `os.tmpdir()`.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { register } from '../src/commands/guard.js';
import { execGitOrThrow } from '../src/core/git.js';
import { DEFAULT_THRESHOLD, guard } from '../src/core/guard.js';
import { runQuery } from '../src/core/query.js';
import { RECORD_ID_RE } from '../src/core/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ROOT = fileURLToPath(new URL('../spec/fixtures/guard/', import.meta.url));

interface RecordFixture {
  id: string;
  committedAt: string;
  files: Record<string, string>;
  message: string;
}

interface ReproposalFixture {
  id: string;
  text: string;
  expectRecordId: string;
  expectAlternative: string;
  why: string;
}

interface UnrelatedFixture {
  id: string;
  text: string;
}

const readFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(join(FIXTURE_ROOT, name), 'utf8')) as T;

interface AdjacentFixture {
  id: string;
  text: string;
  expectFlag: boolean;
  why: string;
}

interface DogfoodFixture {
  clean: { id: string; text: string; was: number }[];
  flagged: { id: string; text: string; expectRecordId: string; expectAlternative: string }[];
}

const { records, precisionRecords } = readFixture<{
  records: RecordFixture[];
  precisionRecords: RecordFixture[];
}>('records.json');
const { reproposals, unrelated, adjacent, dogfood } = readFixture<{
  reproposals: ReproposalFixture[];
  unrelated: UnrelatedFixture[];
  adjacent: AdjacentFixture[];
  dogfood: DogfoodFixture;
}>('proposals.json');

const fixture = (id: string): ReproposalFixture => {
  const found = reproposals.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no reproposal fixture named ${id}`);
  return found;
};

/** After every seeded record, before any test's evaluation instant. */
const NOW = new Date('2026-02-01T00:00:00Z');

/** Between `postgres-queue` and the `queue-outgrew` commit that supersedes it. */
const BEFORE_SUPERSESSION = new Date('2026-01-10T00:00:00Z');

// ---------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------

/** Config pinned per invocation: the developer's global git config is not input. */
const GIT_CONFIG = [
  '-c',
  'user.name=CommitLore Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.hooksPath=/dev/null',
];

const temporaries: string[] = [];

afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

/**
 * `--cleanup=verbatim` keeps the folded `Ruled-out:` continuations intact:
 * git's default cleanup would reflow the paragraph and the fixture would stop
 * being the bench fixture.
 */
const commitFixture = (dir: string, record: RecordFixture): void => {
  for (const [path, contents] of Object.entries(record.files)) {
    const absolute = join(dir, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${contents}\n`);
  }

  const previous = {
    author: process.env['GIT_AUTHOR_DATE'],
    committer: process.env['GIT_COMMITTER_DATE'],
  };
  process.env['GIT_AUTHOR_DATE'] = record.committedAt;
  process.env['GIT_COMMITTER_DATE'] = record.committedAt;
  try {
    execGitOrThrow([...GIT_CONFIG, 'add', '-A'], { cwd: dir });
    execGitOrThrow(
      [...GIT_CONFIG, 'commit', '-q', '--no-verify', '--cleanup=verbatim', '-F', '-'],
      { cwd: dir, stdin: record.message },
    );
  } finally {
    if (previous.author === undefined) delete process.env['GIT_AUTHOR_DATE'];
    else process.env['GIT_AUTHOR_DATE'] = previous.author;
    if (previous.committer === undefined) delete process.env['GIT_COMMITTER_DATE'];
    else process.env['GIT_COMMITTER_DATE'] = previous.committer;
  }
};

const makeRepo = (seed: readonly RecordFixture[]): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-guard-'));
  temporaries.push(dir);
  execGitOrThrow(['init', '-q', '-b', 'main', '--template=', '.'], { cwd: dir });
  for (const record of seed) commitFixture(dir, record);
  return dir;
};

let repo = '';

beforeAll(() => {
  repo = makeRepo(records);
});

const check = (proposal: string, overrides: Partial<Parameters<typeof guard>[0]> = {}) =>
  guard({ proposal, cwd: repo, at: NOW, ...overrides });

/** The strongest score any seeded alternative gives this proposal. */
const topScore = (proposal: string): number => {
  const scores = check(proposal, { threshold: 0 }).map((match) => match.score);
  return scores.length === 0 ? 0 : Math.max(...scores);
};

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

describe('guard flags a re-proposal', () => {
  it('flags the rejected product when the proposal names it', () => {
    const { text, expectRecordId, expectAlternative } = fixture('redis-named');
    const [match, ...rest] = check(text);

    expect(match).toBeDefined();
    expect(rest).toEqual([]);
    expect(match?.recordId).toBe(expectRecordId);
    expect(match?.alternative).toBe(expectAlternative);
    expect(match?.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
  });

  it('carries the rejection reason, not just the fact of rejection', () => {
    const [match] = check(fixture('redis-named').text);
    expect(match?.reason).toBe(
      'ops refuses another stateful dependency for a v1, and the session payload is under 4KB',
    );
  });

  it('names the signal that fired, so the flag can be argued with', () => {
    const [match] = check(fixture('redis-named').text);
    expect(match?.signals).toContain('keyword:redis');
    expect(match?.signals.some((signal) => signal.startsWith('jaccard:'))).toBe(true);
  });

  it('flags a re-proposal worded differently from the record', () => {
    const { text, expectAlternative } = fixture('redis-reworded');
    const [match] = check(text);

    expect(match?.alternative).toBe(expectAlternative);
    // One shared word out of six: Jaccard is 0.17 and contributes 0.08. The
    // distinctive keyword is what carries this, which is the whole design.
    expect(match?.score).toBeCloseTo(0.58, 2);
  });

  it('reports the sha the rejection was recorded on', () => {
    const [match] = check(fixture('redis-named').text);
    const head = execGitOrThrow(['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo }).trim();
    expect(match?.sha).toBe(head);
  });

  it('flags a re-proposal that names the alternative inside a longer sentence', () => {
    const { text, expectRecordId, expectAlternative } = fixture('redis-session-store');
    const [match] = check(text);

    expect(match?.recordId).toBe(expectRecordId);
    expect(match?.alternative).toBe(expectAlternative);
    expect(match?.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
  });

  it('returns nothing for an empty proposal', () => {
    expect(check('')).toEqual([]);
    expect(check('   \n  ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The AC: false positives
// ---------------------------------------------------------------------------

describe('guard stays quiet on unrelated proposals', () => {
  it('produces fewer than one false positive across ten unrelated proposals', () => {
    const measured = unrelated.map((entry) => ({ id: entry.id, score: topScore(entry.text) }));
    const flagged = measured.filter((entry) => entry.score >= DEFAULT_THRESHOLD);

    const table = measured
      .map(
        (entry) =>
          `  ${entry.id.padEnd(24)} ${entry.score === 0 ? 'uncorroborated' : entry.score.toFixed(4)}`,
      )
      .join('\n');
    // The AC is a measurement, so the measurement is printed. `uncorroborated`
    // is not a low score — it is a candidate that never reached scoring,
    // because nothing in it corroborated a flag. A margin that quietly erodes
    // over a year of weight edits is the failure mode a pass/fail assertion
    // cannot show.
    process.stderr.write(
      `\nfalse positives against the seeded corpus (threshold ${DEFAULT_THRESHOLD}):\n${table}\n\n`,
    );

    expect(flagged).toEqual([]);
  });

  it('leaves the noise floor well below the cheapest true positive', () => {
    const worst = Math.max(...unrelated.map((entry) => topScore(entry.text)));
    const cheapest = Math.min(
      ...reproposals
        .filter((entry) => entry.id !== 'rabbitmq-broker' && entry.id !== 'ssr-marketing')
        .map((entry) => topScore(entry.text)),
    );
    expect(worst).toBeLessThan(DEFAULT_THRESHOLD);
    expect(cheapest - worst).toBeGreaterThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// The real corpus
// ---------------------------------------------------------------------------

/**
 * Guard against CommitLore's own history.
 *
 * The seeded repository above has four rejections. That is enough to check the
 * mechanics and far too few to check discrimination: with four alternatives
 * every token is rare, so a matcher that cannot tell a common word from a rare
 * one passes anyway. It did — and then flagged four of ten ordinary proposals
 * on this repository, whose history carries dozens of rejections and therefore
 * has words like `rename`, `document`, `readme` and `regex` spread across many
 * of them.
 *
 * So this suite runs on the real thing. It is a regression fixture in the
 * strict sense: the four scores in `was` are what the flat keyword rule
 * produced, and if a later change to the weights, the threshold or
 * `GENERIC_TERMS` brings them back, this fails.
 *
 * `noIndex` throughout — the answers are identical (asserted below), and a test
 * has no business writing a cache into the repository it is measuring.
 */
describe('guard against this repository', () => {
  const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

  const checkRepo = (proposal: string) =>
    guard({ proposal, cwd: REPO_ROOT, noIndex: true });

  it('has a rejection corpus large enough for the measurement to mean anything', () => {
    // If this repository ever stops recording rejections, the suite below is
    // measuring an empty corpus and passing for the wrong reason.
    const corpus = runQuery({ cwd: REPO_ROOT, keys: ['Ruled-out'], noIndex: true });
    expect(corpus.records.length).toBeGreaterThanOrEqual(15);
  });

  for (const entry of dogfood.clean) {
    it(`does not flag: ${entry.text}`, () => {
      const matches = checkRepo(entry.text);
      expect(matches.map((match) => `${match.score} ${match.alternative}`)).toEqual([]);
    });
  }

  for (const entry of dogfood.flagged) {
    it(`flags: ${entry.text}`, () => {
      const [match] = checkRepo(entry.text);
      expect(match?.recordId).toBe(entry.expectRecordId);
      expect(match?.alternative).toBe(entry.expectAlternative);
      expect(match?.reason).not.toBe('');
      expect(match?.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    });
  }

  it('answers the same with the index as without', () => {
    const entry = dogfood.flagged[0];
    expect(entry).toBeDefined();
    const scanned = guard({ proposal: entry?.text ?? '', cwd: REPO_ROOT, noIndex: true });
    const indexed = guard({ proposal: entry?.text ?? '', cwd: REPO_ROOT });
    expect(JSON.stringify(indexed)).toBe(JSON.stringify(scanned));
  });
});

describe('guard on an adjacent proposal', () => {
  let precision = '';

  beforeAll(() => {
    precision = makeRepo(precisionRecords);
  });

  /**
   * The unrelated ten measure the far miss. This measures the near one: the
   * same record, one shared word, and the shared word is generic. If the
   * matcher cannot tell "wrap the writes in a transaction" from "pgbouncer in
   * transaction mode", `GENERIC_TERMS` has stopped doing its job and the
   * headroom in the table above is an accident of vocabulary.
   */
  for (const entry of adjacent) {
    it(`${entry.expectFlag ? 'flags' : 'does not flag'}: ${entry.why}`, () => {
      const scored = guard({ proposal: entry.text, cwd: precision, at: NOW, threshold: 0 });
      const best = Math.max(0, ...scored.map((match) => match.score));
      expect(best >= DEFAULT_THRESHOLD).toBe(entry.expectFlag);
    });
  }
});

// ---------------------------------------------------------------------------
// Properties inherited from core/query.ts
// ---------------------------------------------------------------------------

describe('path scope', () => {
  it('flags a proposal against the path that recorded the rejection', () => {
    const { text, expectRecordId } = fixture('ssr-marketing');
    expect(check(text, { paths: ['docs'] })[0]?.recordId).toBe(expectRecordId);
  });

  it('does not flag it from a path the record never touched', () => {
    expect(check(fixture('ssr-marketing').text, { paths: ['src'] })).toEqual([]);
  });

  it('an unscoped check sees every path', () => {
    expect(check(fixture('ssr-marketing').text)[0]?.recordId).toBe('r-3f0d81');
  });
});

describe('lifecycle', () => {
  it('does not flag a rejection that was superseded', () => {
    expect(check(fixture('rabbitmq-broker').text)).toEqual([]);
  });

  it('flags it when replayed before the supersession landed', () => {
    const { text, expectRecordId, expectAlternative } = fixture('rabbitmq-broker');
    const [match] = check(text, { at: BEFORE_SUPERSESSION });

    expect(match?.recordId).toBe(expectRecordId);
    expect(match?.alternative).toBe(expectAlternative);
  });
});

// ---------------------------------------------------------------------------
// Record-Id
// ---------------------------------------------------------------------------

describe('Record-Id reference', () => {
  it('flags every alternative the named record ruled out', () => {
    const matches = check(fixture('record-id-reference').text);
    expect(matches.map((match) => match.alternative).sort()).toEqual([
      'memcached sidecar',
      'shared Redis cache',
    ]);
    for (const match of matches) {
      expect(match.signals).toContain('record-id:r-7c1a45');
      expect(match.score).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('scans the same grammar the protocol defines', () => {
    // The scanner in core/guard.ts carries its own unanchored copy of
    // `RECORD_ID_RE`. Every id the protocol accepts must be one it finds.
    for (const record of records) {
      const id = /Record-Id: (\S+)/.exec(record.message)?.[1] ?? '';
      expect(RECORD_ID_RE.test(id)).toBe(true);
    }
    expect(check('revisit r-7c1a45', { threshold: 0.6 })).toHaveLength(2);
    expect(check('per r-3f0d81 we should reconsider', { threshold: 0.6 })).toHaveLength(1);
  });

  it('finds an id the proposal shouted', () => {
    const matches = check('REVISIT R-7C1A45 PLEASE', { threshold: 0.6 });
    expect(matches).toHaveLength(2);
    expect(matches[0]?.signals).toContain('record-id:r-7c1a45');
  });

  it('ignores a reference to a record that ruled nothing out', () => {
    // r-bb3344 exists and carries no `Ruled-out:`, so naming it flags nothing.
    expect(check('as decided in r-bb3344, move the jobs')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Threshold and determinism
// ---------------------------------------------------------------------------

describe('threshold', () => {
  it('changes the answer', () => {
    const { text } = fixture('redis-reworded');
    expect(check(text, { threshold: 0.35 })).toHaveLength(1);
    expect(check(text, { threshold: 0.7 })).toEqual([]);
  });

  it('is a minimum, not a value to exceed', () => {
    const [match] = check(fixture('redis-reworded').text);
    const exact = match?.score ?? 0;
    expect(check(fixture('redis-reworded').text, { threshold: exact })).toHaveLength(1);
  });
});

describe('determinism', () => {
  it('returns identical matches for identical input', () => {
    const { text } = fixture('redis-named');
    expect(JSON.stringify(check(text))).toBe(JSON.stringify(check(text)));
  });

  it('orders several matches totally', () => {
    const matches = check(fixture('record-id-reference').text);
    const scores = matches.map((match) => match.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

// ---------------------------------------------------------------------------
// Malformed records
// ---------------------------------------------------------------------------

describe('a Ruled-out: with no separator', () => {
  let malformed = '';

  beforeAll(() => {
    malformed = makeRepo([
      {
        id: 'malformed',
        committedAt: '2026-01-05T09:00:00Z',
        files: { 'src/cache.ts': 'export const noop = (): void => {};' },
        message:
          'Keep the cache in process\n\nRuled-out: shared Redis cache\nRecord-Id: r-ffee00\n' +
          'Provenance: authored\nCommitLore-Version: 2.0.0\n',
      },
    ]);
  });

  it('still guards, and says the record is malformed', () => {
    const [match] = guard({ proposal: 'add Redis for the cache', cwd: malformed, at: NOW });
    // SPEC §3.1 requires the separator and `commitlore validate` reports its
    // absence. Refusing to match would turn a formatting slip into a silent
    // loss of the protection the record was written to provide.
    expect(match?.alternative).toBe('shared Redis cache');
    expect(match?.reason).toBe('');
    expect(match?.signals).toContain('malformed:no-separator');
  });
});

// ---------------------------------------------------------------------------
// The command layer
// ---------------------------------------------------------------------------

interface CliRun {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Runs the command as registered, without touching `src/cli.ts`: `register` is
 * the whole contract this file owns.
 */
const runCommand = (dir: string, argv: string[]): CliRun => {
  const program = new Command();
  program.exitOverride();
  register(program);

  const out: string[] = [];
  const err: string[] = [];
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  const previousCwd = process.cwd();
  const previousExitCode = process.exitCode;

  process.exitCode = 0;
  try {
    process.chdir(dir);
    process.stdout.write = ((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => {
      err.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    program.parse(argv, { from: 'user' });
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
    process.chdir(previousCwd);
  }

  const code = Number(process.exitCode ?? 0);
  process.exitCode = previousExitCode;
  return { stdout: out.join(''), stderr: err.join(''), code };
};

const AT = ['--at', NOW.toISOString()];

describe('commitlore guard', () => {
  it('exits 2 and writes the reason to stderr on a match', () => {
    const run = runCommand(repo, ['guard', '--proposal', fixture('redis-named').text, ...AT]);

    expect(run.code).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('ruled out: shared Redis cache');
    expect(run.stderr).toContain('because:   ops refuses another stateful dependency');
    expect(run.stderr).toContain('recorded:  r-7c1a45 in ');
    expect(run.stderr).toContain('keyword:redis');
  });

  it('exits 0 and says nothing at all when nothing matches', () => {
    const run = runCommand(repo, [
      'guard',
      '--proposal',
      unrelated[0]?.text ?? '',
      ...AT,
    ]);

    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe('');
  });

  it('scopes to the paths it is given', () => {
    const scoped = runCommand(repo, [
      'guard',
      '--proposal',
      fixture('ssr-marketing').text,
      ...AT,
      '--',
      'src',
    ]);
    expect(scoped.code).toBe(0);

    const unscoped = runCommand(repo, [
      'guard',
      '--proposal',
      fixture('ssr-marketing').text,
      ...AT,
      '--',
      'docs',
    ]);
    expect(unscoped.code).toBe(2);
  });

  it('emits JSON on stdout, and still exits 2', () => {
    const run = runCommand(repo, [
      'guard',
      '--proposal',
      fixture('redis-named').text,
      ...AT,
      '--json',
    ]);

    expect(run.code).toBe(2);
    expect(JSON.parse(run.stdout)).toEqual({
      command: 'guard',
      at: NOW.toISOString(),
      paths: [],
      threshold: DEFAULT_THRESHOLD,
      matched: true,
      matches: [
        {
          recordId: 'r-7c1a45',
          sha: expect.stringMatching(/^[0-9a-f]{40}$/) as unknown as string,
          alternative: 'shared Redis cache',
          reason:
            'ops refuses another stateful dependency for a v1, and the session payload is under 4KB',
          score: expect.any(Number) as unknown as number,
          signals: expect.arrayContaining(['keyword:redis']) as unknown as string[],
        },
      ],
    });
  });

  it('emits `matched: false` JSON on a clean proposal', () => {
    const run = runCommand(repo, [
      'guard',
      '--proposal',
      unrelated[0]?.text ?? '',
      ...AT,
      '--json',
    ]);
    expect(run.code).toBe(0);
    expect((JSON.parse(run.stdout) as { matched: boolean; matches: unknown[] }).matched).toBe(false);
  });

  it('reads the proposal from a file with @', () => {
    const path = join(repo, 'proposal.txt');
    writeFileSync(path, fixture('redis-named').text);
    const run = runCommand(repo, ['guard', '--proposal', `@${path}`, ...AT]);
    expect(run.code).toBe(2);
    rmSync(path);
  });

  it('honours --threshold', () => {
    const argv = ['guard', '--proposal', fixture('redis-reworded').text, ...AT];
    expect(runCommand(repo, [...argv]).code).toBe(2);
    expect(runCommand(repo, [...argv, '--threshold', '0.7']).code).toBe(0);
  });

  it('exits 1 on a bad threshold, and 1 is not 2', () => {
    const run = runCommand(repo, ['guard', '--proposal', 'x', '--threshold', '7']);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('--threshold is not a number between 0 and 1');
  });

  it('exits 1 on a bad --at', () => {
    const run = runCommand(repo, ['guard', '--proposal', 'x', '--at', 'yesterday']);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('--at is not a valid ISO 8601 instant');
  });

  it('warns that renames are not followed for several paths', () => {
    const run = runCommand(repo, ['guard', '--proposal', 'x', ...AT, '--', 'src', 'docs']);
    expect(run.stderr).toContain('renames are not followed for several paths');
  });

  it('produces byte-identical output for identical input', () => {
    const argv = ['guard', '--proposal', fixture('redis-named').text, ...AT, '--json'];
    const first = runCommand(repo, [...argv]);
    const second = runCommand(repo, [...argv]);

    expect(second.stdout).toBe(first.stdout);
    expect(second.stderr).toBe(first.stderr);
    expect(second.code).toBe(first.code);
  });

  it('produces byte-identical text output too', () => {
    const argv = ['guard', '--proposal', fixture('record-id-reference').text, ...AT];
    const first = runCommand(repo, [...argv]);
    const second = runCommand(repo, [...argv]);

    expect(second.stderr).toBe(first.stderr);
    expect(first.stderr.split('\n').length).toBeGreaterThan(4);
  });

  it('answers the same without the index', () => {
    const argv = ['guard', '--proposal', fixture('redis-named').text, ...AT, '--json'];
    const indexed = runCommand(repo, [...argv]);
    const scanned = runCommand(repo, [...argv, '--no-index']);

    expect(scanned.stdout).toBe(indexed.stdout);
    expect(scanned.code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// A last look at the whole match, as a reader would see it
// ---------------------------------------------------------------------------

describe('the flag a user actually reads', () => {
  it('puts the alternative, the reason and the evidence in three lines', () => {
    const run = runCommand(repo, ['guard', '--proposal', fixture('redis-named').text, ...AT]);
    const lines = run.stderr.trimEnd().split('\n');

    expect(lines[0]).toBe('commitlore guard: 1 ruled-out alternative matches this proposal');
    expect(lines[2]).toBe('  ruled out: shared Redis cache');
    expect(lines[3]).toMatch(/^ {2}because: {3}ops refuses another stateful dependency/);
    expect(lines[4]).toMatch(/^ {2}recorded: {2}r-7c1a45 in [0-9a-f]{8} \(score 0\.\d\d; /);
  });
});
