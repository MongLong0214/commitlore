import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  READ_SIDE_POPULATION,
  READ_SIDE_SOURCE,
  REDUCTION_PAIRS,
  SHIPPED_ROUTE,
  breakEvenAgainst,
  measureTokenLedger,
  priceCaptures,
  scanVerifyModules,
  statsOf,
  tokensFor,
} from '../bench/deterministic/ledger.ts';
import { LEDGER_SCOPE_SENTENCE, renderDeterministicReport } from '../bench/deterministic/report.ts';
import type { LedgerReadRoute, RowBase, TokenLedgerRow } from '../bench/deterministic/types.ts';
import { createTestRepo } from './git-fixtures.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..');

const BASE: RowBase = {
  schema_version: 1,
  harness_commit: '0'.repeat(40),
  harness_digest: '1'.repeat(40),
  dist_digest: 'a'.repeat(64),
  measured_at: '2026-08-01T00:00:00.000Z',
  machine: {
    platform: 'test',
    release: 'test',
    arch: 'test',
    cpu: 'test',
    logical_cpus: 1,
    memory_bytes: 1,
    node: 'v22.0.0',
    git: 'git version 2.0.0',
  },
};

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' });

const route = (over: Partial<LedgerReadRoute> = {}): LedgerReadRoute => ({
  route: 'git-log-path-budgeted',
  budget_tokens: 800,
  evaluation_paths: 100,
  delivered_tokens: 100_000,
  tokens_per_read: 1000,
  path_recall: 0.5,
  recovered: 50,
  path_active_total: 100,
  ...over,
});

/**
 * A history with two record-bearing single-parent commits, one record-free
 * commit, one merge carrying a record and one root commit carrying one — the
 * cases the write side has to separate, known here by construction rather than
 * read off whatever this repository's history happens to contain.
 */
const createHistory = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-ledger-'));
  const repo = createTestRepo({ path: join(dir, 'repo') });
  const write = (name: string, body: string): void => writeFileSync(join(repo, name), `${body}\n`);
  const commit = (message: string): void => {
    git(repo, ['add', '--all']);
    git(repo, ['commit', '--quiet', '--no-verify', '-m', message]);
  };

  write('a.txt', 'alpha');
  commit('first record\n\nRecord-Id: r-ledgeralpha\nCertainty: firm\n');
  write('b.txt', 'beta');
  commit('no record here');
  git(repo, ['checkout', '--quiet', '-b', 'side']);
  write('c.txt', 'gamma');
  commit('second record\n\nRecord-Id: r-ledgerbeta\nCertainty: firm\n');
  git(repo, ['checkout', '--quiet', '-']);
  write('d.txt', 'delta');
  commit('third record\n\nRecord-Id: r-ledgergamma\nCertainty: firm\n');
  git(repo, [
    'merge',
    '--quiet',
    '--no-ff',
    'side',
    '-m',
    'merge carrying a record\n\nRecord-Id: r-ledgermerge\nCertainty: firm\n',
  ]);
  return dir;
};

let historyDir: string;
let row: TokenLedgerRow;

beforeAll(() => {
  historyDir = createHistory();
  row = measureTokenLedger(BASE, REPO_ROOT, 'HEAD');
});

afterAll(() => {
  rmSync(historyDir, { recursive: true, force: true });
});

describe('token ledger — the unit', () => {
  it('counts tokens with the product constant, rounding up', () => {
    expect(tokensFor('')).toBe(0);
    expect(tokensFor('abc')).toBe(1);
    expect(tokensFor('abcd')).toBe(1);
    expect(tokensFor('abcde')).toBe(2);
  });

  it('reports a distribution rather than a mean alone', () => {
    const stats = statsOf([1, 2, 3, 4, 100]);
    expect(stats).toMatchObject({ count: 5, total: 110, min: 1, max: 100 });
    expect(stats.p50).toBe(3);
    expect(stats.mean).toBe(22);
  });

  it('has no value for an empty sample rather than a NaN', () => {
    expect(statsOf([])).toMatchObject({ count: 0, total: 0, mean: 0 });
  });
});

describe('token ledger — break-even refusals', () => {
  const shipped = route({ route: 'commitlore', tokens_per_read: 500, evaluation_paths: 100 });

  it('divides the write floor by the per-read saving', () => {
    const result = breakEvenAgainst(route({ tokens_per_read: 600 }), shipped, 10_000, 4_000);
    expect(result.exists).toBe(true);
    expect(result.saving_tokens_per_read).toBe(100);
    expect(result.reads_with_diff).toBe(100);
    expect(result.reads_scaffold_only).toBe(40);
    expect(result.passes_with_diff).toBe(1);
  });

  /**
   * The scaffold-only floor is the smaller numerator, so it must always break
   * even at or before the with-diff one. A future refactor that swapped the two
   * arguments would still typecheck and would flatter the product.
   */
  it('never reports the scaffold-only floor as the slower of the two', () => {
    const result = breakEvenAgainst(route({ tokens_per_read: 600 }), shipped, 10_000, 4_000);
    expect(result.reads_scaffold_only ?? 0).toBeLessThanOrEqual(result.reads_with_diff ?? 0);
  });

  it('refuses a break-even against a route that delivers nothing', () => {
    const result = breakEvenAgainst(
      route({ route: 'code-only', tokens_per_read: 0, delivered_tokens: 0, path_recall: 0 }),
      shipped,
      10_000,
      4_000,
    );
    expect(result.exists).toBe(false);
    expect(result.reads_with_diff).toBeNull();
    expect(result.reads_scaffold_only).toBeNull();
    expect(result.undefined_because).toContain('net token cost');
  });

  it('refuses a break-even against a route that is already cheaper', () => {
    const result = breakEvenAgainst(route({ tokens_per_read: 400 }), shipped, 10_000, 4_000);
    expect(result.exists).toBe(false);
    expect(result.saving_tokens_per_read).toBeLessThan(0);
    expect(result.undefined_because).toContain('no saving to amortize');
  });

  it('states the reduction against the comparator it was divided by', () => {
    const result = breakEvenAgainst(route({ tokens_per_read: 1000 }), shipped, 10_000, 4_000);
    expect(result.comparator_tokens_per_read).toBe(1000);
    expect(result.reduction_against_comparator).toBeCloseTo(0.5, 12);
  });
});

describe('token ledger — verify has no model to call', () => {
  it('scans the built verify graph and finds no network client', () => {
    const scan = scanVerifyModules(join(REPO_ROOT, 'dist'), [
      'core/capture-verify.js',
      'core/harvest-verify.js',
    ]);
    expect(scan.modules).toBeGreaterThan(1);
    expect(scan.references).toBe(0);
  });

  it('finds a network client when one is there, so the zero above is earned', () => {
    const dir = mkdtempSync(join(tmpdir(), 'commitlore-ledger-scan-'));
    writeFileSync(join(dir, 'entry.js'), "import { get } from './leaf.js';\nexport { get };\n");
    writeFileSync(join(dir, 'leaf.js'), "import https from 'node:https';\nexport const get = () => https;\n");
    try {
      const scan = scanVerifyModules(dir, ['entry.js']);
      expect(scan.modules).toBe(2);
      expect(scan.references).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('token ledger — the write side over a known history', () => {
  it('prices single-parent record-bearing commits and counts the rest by reason', () => {
    const priced = priceCaptures(join(historyDir, 'repo'), 'HEAD');
    expect(priced.commitsExamined).toBe(5);
    expect(priced.mergeCommits).toBe(1);
    // The root commit carries a record and has no parent to diff against; the
    // merge carries one and this repository's own merges carry none by design.
    // Both are excluded and both are counted, so the exclusion is auditable.
    expect(priced.captures).toBe(2);
    expect(priced.recordsMeasured).toBe(2);
    expect(priced.recordsOnRoots).toBe(1);
    expect(priced.recordsOnMerges).toBe(1);
  });

  it('never prices a capture below the scaffold, because a prompt contains it', () => {
    const priced = priceCaptures(join(historyDir, 'repo'), 'HEAD');
    expect(priced.promptTokens.min).toBeGreaterThanOrEqual(tokensFor(priced.scaffold));
    expect(priced.promptTokens.total).toBeGreaterThanOrEqual(
      tokensFor(priced.scaffold) * priced.captures,
    );
  });

  it('refuses a history with nothing to price rather than reporting a zero cost', () => {
    const empty = mkdtempSync(join(tmpdir(), 'commitlore-ledger-empty-'));
    const repo = createTestRepo({ path: join(empty, 'repo') });
    writeFileSync(join(repo, 'a.txt'), 'alpha\n');
    git(repo, ['add', '--all']);
    git(repo, ['commit', '--quiet', '--no-verify', '-m', 'no record anywhere']);
    try {
      expect(() => priceCaptures(repo, 'HEAD')).toThrow(/no record-bearing single-parent commit/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('token ledger — the measured row', () => {
  it('prices this repository and agrees with its own distribution counts', () => {
    expect(row.metric).toBe('token_ledger');
    expect(row.captures_measured).toBeGreaterThan(0);
    expect(row.records_on_measured_captures).toBeGreaterThanOrEqual(row.captures_measured);
    expect(row.prompt_tokens.count).toBe(row.captures_measured);
    expect(row.diff_tokens.count).toBe(row.captures_measured);
  });

  it('reports the scaffold as the product prints it, not as a subtraction', () => {
    expect(row.prompt_scaffold_tokens).toBe(Math.ceil(row.prompt_scaffold_chars / row.chars_per_token));
    expect(row.prompt_scaffold_bytes).toBeGreaterThanOrEqual(row.prompt_scaffold_chars);
  });

  /**
   * The whole claim the ledger makes rests on this inequality. A prompt is
   * scaffold plus diff, so no capture can price below the scaffold, and the
   * scaffold-only floor can never exceed the with-diff one.
   */
  it('keeps the scaffold-only floor at or below the with-diff floor', () => {
    expect(row.write_floor_tokens_scaffold_only).toBeLessThanOrEqual(row.write_floor_tokens_with_diff);
    expect(row.prompt_tokens.min).toBeGreaterThanOrEqual(row.prompt_scaffold_tokens);
  });

  it('names the write terms it did not measure on the row itself', () => {
    expect(row.unmeasured_write_terms.length).toBe(3);
    expect(row.unmeasured_write_terms.join(' ')).toContain('session-transcript');
    expect(row.unmeasured_write_terms.join(' ')).toContain('drafting-output');
  });

  it('carries the provenance of the delivery run it derived the read side from', () => {
    expect(row.read_source.file).toBe(READ_SIDE_SOURCE);
    expect(row.read_source.population).toBe(READ_SIDE_POPULATION);
    expect(row.read_source.harness_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(row.read_source.dist_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('derives tokens per read as an identity on the source row', () => {
    const source = readFileSync(join(REPO_ROOT, READ_SIDE_SOURCE), 'utf8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            population: string;
            route: string;
            delivered_tokens: number;
            evaluation_paths: number;
          },
      );
    for (const read of row.reads) {
      const origin = source.find(
        (entry) => entry.population === READ_SIDE_POPULATION && entry.route === read.route,
      );
      expect(origin).toBeDefined();
      expect(read.tokens_per_read).toBe(
        (origin?.delivered_tokens ?? 0) / (origin?.evaluation_paths ?? 1),
      );
    }
  });

  it('compares every route except the shipped one against the shipped one', () => {
    expect(row.break_even.map((entry) => entry.comparator)).not.toContain(SHIPPED_ROUTE);
    expect(row.break_even.length).toBe(row.reads.length - 1);
  });

  it('reports every registered reduction pair, including the unfavourable ones', () => {
    expect(row.reductions.length).toBe(REDUCTION_PAIRS.length);
    // A reduction against a route that spends nothing is a division by zero,
    // not a large percentage. It has no value and is not given one.
    const nothing = row.reductions.find((entry) => entry.denominator === 'code-only');
    expect(nothing?.denominator_tokens_per_read).toBe(0);
    expect(nothing?.reduction).toBeNull();
    expect(nothing?.ratio).toBeNull();
    const trade = row.reductions.find((entry) => entry.denominator === 'git-log-path');
    expect(trade?.subject_recall).toBeLessThan(trade?.denominator_recall ?? 0);
  });

  it('carries each reduction denominator on the same object as its number', () => {
    for (const entry of row.reductions) {
      expect(entry.denominator_tokens_per_read).toBeGreaterThanOrEqual(0);
      if (entry.reduction === null) {
        expect(entry.denominator_tokens_per_read).toBe(0);
        continue;
      }
      expect(entry.reduction).toBeCloseTo(
        1 - entry.subject_tokens_per_read / entry.denominator_tokens_per_read,
        12,
      );
    }
  });
});

describe('token ledger — the report', () => {
  it('leads with the floor, not with the break-even', () => {
    const report = renderDeterministicReport([row]);
    expect(report).toContain(LEDGER_SCOPE_SENTENCE);
    expect(report).toContain('lower bound on the true one');
  });

  it('prints a refusal rather than a number where no break-even exists', () => {
    const report = renderDeterministicReport([row]);
    const codeOnly = row.break_even.find((entry) => entry.comparator === 'code-only');
    expect(codeOnly?.exists).toBe(false);
    expect(report).toContain('**none**');
    expect(report).toContain('net token cost forever');
  });

  it('puts each comparator recall beside its token column', () => {
    const report = renderDeterministicReport([row]);
    expect(report).toContain('| comparator | its tokens/read | saving/read | reduction |');
    expect(report).toContain('its recall |');
  });

  it('never prints a reduction without the denominator it was divided by', () => {
    const report = renderDeterministicReport([row]);
    for (const entry of row.reductions) {
      expect(report).toContain(`| \`${entry.subject}\` | \`${entry.denominator}\` |`);
    }
    expect(report).toContain('the denominator route, its token count and its recall are on the same line');
    expect(report).toContain('records counts and not sets');
  });
});
