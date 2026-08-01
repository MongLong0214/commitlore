import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCensus, expiryEnd, recordBlocks } from '../bench/deterministic/census.ts';
import {
  DELIVERY_ROUTES,
  deliveredFromInjection,
  deliveredFromLog,
  measureDecisionDelivery,
} from '../bench/deterministic/recovery.ts';
import { DELIVERY_SCOPE_SENTENCE, renderDeterministicReport } from '../bench/deterministic/report.ts';
import type { DecisionDeliveryRow, RowBase } from '../bench/deterministic/types.ts';
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

/** Long enough that `git log --follow` scores the rename as a rename. */
const body = (marker: string): string =>
  Array.from({ length: 40 }, (_, line) => `// ${marker} line ${line}`).join('\n');

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' });

interface Fixture {
  readonly dir: string;
  readonly rows: readonly DecisionDeliveryRow[];
}

const routeRow = (
  rows: readonly DecisionDeliveryRow[],
  route: DecisionDeliveryRow['route'],
  population: DecisionDeliveryRow['population'] = 'authored',
): DecisionDeliveryRow => {
  const row = rows.find((entry) => entry.route === route && entry.population === population);
  if (row === undefined) throw new Error(`no ${population} row for ${route}`);
  return row;
};

/**
 * A repository whose record history exercises every case the metric has to
 * separate: a superseded record, a record reachable only through a rename, a
 * record on a path that is declared generated, and a tracked path with no
 * record at all.
 */
const createFixture = (): Fixture => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-delivery-'));
  const repo = createTestRepo({ path: join(dir, 'repo') });
  const write = (name: string, marker: string): void => {
    writeFileSync(join(repo, name), `${body(marker)}\n`);
  };
  const commit = (message: string): void => {
    git(repo, ['add', '--all']);
    git(repo, ['commit', '--quiet', '--no-verify', '-m', message]);
  };

  write('alpha.ts', 'alpha');
  commit(
    [
      'Scope the alpha reader to one path',
      '',
      'Limit: alpha stays path-scoped',
      'Warn: alpha has a second caller',
      'Record-Id: r-alpha01',
    ].join('\n'),
  );

  write('alpha.ts', 'alpha revised');
  commit(
    ['Narrow the alpha reader again', '', 'Limit: alpha keeps one caller', 'Record-Id: r-beta02'].join(
      '\n',
    ),
  );

  write('beta.ts', 'beta');
  commit(['Add the beta reader', '', 'Limit: beta is independent', 'Record-Id: r-gamma03'].join('\n'));

  write('untouched.ts', 'untouched');
  commit('Add a file no record ever mentions');

  git(repo, ['mv', 'alpha.ts', 'renamed.ts']);
  commit(
    [
      'Rename the alpha reader',
      '',
      'Limit: the renamed reader keeps the alpha contract',
      'Record-Id: r-delta04',
    ].join('\n'),
  );

  write('generated.ts', 'generated');
  writeFileSync(join(repo, '.gitattributes'), 'generated.ts linguist-generated=true\n');
  commit(
    [
      'Record something on a generated path',
      '',
      'Limit: the generated file is rebuilt, never edited',
      'Record-Id: r-epsilon5',
    ].join('\n'),
  );

  write('beta.ts', 'beta revised');
  commit(
    [
      'Retire the first beta decision',
      '',
      'Limit: beta is no longer independent',
      'Supersedes: r-gamma03',
      'Record-Id: r-zeta006',
    ].join('\n'),
  );

  return { dir, rows: measureDecisionDelivery(BASE, repo, 'HEAD') };
};

describe('decision-delivery answer key', () => {
  it('never imports the product it is the answer key for', () => {
    const source = readFileSync(join(REPO_ROOT, 'bench', 'deterministic', 'census.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"][^'"]*\/(?:src|dist)\//);
  });

  it('expires a date-form value the day after the stated day, and never a condition', () => {
    expect(expiryEnd('2026-02-15')).toBe(Date.parse('2026-02-16T00:00:00Z'));
    expect(expiryEnd('when the vendor ships v3')).toBeUndefined();
    expect(expiryEnd('2026-13-45')).toBeUndefined();
    expect(expiryEnd(undefined)).toBeUndefined();
  });

  it('reads every record block in a multi-record message', () => {
    const blocks = recordBlocks(
      REPO_ROOT,
      ['Subject', '', 'Limit: one', 'Record-Id: r-first01', '', 'Limit: two', 'Record-Id: r-second1'].join(
        '\n',
      ),
    );
    expect(blocks).toHaveLength(2);
    expect(blocks.flatMap((block) => block.filter((t) => t.key === 'Record-Id').map((t) => t.value))).toEqual([
      'r-first01',
      'r-second1',
    ]);
  });
});

describe('delivery parsing', () => {
  it('reads the record id column of a rendered injection line', () => {
    const delivery = deliveredFromInjection(
      [
        'commitlore: active records for src/core/inject.ts',
        '',
        'Limit',
        '  [claim]      r-alpha01  deadbee1  alpha stays path-scoped',
        '  [directive]  r-beta02  deadbee2  beta keeps one caller',
        '  [claim]      -  deadbee3  a record that declared no id',
        '',
        'Supersedes: r-notdelivered',
      ].join('\n'),
      2,
    );
    expect([...delivery.ids].sort()).toEqual(['r-alpha01', 'r-beta02']);
    expect(delivery.unidentified).toBe(1);
    expect(delivery.withheld).toBe(2);
  });

  it('reads declared records out of ordinary log output, and nothing else', () => {
    const delivery = deliveredFromLog(
      ['Subject', '', 'Supersedes: r-mentioned', 'Record-Id: r-declared', '', 'prose about r-inline'].join(
        '\n',
      ),
    );
    expect([...delivery.ids]).toEqual(['r-declared']);
  });
});

describe('decision delivery on a repository with a real supersede history', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = createFixture();
  }, 120_000);

  afterAll(() => {
    if (fixture !== undefined) rmSync(fixture.dir, { recursive: true, force: true });
  });

  it('folds the census the way SPEC §5 does', () => {
    const { census } = routeRow(fixture.rows, 'commitlore');
    expect(census.records).toBe(6);
    expect(census.active_records).toBe(5);
    expect(census.superseded_records).toBe(1);
    expect(census.expired_records).toBe(0);
    expect(census.supersedes_trailers_parsed).toBe(census.supersedes_lines_scanned);
  });

  it('scores every route against the same denominator', () => {
    const denominators = new Set(
      DELIVERY_ROUTES.map((route) => routeRow(fixture.rows, route).path_active_total),
    );
    expect(denominators.size).toBe(1);
  });

  it('excludes a tracked path that carries no active record', () => {
    const row = routeRow(fixture.rows, 'commitlore');
    expect(row.evaluation_paths).toBeLessThan(row.candidate_paths);
    expect(row.paths_without_active_record).toBe(row.candidate_paths - row.evaluation_paths);
  });

  it('excludes a generated path from the authored population and keeps it in the other', () => {
    const authored = routeRow(fixture.rows, 'commitlore', 'authored');
    const all = routeRow(fixture.rows, 'commitlore', 'all-tracked');
    expect(all.evaluation_paths).toBe(authored.evaluation_paths + 1);
    expect(all.path_active_total).toBeGreaterThan(authored.path_active_total);
    expect(all.census.generated_paths).toBe(1);
  });

  it('reaches a record through the rename chain', () => {
    expect(routeRow(fixture.rows, 'commitlore').rename_only_attachments).toBeGreaterThan(0);
  });

  it('delivers nothing on the code-only floor', () => {
    const row = routeRow(fixture.rows, 'code-only');
    expect(row.delivered_total).toBe(0);
    expect(row.path_recall).toBe(0);
    expect(row.paths_zero).toBe(row.evaluation_paths);
  });

  it('surfaces the retired record on ordinary git and never through the shipped route', () => {
    expect(routeRow(fixture.rows, 'git-log-path').stale_delivered).toBeGreaterThan(0);
    expect(routeRow(fixture.rows, 'commitlore').stale_delivered).toBe(0);
    expect(routeRow(fixture.rows, 'every-record-unbudgeted').stale_delivered).toBeGreaterThan(0);
  });

  it('reaches every active record on the path through the shipped route', () => {
    const row = routeRow(fixture.rows, 'commitlore');
    expect(row.path_recall).toBe(1);
    expect(row.paths_complete).toBe(row.evaluation_paths);
  });

  it('loses the pre-rename records that ordinary git log cannot follow', () => {
    expect(routeRow(fixture.rows, 'git-log-path').path_recall).toBeLessThan(
      routeRow(fixture.rows, 'commitlore').path_recall,
    );
  });

  it('recovers every active record repository-wide when the dump is unbudgeted', () => {
    const row = routeRow(fixture.rows, 'every-record-unbudgeted');
    expect(row.repo_recall).toBe(1);
    expect(row.off_path_delivered).toBeGreaterThan(0);
    expect(row.precision).toBeLessThan(1);
  });

  it('scores no id the census does not know', () => {
    for (const route of DELIVERY_ROUTES) {
      expect(routeRow(fixture.rows, route).unknown_delivered).toBe(0);
    }
  });

  it('renders a report that states delivery is a ceiling', () => {
    const report = renderDeterministicReport(fixture.rows);
    expect(report).toContain(DELIVERY_SCOPE_SENTENCE);
    expect(report).toContain('## 9. Active-record delivery before the first edit');
    for (const route of DELIVERY_ROUTES) expect(report).toContain(`| ${route} |`);
  });

  it('keeps another run\'s cost figures out of a single-metric report', () => {
    expect(renderDeterministicReport(fixture.rows)).not.toContain('Economic case');
  });
});
