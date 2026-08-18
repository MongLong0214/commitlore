/**
 * The pilot harness's two silent-failure properties, read from the file.
 *
 * Both were absent and neither showed up in a row:
 *
 *   - a materialized worktree has no index, so the first `inject` builds one
 *     under the three-second consumer budget and stops partway. The ON arm then
 *     receives whatever that budget reached, which was nothing on one measured
 *     run and four records on another. `hook_invocations` counts a header, so an
 *     empty payload reads as a hook that never fired -- the arm looks configured
 *     and is not treated.
 *   - the agent session was parsed for `usage` and dropped. That left a row able
 *     to say what was delivered and what landed and nothing about what happened
 *     between, which is exactly the ambiguity a `[claim]` payload creates.
 *
 * Asserted against the source rather than by running the harness, because
 * running it costs an agent session per case. Comment lines are stripped first
 * so the file's own explanation cannot satisfy a check -- the shape
 * `test/canonical-merge-workflow.test.ts` established for the same reason.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = join(REPO_ROOT, 'bench', 'cdeb', 'pilot', 'run.ts');

/** The runner with comment lines removed, so prose cannot satisfy a check. */
const code = (): string =>
  readFileSync(RUNNER, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const lineOf = (needle: string): number => {
  const index = code().split('\n').findIndex((l) => l.includes(needle));
  expect(index, `not found in the harness: ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
};

describe('CDEB-P harness', () => {
  it('finishes the index before the agent starts', () => {
    const body = code();
    expect(body).toMatch(/"index",\s*"--rebuild"/);
    // Before the agent, or the first inject still races the budget.
    expect(lineOf('"--rebuild"')).toBeLessThan(lineOf('spawnSync(\n    "claude"'.split('\n')[1] ?? '"claude"'));
  });

  it('fails the run when the index cannot be finished, rather than proceeding untreated', () => {
    // A partial index produces an empty payload and a row that looks like a
    // hook that never fired. Silence there is indistinguishable from a
    // repository with no records, which is the one thing this must not report.
    expect(code()).toMatch(/index --rebuild failed/);
  });

  it('builds the index in both arms', () => {
    // Only in ON and the arms differ in setup as well as in treatment, which is
    // the one thing a paired design cannot afford. The rebuild sits above the
    // arm-specific settings, so it runs either way.
    expect(lineOf('"--rebuild"')).toBeLessThan(lineOf('armSettings(scratch, condition'));
  });

  it('keeps the agent session, and writes it before parsing', () => {
    const body = code();
    expect(body).toMatch(/\.session\.json/);
    // Written before JSON.parse, so a session that fails to parse is still on
    // disk to be read -- which is when one is most worth having.
    expect(lineOf('.session.json')).toBeLessThan(lineOf('JSON.parse(result.stdout'));
  });

  it('keeps sessions off by default', () => {
    // A session holds prompts, file contents and model output from the studied
    // repository. That belongs in the authorization before anything writes one
    // without being asked (§3.3).
    expect(code()).toMatch(/arg\("sessions"\)\s*\?\?\s*null/);
  });
});
