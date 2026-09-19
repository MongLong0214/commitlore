/**
 * `de/run.ts` planning mode — #1036, revision `native-efficacy-r6.1`.
 *
 * "No execute means read-only planning: no model, setup, checker or run-file
 * writes."
 *
 * That guarantee is asserted the only way it can be: by listing the tree before
 * and after and comparing. A test that reads the output and believes the closing
 * line would pass against a version that wrote a run directory on the way.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readManifest, summarise } from '../bench/de/run.ts';

const RUN = resolve('bench/de/run.ts');
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const workspace = (name: string, manifest: unknown): { dir: string; cases: string } => {
  const dir = mkdtempSync(join(tmpdir(), `de-run-${name}-`));
  roots.push(dir);
  const cases = join(dir, 'cases.json');
  writeFileSync(cases, JSON.stringify(manifest));
  return { dir, cases };
};

/** Every path under `dir`, with sizes, so a rewrite is caught as well as a create. */
const tree = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        out.push(`${path}/`);
        walk(path);
      } else {
        out.push(`${path} ${String(statSync(path).size)}`);
      }
    }
  };
  walk(dir);
  return out;
};

const run = (args: readonly string[], cwd: string): { stdout: string; status: number } => {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', RUN, ...args],
      { cwd, encoding: 'utf8' },
    );
    return { stdout, status: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number };
    return { stdout: `${failure.stdout ?? ''}${failure.stderr ?? ''}`, status: failure.status ?? 1 };
  }
};

const manifest = {
  cases: [
    { id: 'c1', cluster_id: 'repo-a', source_group: 'g1' },
    { id: 'c2', cluster_id: 'repo-a', source_group: 'g1' },
    { id: 'c3', cluster_id: 'repo-b', source_group: 'g2' },
  ],
};

describe('#1036 planning writes nothing and calls nothing', () => {
  it('leaves the tree byte-for-byte as it found it', () => {
    const { dir, cases } = workspace('readonly', manifest);
    mkdirSync(join(dir, 'existing'), { recursive: true });
    writeFileSync(join(dir, 'existing', 'keep.txt'), 'untouched\n');
    const before = tree(dir);

    const result = run(['--cases', cases, '--repeat', '2', '--seed', 'demo'], dir);

    expect(result.status).toBe(0);
    expect(tree(dir)).toEqual(before);
  });

  it('says so in the output rather than leaving the reader to assume it', () => {
    const { dir, cases } = workspace('says', manifest);

    expect(run(['--cases', cases], dir).stdout).toMatch(/nothing was written and no model was called/);
  });
});

describe('#1036 --execute refuses rather than quietly planning', () => {
  it('exits 2 and names what it will not do', () => {
    // "Retired Jev modes/budgets fail clearly before inference, not silently
    // map to native." A flag that planned instead of running is the same defect
    // wearing the opposite label.
    const { dir, cases } = workspace('execute', manifest);

    const result = run(['--cases', cases, '--execute'], dir);

    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/--execute is not wired yet/);
  });

  it('still writes nothing when refused', () => {
    const { dir, cases } = workspace('execute-readonly', manifest);
    const before = tree(dir);

    run(['--cases', cases, '--execute'], dir);

    expect(tree(dir)).toEqual(before);
  });
});

describe('#1036 the manifest is validated, not trusted', () => {
  // Every later denominator is derived from it.

  it('refuses a duplicated case id', () => {
    const { cases } = workspace('dupe', {
      cases: [...manifest.cases, { id: 'c1', cluster_id: 'repo-c', source_group: 'g3' }],
    });

    expect(() => readManifest(cases)).toThrow(/c1 appears more than once/);
  });

  it('refuses a case with no source_group', () => {
    // A missing group would collapse two groups into one and re-weight the mean.
    const { cases } = workspace('nogroup', { cases: [{ id: 'c1', cluster_id: 'repo-a' }] });

    expect(() => readManifest(cases)).toThrow(/no source_group/);
  });

  it('refuses an empty manifest', () => {
    const { cases } = workspace('empty', { cases: [] });

    expect(() => readManifest(cases)).toThrow(/declares no cases/);
  });

  it('exits non-zero on a bad manifest rather than planning a partial study', () => {
    const { dir, cases } = workspace('bad', { cases: [{ id: 'c1' }] });

    expect(run(['--cases', cases], dir).status).not.toBe(0);
  });
});

describe('#1036 the summary reports a ceiling, and says which', () => {
  it('counts six actor sessions per pair', () => {
    // "at most six actor sessions" -- two captures, two solves, two repairs.
    const summary = summarise(manifest, {
      seed: 'demo',
      repeat: 2,
      limits: { capture: 1_000, solve: 10_000, repair: 5_000 },
    });

    expect(summary.pairs).toBe(6);
    expect(summary.actor_sessions_worst_case).toBe(36);
    expect(summary.tokens_worst_case).toBe(6 * 2 * (1_000 + 10_000 + 5_000));
  });

  it('labels the number a ceiling from the limits rather than a measurement', () => {
    // #1039 §4 forbids inventing a sample quota; a plan cannot know what an
    // episode will use, only what the reservation will hold back.
    const { dir, cases } = workspace('ceiling', manifest);

    expect(run(['--cases', cases], dir).stdout).toMatch(/a ceiling from the limits, not a measurement/);
  });

  it('carries the protocol revision and experiment', () => {
    const summary = summarise(manifest, {
      seed: 's',
      repeat: 1,
      limits: { capture: 1, solve: 1, repair: 1 },
    });

    expect(summary).toMatchObject({ protocol_revision: 'native-efficacy-r6.1', experiment: 'baseline' });
  });

  it('is reproducible from the seed', () => {
    const { dir, cases } = workspace('repro', manifest);
    const once = run(['--cases', cases, '--seed', 'fixed', '--json'], dir).stdout;
    const twice = run(['--cases', cases, '--seed', 'fixed', '--json'], dir).stdout;

    expect(once).toBe(twice);
    expect(run(['--cases', cases, '--seed', 'other', '--json'], dir).stdout).not.toBe(once);
  });
});
