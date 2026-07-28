/**
 * T-704: the README's numbers must be a function of the logs, and nothing else.
 *
 * Three failures would each be worse than having no benchmark at all, so each
 * one gets a test that fails loudly:
 *
 *   1. a **simulated** row reaching the README — dry-run rows fabricate a
 *      transcript, and a fabricated rate presented as a measurement is the
 *      single worst output this repository can produce;
 *   2. a **failed run quietly leaving a denominator** — the arm that crashed
 *      more often would then look like the arm that behaved better;
 *   3. a **hand-typed number surviving in the README** — which is what the
 *      regeneration check exists to make impossible.
 *
 * The fixtures live in `test/fixtures/bench/`, deliberately not in
 * `bench/results/`: that directory holds measurements, and a hand-written row
 * sitting next to real ones is the confusion this whole ticket is about.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MARKER_BEGIN,
  MARKER_END,
  README_SOURCES,
  buildJson,
  buildReport,
  declarationFor,
  readSources,
  renderSection,
} from '../bench/report.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURES = 'test/fixtures/bench';

const CLEAN = `${FIXTURES}/clean.jsonl`;
const PARTIAL = `${FIXTURES}/partial.jsonl`;
const STAMPED = `${FIXTURES}/stamped.jsonl`;
const SIMULATED = `${FIXTURES}/simulated.jsonl`;
const EMPTY = `${FIXTURES}/empty.jsonl`;
const M4_LEGACY = `${FIXTURES}/m4-legacy-row.jsonl`;
const BOGUS_STATUS = `${FIXTURES}/bogus-status.jsonl`;
const FIXTURE_README = `${FIXTURES}/readme-in-sync.md`;

const report = (...files: string[]): string => buildReport(readSources(files, { allowMissing: false }));

/** Only the fields these tests assert on; the payload carries more. */
interface JsonCondition {
  readonly cond: string;
  readonly n: number;
  readonly reproposal_rate: number | null;
}

interface JsonReport {
  readonly citable: boolean;
  readonly sources: readonly {
    readonly file: string;
    readonly status: { readonly status: string | null; readonly unrecognized: string | null; readonly citable: boolean };
  }[];
  readonly progress: { readonly state: string; readonly recorded: number; readonly planned: number | null };
  readonly summary: {
    readonly rows: number;
    readonly excluded_rows: number;
    readonly exclusions: Readonly<Record<string, number>>;
    readonly conditions: readonly JsonCondition[];
    readonly analysis: readonly JsonCondition[];
    readonly comparison: {
      readonly table: { readonly a: number; readonly b: number; readonly c: number; readonly d: number };
      readonly excluded_rows: number;
    } | null;
  };
}

const json = (...files: string[]): JsonReport =>
  JSON.parse(buildJson(readSources(files, { allowMissing: false }))) as JsonReport;

const runNode = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const runReport = (...args: string[]) =>
  runNode(['--experimental-strip-types', '--no-warnings=ExperimentalWarning', 'bench/report.ts', ...args]);

const runChecker = (...args: string[]) => runNode(['scripts/check-readme-numbers.mjs', ...args]);

/** A scratch copy of a fixture, so a test can corrupt it without touching the repo. */
const tempCopy = (source: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitlore-report-'));
  const target = path.join(dir, path.basename(source));
  fs.copyFileSync(path.join(REPO_ROOT, source), target);
  return target;
};

describe('bench/report.ts is deterministic', () => {
  it('produces byte-identical output for the same fixture', () => {
    expect(report(CLEAN)).toBe(report(CLEAN));
    expect(renderSection(readSources([CLEAN], { allowMissing: false }))).toBe(
      renderSection(readSources([CLEAN], { allowMissing: false })),
    );
  });

  it('produces byte-identical output across separate processes', () => {
    const first = runReport(CLEAN, '--section');
    const second = runReport(CLEAN, '--section');
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout.length).toBeGreaterThan(0);
  });

  it('carries no clock, no absolute path and no current commit', () => {
    const markdown = report(CLEAN);
    // A block that changed because it was regenerated on another machine, at a
    // later commit, or a minute later would make the CI comparison meaningless.
    expect(markdown).not.toContain(REPO_ROOT);
    expect(markdown).not.toContain(String(new Date().getFullYear() + 1));
    const headSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
    if (headSha !== '') expect(markdown).not.toContain(headSha);
  });

  it('wraps the section in the markers, and nothing else', () => {
    const section = renderSection(readSources([CLEAN], { allowMissing: false }));
    expect(section.startsWith(`${MARKER_BEGIN}\n`)).toBe(true);
    expect(section.endsWith(`${MARKER_END}\n`)).toBe(true);
    expect(section.split(MARKER_BEGIN)).toHaveLength(2);
    expect(section.split(MARKER_END)).toHaveLength(2);
  });
});

describe('simulated rows are refused, not filtered', () => {
  it('throws rather than reporting on a file containing a simulated row', () => {
    expect(() => report(SIMULATED)).toThrow(/simulated/i);
  });

  it('refuses even when only some rows are simulated', () => {
    // 2 of 4 rows are real. Reporting the other 2 would produce a plausible
    // table that no reader could tell was half fabricated.
    const sources = readSources([SIMULATED], { allowMissing: false });
    expect(sources.rows).toHaveLength(4);
    expect(sources.present[0]?.simulatedRows).toBe(2);
    expect(() => buildReport(sources)).toThrow(/2\/4 rows/);
    expect(() => buildJson(sources)).toThrow(/simulated/i);
  });

  it('exits non-zero and writes nothing to stdout', () => {
    const result = runReport(SIMULATED, '--section');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/refusing to build a report from simulated rows/);
  });

  it('refuses a mixed set of files when one of them is simulated', () => {
    expect(() => report(CLEAN, SIMULATED)).toThrow(/simulated/i);
  });
});

describe('failed runs stay in the report', () => {
  const summary = () => json(CLEAN).summary;

  it('counts them in the unfiltered table and excludes them from the analysis set', () => {
    const all = summary();
    expect(all.rows).toBe(24);
    expect(all.excluded_rows).toBe(2);
    expect(all.exclusions).toEqual({ error: 2 });

    const allOn = all.conditions.find((condition) => condition.cond === 'commitlore-on');
    const analysisOn = all.analysis.find((condition) => condition.cond === 'commitlore-on');
    expect(allOn?.n).toBe(12);
    expect(analysisOn?.n).toBe(11);
    // The error row carries `reproposed: false` because the field is required.
    // Keeping it in the denominator would deflate the rate: 1/12 vs 1/11.
    expect(allOn?.reproposal_rate).toBeCloseTo(1 / 12, 12);
    expect(analysisOn?.reproposal_rate).toBeCloseTo(1 / 11, 12);
  });

  it('uses the analysis-set denominators in the significance table', () => {
    const comparison = summary().comparison;
    expect(comparison?.table).toEqual({ a: 1, b: 10, c: 6, d: 5 });
    expect((comparison?.table.a ?? 0) + (comparison?.table.b ?? 0)).toBe(11);
    expect((comparison?.table.c ?? 0) + (comparison?.table.d ?? 0)).toBe(11);
    expect(comparison?.excluded_rows).toBe(2);
  });

  it('says out loud how many rows left and why', () => {
    const markdown = report(CLEAN);
    expect(markdown).toContain('**Analysis set — 22 of 24 rows** (2 excluded: error = 2)');
    expect(markdown).toContain('| Rows excluded from the analysis set | 2 |');
  });

  it('prints the stopped_by breakdown over every recorded run', () => {
    const markdown = report(CLEAN);
    // Both arms lost one run to an error and the off arm has two over-turns.
    // Those columns are how a reader sees a failure that no rate reveals.
    expect(markdown).toContain('| Condition | completed | timeout | over-turns | over-tokens | error |');
    expect(markdown).toContain('| `commitlore-off` | 9 | 0 | 2 | 0 | 1 |');
    expect(markdown).toContain('| `commitlore-on` | 11 | 0 | 0 | 0 | 1 |');
  });

  it('states plainly when nothing was excluded', () => {
    expect(report(STAMPED)).toContain('**Analysis set — all 4 rows.** Nothing was excluded');
  });
});

describe('unknown guard exposure', () => {
  it('explains why an otherwise two-arm comparison was not computed', () => {
    const source = tempCopy(M4_LEGACY);
    const row = fs.readFileSync(source, 'utf8');
    fs.writeFileSync(source, `${row}${row.replace('"cond": "commitlore-on"', '"cond": "commitlore-off"')}`);

    const markdown = buildReport(readSources([source], { allowMissing: false }));
    expect(markdown).toContain('**Significance:** not computed — guard exposure is unknown for 2 analysis rows');
    expect(markdown).not.toContain('a comparison needs exactly two conditions');
  });
});

describe('an empty result set says so', () => {
  it('reports no measurement rather than a rate of 0 or NaN', () => {
    const markdown = report(EMPTY);
    expect(markdown).toContain('**Not measured yet.**');
    expect(markdown).toContain(EMPTY);
    expect(markdown).not.toMatch(/NaN/);
    expect(markdown).not.toMatch(/\bundefined\b/);
    // No table can be built from no runs, and an empty one would read as a
    // measurement of zero.
    expect(markdown).not.toContain('| Condition |');
    // Nor a citation warning: there is nothing here anyone could cite.
    expect(markdown).not.toContain('⚠️');
  });

  it('exits 0 so the README block can be generated before the first run', () => {
    const result = runReport(EMPTY, '--section');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('**Not measured yet.**');
  });

  it('names the file it is waiting for when a declared source does not exist yet', () => {
    // The README block has to say something before the first measurement lands,
    // and "nothing here" is not the same statement as "measured, no effect".
    const markdown = buildReport(readSources([`${FIXTURES}/not-yet.jsonl`], { allowMissing: true }));
    expect(markdown).toContain('**Not measured yet.**');
    expect(markdown).toContain('not-yet.jsonl');
  });

  it('never prints NaN for any fixture', () => {
    for (const fixture of [CLEAN, PARTIAL, STAMPED, EMPTY]) {
      expect(report(fixture)).not.toMatch(/NaN/);
    }
  });
});

describe('the model is reported, and where it came from', () => {
  it('reads the model from the manifest when the rows do not carry one', () => {
    const markdown = report(CLEAN);
    expect(markdown).toContain('| Model | `fixture-model-1` |');
    expect(markdown).toContain('The model above is read from the run manifest');
    expect(markdown).toContain('conditional on the model that produced it');
    // The manifest's own caveat travels with the number.
    expect(markdown).toContain('Fixture data. Every rate derived from this file is conditional on a model');
  });

  it('reads the model off the rows when the runner stamped it', () => {
    const markdown = report(STAMPED);
    expect(markdown).toContain('| Model | `fixture-model-2` |');
    expect(markdown).not.toContain('read from the run manifest');
  });

  it('names both models and warns when a set mixes them', () => {
    const markdown = report(CLEAN, STAMPED);
    expect(markdown).toContain('`fixture-model-1`, `fixture-model-2`');
    expect(markdown).toContain('mix 2 models');
  });
});

describe('a partial matrix is labelled as one', () => {
  it('says how many of the planned runs are recorded', () => {
    const markdown = report(PARTIAL);
    expect(markdown).toContain('**Measurement in progress — 12 of 24 planned runs recorded.**');
    expect(json(PARTIAL).progress).toEqual({ state: 'in-progress', recorded: 12, planned: 24 });
  });

  it('calls a finished matrix complete', () => {
    expect(report(CLEAN)).toContain('**Complete — 24 of 24 planned runs recorded.**');
  });

  it('does not claim completeness when no manifest declares a plan', () => {
    const markdown = report(STAMPED);
    expect(markdown).toContain('**4 runs recorded.** No manifest declares how many runs');
    expect(json(STAMPED).progress.state).toBe('unknown-plan');
  });
});

describe('a dataset that must not be cited says so first', () => {
  it('leaves a final dataset unbannered', () => {
    const markdown = report(CLEAN);
    expect(markdown).not.toContain('⚠️');
    expect(markdown).toContain('| Status | final (from the run manifest) |');
    expect(json(CLEAN).citable).toBe(true);
  });

  it('banners a pilot above every number', () => {
    const markdown = report(PARTIAL);
    expect(markdown).toContain('> **⚠️ Pilot run — not for citation.**');
    expect(markdown).toContain('| Status | pilot (from the run manifest) |');
    expect(json(PARTIAL).citable).toBe(false);
    // Before the progress line, the tables and the p-value: a reader who stops
    // after the first sentence has still been told.
    expect(markdown.indexOf('⚠️')).toBeLessThan(markdown.indexOf('runs recorded'));
    expect(markdown.indexOf('⚠️')).toBeLessThan(markdown.indexOf('| Condition |'));
  });

  it('banners a superseded dataset and carries the reason it was demoted', () => {
    const sources = readSources(
      [{ file: PARTIAL, status: 'superseded', status_note: 'the code that produced it was edited mid-run' }],
      { allowMissing: false },
    );
    // The manifest says `pilot` and wins; the declaration is only a fallback.
    expect(buildReport(sources)).toContain('> **⚠️ Pilot run — not for citation.**');

    const declaredOnly = readSources(
      [{ file: STAMPED, status: 'superseded', status_note: 'the code that produced it was edited mid-run' }],
      { allowMissing: false },
    );
    const markdown = buildReport(declaredOnly);
    expect(markdown).toContain('> **⚠️ Pilot run — superseded. Not for citation.** the code that produced it was edited mid-run');
    expect(markdown).toContain('| Status | superseded (declared in `bench/report.ts`, pending a manifest field) |');
  });

  it('treats an undeclared status as not citable', () => {
    // stamped.jsonl has no manifest at all. Silence is the state a dataset is
    // most likely to be quoted from by accident, so it fails towards the warning.
    const markdown = report(STAMPED);
    expect(markdown).toContain('> **⚠️ Status not declared — not for citation.**');
    expect(markdown).toContain('"status": "final"');
    expect(markdown).toContain('| Status | not declared — not citable |');
    expect(json(STAMPED).citable).toBe(false);
  });

  it('treats an unrecognized status as not citable rather than guessing', () => {
    const markdown = report(BOGUS_STATUS);
    expect(markdown).toContain('> **⚠️ Status `draft` is not one of `final`, `pilot`, `superseded` — not for citation.**');
    expect(json(BOGUS_STATUS).citable).toBe(false);
    expect(json(BOGUS_STATUS).sources[0]?.status.unrecognized).toBe('draft');
  });

  it('accepts a declared final when no manifest exists', () => {
    const sources = readSources([{ file: STAMPED, status: 'final' }], { allowMissing: false });
    expect(buildReport(sources)).not.toContain('⚠️');
    expect(sources.present[0]?.status).toMatchObject({ status: 'final', from: 'declaration', citable: true });
  });

  it('names the offending file when several sources are combined', () => {
    const markdown = report(CLEAN, PARTIAL);
    expect(markdown).toContain('`test/fixtures/bench/partial.jsonl`:');
    expect(markdown).not.toContain('`test/fixtures/bench/clean.jsonl`: ');
  });
});

describe('a declared status follows the file, not the invocation', () => {
  it('finds the declaration whether the path is typed or looked up', () => {
    for (const declared of README_SOURCES) {
      expect(declarationFor(declared.file)).toBe(declared);
      expect(declarationFor(`./${declared.file}`)).toBe(declared);
      expect(declarationFor(path.join(REPO_ROOT, declared.file))).toBe(declared);
    }
  });

  it('returns nothing for a file nobody declared', () => {
    expect(declarationFor(CLEAN)).toBeNull();
  });

  it('refuses pre-provenance declared sources identically through both entry points', () => {
    const files = README_SOURCES.map((source) => source.file).filter((file) =>
      fs.existsSync(path.join(REPO_ROOT, file)),
    );
    if (files.length === 0) return;
    const viaDefaults = runReport('--section');
    const viaPaths = runReport(...files, '--section');
    expect(viaDefaults.status).toBe(1);
    expect(viaPaths.status).toBe(1);
    expect(viaDefaults.stdout).toBe('');
    expect(viaPaths.stdout).toBe('');
    expect(viaPaths.stderr).toBe(viaDefaults.stderr);
    expect(viaDefaults.stderr).toMatch(/unrecorded/);
  });
});

describe('only the files it was handed', () => {
  it('never scans the directory a source lives in', () => {
    // clean.jsonl has five siblings in test/fixtures/bench/. A report on one of
    // them must mention exactly that one: once a superseded pilot and a final
    // run share a directory, a glob is all it takes to publish the wrong one.
    const markdown = report(CLEAN);
    expect(markdown).toContain('clean.jsonl');
    for (const sibling of ['partial.jsonl', 'stamped.jsonl', 'simulated.jsonl', 'empty.jsonl']) {
      expect(markdown).not.toContain(sibling);
    }
  });

  it('aggregates exactly the files named, in the order given', () => {
    const markdown = report(CLEAN, STAMPED);
    expect(markdown).toContain('`test/fixtures/bench/clean.jsonl` (24 rows), `test/fixtures/bench/stamped.jsonl` (4 rows)');
  });
});

describe('the README block cannot be written by hand', () => {
  it('passes when the block matches what the generator produces', () => {
    const result = runChecker('--readme', FIXTURE_README, CLEAN);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/matches bench\/report\.ts/);
  });

  it('fails when a single digit inside the block is edited', () => {
    const copy = tempCopy(FIXTURE_README);
    const original = fs.readFileSync(copy, 'utf8');
    expect(original).toContain('| `commitlore-on` | 12 | 1 | 0.083 |');
    fs.writeFileSync(copy, original.replace('| `commitlore-on` | 12 | 1 | 0.083 |', '| `commitlore-on` | 12 | 1 | 0.003 |'));

    const result = runChecker('--readme', copy, CLEAN);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/does not match what bench\/report\.ts generates/);
    expect(result.stderr).toMatch(/first difference at line \d+/);
    expect(result.stderr).toContain('0.003');
  });

  it('fails when a whole row is deleted from the block', () => {
    const copy = tempCopy(FIXTURE_README);
    const original = fs.readFileSync(copy, 'utf8');
    fs.writeFileSync(copy, original.replace('| Fisher exact, two-tailed | p = 0.0635 |\n', ''));

    const result = runChecker('--readme', copy, CLEAN);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/does not match/);
  });

  it('fails when a statistic is written outside the block', () => {
    const copy = tempCopy(FIXTURE_README);
    const original = fs.readFileSync(copy, 'utf8');
    // A generated block is worth nothing if the prose around it carries a
    // number nobody regenerates.
    fs.writeFileSync(copy, `${original}\nIn our testing the odds ratio was 0.4.\n`);

    const result = runChecker('--readme', copy, CLEAN);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/an odds ratio.* outside the generated block/);
  });

  it('fails when the markers are missing or duplicated', () => {
    const withoutMarkers = tempCopy(FIXTURE_README);
    fs.writeFileSync(withoutMarkers, '# No block here\n');
    expect(runChecker('--readme', withoutMarkers, CLEAN).status).toBe(1);

    const duplicated = tempCopy(FIXTURE_README);
    const original = fs.readFileSync(duplicated, 'utf8');
    fs.writeFileSync(duplicated, `${original}\n${MARKER_BEGIN}\nstale copy\n${MARKER_END}\n`);
    const result = runChecker('--readme', duplicated, CLEAN);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/exactly one/);
  });

  it('restores a corrupted block with --write', () => {
    const copy = tempCopy(FIXTURE_README);
    const original = fs.readFileSync(copy, 'utf8');
    fs.writeFileSync(copy, original.replace('0.083', '0.003'));
    expect(runChecker('--readme', copy, CLEAN).status).toBe(1);

    const written = runChecker('--write', '--readme', copy, CLEAN);
    expect(written.status).toBe(0);
    expect(fs.readFileSync(copy, 'utf8')).toBe(original);
    expect(runChecker('--readme', copy, CLEAN).status).toBe(0);
  });

  it('refuses to regenerate from simulated rows', () => {
    const copy = tempCopy(FIXTURE_README);
    const result = runChecker('--write', '--readme', copy, SIMULATED);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/simulated/i);
    // The block must be left exactly as it was rather than half-written.
    expect(fs.readFileSync(copy, 'utf8')).toBe(fs.readFileSync(path.join(REPO_ROOT, FIXTURE_README), 'utf8'));
  });
});

describe('the CLI refuses what it cannot answer honestly', () => {
  it('fails on a file that does not exist rather than reporting no measurement', () => {
    const result = runReport(`${FIXTURES}/does-not-exist.jsonl`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no such file/);
  });

  it('rejects --section with --format json', () => {
    const result = runReport(CLEAN, '--section', '--format', 'json');
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });

  it('rejects an unknown format', () => {
    expect(runReport(CLEAN, '--format', 'csv').status).toBe(2);
  });

  it('prints usage when given no files and no --section', () => {
    expect(runReport().status).toBe(2);
  });
});
