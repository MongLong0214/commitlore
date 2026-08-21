/**
 * The fan-in gate exists so branch protection can require one stable context
 * instead of twelve, several of which are matrix-interpolated: `check (22.23.2)`
 * carries the exact pinned floor, so raising that floor RENAMES the required
 * context. While admins are exempt a rename is survivable; once they are not, a
 * renamed context means no commit can satisfy protection and `main` freezes with
 * no exit except editing the settings by hand.
 *
 * That only holds while the gate fans in from EVERY job. A job added to `ci.yml`
 * and not added to `needs:` is silently outside protection — the same shape as
 * the failure `bench/verify.mjs` was rewritten to prevent, where a file left off
 * a declared list was silently ungated. The list is default-in there; here it
 * cannot be, so it is asserted instead.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Workflow {
  jobs: Record<string, { needs?: string[]; if?: string; name?: string }>;
}

const workflow = (file: string): Workflow =>
  load(readFileSync(join(REPO_ROOT, '.github/workflows', file), 'utf8')) as Workflow;

describe('the CI fan-in gate', () => {
  const ci = workflow('ci.yml');

  it('exists and is named for use as a required context', () => {
    expect(ci.jobs.gate, 'ci.yml has no gate job').toBeDefined();
    expect(ci.jobs.gate?.name).toBe('gate');
  });

  it('fans in from every other job in the workflow', () => {
    const others = Object.keys(ci.jobs).filter((id) => id !== 'gate');
    const needs = ci.jobs.gate?.needs ?? [];
    const uncovered = others.filter((id) => !needs.includes(id));
    expect(uncovered, `these jobs are outside the gate: ${uncovered.join(', ')}`).toHaveLength(0);
  });

  it('names no job that does not exist', () => {
    const needs = ci.jobs.gate?.needs ?? [];
    const dangling = needs.filter((id) => ci.jobs[id] === undefined);
    expect(dangling, `gate needs a missing job: ${dangling.join(', ')}`).toHaveLength(0);
  });

  it('runs even when a dependency fails', () => {
    // Without `always()` a failed dependency SKIPS this job rather than failing
    // it, and a skipped required check is not a failure to GitHub — the gate
    // would wave through exactly the runs it exists to stop.
    expect(ci.jobs.gate?.if).toBe('always()');
  });

  it('treats anything other than success as failure', () => {
    const body = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const gate = body.slice(body.indexOf('  gate:'));
    // `skipped` and `cancelled` are not success. Comparing against `failure`
    // would let both through.
    expect(gate).toContain('!= "success"');
    expect(gate).not.toMatch(/=\s*"failure"/);
  });

  it('lint reports on pull requests, which is the only place protection can see it', () => {
    // `lint` does not report on `main` commits and is not supposed to: a squash
    // produces a commit carrying no `lint` context, which is why the release
    // gate requires eleven jobs and not twelve. It reports on PR heads, and a PR
    // head is what branch protection evaluates.
    //
    // So the `pull_request` trigger is load-bearing for protection. Remove it
    // and `lint` becomes a required context that can never report on a pull
    // request, and every pull request blocks -- the same shape as requiring a
    // context from a workflow that only runs on another branch, reached from
    // the other direction. Nothing else guards this.
    const body = readFileSync(join(REPO_ROOT, '.github/workflows/demo-lint.yml'), 'utf8');
    const on = (load(body) as { on?: Record<string, unknown> }).on ?? {};
    expect(
      Object.keys(on),
      'demo-lint.yml must trigger on pull_request while `lint` is a required context',
    ).toContain('pull_request');
  });

  it('lint stays a separate required context, and is not matrix-interpolated', () => {
    // `lint` lives in another workflow and cannot be a `needs:` from ci.yml, so
    // protection requires two contexts. Neither may carry a matrix value, or a
    // version bump renames it.
    const demo = workflow('demo-lint.yml');
    expect(demo.jobs.lint, 'demo-lint.yml has no lint job').toBeDefined();
    // The required context is the check-run NAME, which GitHub takes from an
    // explicit `name:` when there is one and from the job id otherwise. Renaming
    // the id is caught here and in action-lint.test.ts; ADDING a `name:` was
    // not, and it breaks the context exactly as thoroughly -- `lint` would stop
    // reporting while a job called `lint` still sits in the file. `gate` pins
    // its name above; this is the same pin, which was missing on the other half
    // of the required pair.
    expect(
      demo.jobs.lint?.name,
      'lint must not carry an explicit name: the required context is derived from the job id',
    ).toBeUndefined();
    for (const [file, id] of [['ci.yml', 'gate'], ['demo-lint.yml', 'lint']] as const) {
      const body = readFileSync(join(REPO_ROOT, '.github/workflows', file), 'utf8');
      const job = body.slice(body.indexOf(`  ${id}:`));
      const header = job.slice(0, job.indexOf('steps:'));
      expect(header, `${id} must not be matrix-interpolated`).not.toContain('matrix.');
    }
  });
});
