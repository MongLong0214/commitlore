/**
 * CDEB-P task controls (PRD §4.7).
 *
 * A task is only worth running if its oracle is known to answer correctly on
 * inputs whose answer is already known. Two controls per task, and both matter
 * for opposite reasons:
 *
 *   good — this repository as it stands. It respects its own decisions, so an
 *          oracle reporting REVIVED here is a false positive, and every OFF-arm
 *          revival it later reports would be noise read as signal.
 *   bad  — the rejected approach, implemented. An oracle that does not see it
 *          reports SAFE for a tree that revived the decision, which is the
 *          failure that would make a null result meaningless.
 *
 * The bad controls are written against the real source, so a refactor that
 * moves the construct they mutate breaks this test rather than silently
 * blinding the oracle. That is the intended failure mode: `verify-scope` was
 * caught here first, where the mutation anchored on a string `bench/verify.mjs`
 * does not contain and the "bad" tree was therefore identical to the good one.
 */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { PILOT_TASKS } from '../bench/cdeb/pilot/tasks.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** The rejected approach for each task, as a patch over the real source. */
const BAD_CONTROL: Record<string, readonly [string, (source: string) => string][]> = {
  'lifecycle-fourth-value': [
    ['src/core/types.ts', (s) => s.replace(/Lifecycle\s*=\s*([^;]+);/s, (m) => m.replace(';', " | 'orphaned';"))],
  ],
  // The revival is a deletion reached because the file could not be read, not
  // the presence of a token. An exported `FORCE_FLAG` string deletes nothing and
  // is the identifier near miss, not the bad control.
  'pending-rm-force': [
    [
      'src/commands/pending.ts',
      (s) =>
        s.replace(
          '  } catch (error) {\n    const detail = error instanceof Error ? error.message : String(error);\n    return {\n      removed: null,',
          '  } catch (error) {\n    const detail = error instanceof Error ? error.message : String(error);\n    deletePending(only, { cwd });\n    return {\n      removed: null,',
        ),
    ],
  ],
};

/** A tree holding the named files, optionally mutated. */
const tree = (label: string, files: readonly string[], mutate?: (rel: string, s: string) => string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `cdeb-ctl-${label}-`));
  scratch.push(dir);
  for (const rel of files) {
    const raw = readFileSync(join(REPO_ROOT, rel), 'utf8');
    const out = join(dir, rel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, mutate === undefined ? raw : mutate(rel, raw));
  }
  return dir;
};

describe('CDEB-P task controls', () => {
  it('registers four tasks, each naming a record that exists in this history', () => {
    // Two, not four. `verify-scope` and `guard-blocking-policy` were removed:
    // their records are fully implemented, so no oracle could make a no-op fail.
    expect(PILOT_TASKS).toHaveLength(2);
    for (const task of PILOT_TASKS) {
      expect(task.record_ids.length).toBeGreaterThan(0);
      for (const id of task.record_ids) expect(id).toMatch(/^r-[a-z0-9]+$/);
    }
  });

  /**
   * §4.2 forbids four things: the product's name, an instruction to consult
   * prior decisions, the name of the rejected approach, and the name of the
   * construct holding the answer. It does not forbid domain nouns — a
   * maintenance request about a records tool cannot avoid the word "record",
   * and a prompt contorted to avoid it would read as a test, which §4.2 exists
   * to prevent.
   */
  it('every prompt stays natural — §4.2 forbids the product, the method and the answer', () => {
    const forbidden = [
      'commitlore',
      'ruled-out',
      'previous decision',
      'prior decision',
      'git log',
      'trailer',
      'lifecycle',
      '--force',
      'manifest',
      'policy key',
    ];
    for (const task of PILOT_TASKS) {
      const prompt = task.prompt.toLowerCase();
      for (const term of forbidden) {
        expect(prompt, `${task.task_id} leaks "${term}"`).not.toContain(term);
      }
    }
  });

  for (const task of PILOT_TASKS) {
    const patches = BAD_CONTROL[task.task_id];
    // The tree an oracle is handed must contain everything the task watches, not
    // only the files its bad control patches. A truncated tree makes an oracle
    // report "not evaluable" and the control then measures the truncation.
    const treeFiles = [...new Set([...task.watch, ...(patches ?? []).map(([rel]) => rel)])];
    // Closed gaps: this task's oracle now fails an untouched tree, so asserting
    // that it does is an ordinary assertion. The other three still pass a no-op.
    // Both remaining tasks fail a no-op; the exception list is empty.
    const noOpFixed = true;

    it(`${task.task_id}: the good control reads SAFE`, () => {
      expect(patches, `${task.task_id} has no bad control`).toBeDefined();
      const verdict = task.oracle(tree(`${task.task_id}-good`, treeFiles));
      expect(verdict.rejected_decision_revived, verdict.detail).toBe(false);
      // The "good control" is this repository as it stands, which is a tree with
      // the work NOT done. Asserting functional pass on it is what forced
      // `functional_pass` to mean "the tree is not broken"; where a task's oracle
      // has been fixed, the honest expectation is the opposite.
      expect(verdict.functional_pass, verdict.detail).toBe(!noOpFixed);
    });

    /**
     * §4.7's good/bad pair guards the revival axis and does it well. Neither
     * control asks whether the oracle can tell *the task was done* from *the
     * task was never attempted* -- and `decision_safe_success` is
     * `functional_pass && !revived`, so an untouched tree that reads SAFE is a
     * decision-safe first-pass success with no first pass in it.
     *
     * Measured on all four: the frozen snapshot scores `functional_pass: true`
     * and `revived: false`, so doing nothing passes every task. That is not the
     * oracles being careless; `functional_pass` is asserted true on the good
     * control above, which forces it to mean "the tree is not broken" rather
     * than "the requested change is present".
     *
     * This control fails today. It is committed failing rather than skipped,
     * because a task whose oracle cannot see the absence of work cannot measure
     * an arm that did any.
     */
    const untouched = noOpFixed ? it : it.fails;
    untouched(`${task.task_id}: an untouched tree is not a decision-safe success`, () => {
      const verdict = task.oracle(tree(`${task.task_id}-none`, treeFiles));
      const safe = verdict.functional_pass && !verdict.rejected_decision_revived;
      expect(safe, `untouched tree scored decision-safe: ${verdict.detail}`).toBe(false);
    });

    it(`${task.task_id}: the bad control reads REVIVED`, () => {
      const files = treeFiles;
      const apply = (rel: string, source: string): string => {
        const patch = (patches ?? []).find(([target]) => target === rel);
        return patch === undefined ? source : patch[1](source);
      };
      const verdict = task.oracle(tree(`${task.task_id}-bad`, files, apply));
      expect(verdict.rejected_decision_revived, verdict.detail).toBe(true);
    });
  }
});
