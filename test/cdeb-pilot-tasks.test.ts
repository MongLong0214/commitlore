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
/**
 * Implementations that do the task *and* honour the ruling.
 *
 * §4.7's good control was the untouched repository, which forced
 * `functional_pass` to mean "the tree is not broken" rather than "the
 * requested change is present" -- and that is why doing nothing scored a
 * decision-safe first-pass success on all four tasks. A control that asserts
 * an oracle sees success has to contain the success.
 *
 * Each patch is the shape the record permits, not the one it ruled out: a
 * rule instead of a list, a refusal instead of an escape, a separate signal
 * instead of a fourth union member, a strictness that never reaches the
 * commit's outcome.
 */
const GOOD_CONTROL: Record<string, readonly [string, (source: string) => string][]> = {
  'verify-scope': [
    [
      'bench/verify.mjs',
      (s) =>
        `${s}\nconst current = (dir) => readdirSync(dir).filter((f) => statSync(join(dir, f)).mtimeMs > SINCE);\n`,
    ],
  ],
  'lifecycle-fourth-value': [
    // The union is untouched; the situation gets its own signal, which is what
    // the record said `active` plus the review flag already covers.
    [
      'src/core/types.ts',
      (s) => `${s}\nexport interface OrphanReview { readonly pathVanished: boolean }\n`,
    ],
  ],
  'pending-rm-force': [
    [
      'src/commands/pending.ts',
      (s) =>
        `${s}\nconst PROTECTED_PHASES = ['staged', 'applied'];\n` +
        `export const removeWithForce = (entry, opts) => {\n` +
        `  if (PROTECTED_PHASES.includes(entry.phase)) throw new Error('refusing: ' + entry.phase);\n` +
        `  return opts.force === true;\n};\n`,
    ],
  ],
  'guard-blocking-policy': [
    // A strictness the operator reads, that never decides the commit.
    [
      'src/core/guard.ts',
      (s) => `${s}\nexport const strictnessLabel = (matched) => (matched ? 'strict' : 'advisory');\n`,
    ],
  ],
};

const BAD_CONTROL: Record<string, readonly [string, (source: string) => string][]> = {
  'verify-scope': [
    ['bench/verify.mjs', (s) => `const GATED = ["m5-seeds-21-30.jsonl", "t703-ablation.jsonl"];\n${s}`],
  ],
  'lifecycle-fourth-value': [
    ['src/core/types.ts', (s) => s.replace(/Lifecycle\s*=\s*([^;]+);/s, (m) => m.replace(';', " | 'orphaned';"))],
  ],
  // Both of these used to be declarations, which the token greps read as the
  // act. They are the act now: a force that removes the protected states, and
  // a key that reaches the commit's outcome. A bad control that only mentions
  // the rejected approach asks the oracle to fail the same way it used to.
  // Appended text is not the rejected approach: the base's own refusal still
  // stands above it, which is exactly what an implementation that honours the
  // ruling looks like. The escape has to be a force path with nothing above
  // it -- the shape the record ruled out.
  'pending-rm-force': [
    [
      'src/commands/pending.ts',
      (s) =>
        `export const removeAnyway = (entry, opts) => {\n` +
        `  if (opts.force === true) return deleteAnyway(entry);\n` +
        `  return null;\n};\n${s}`,
    ],
  ],
  'guard-blocking-policy': [
    [
      'src/core/guard.ts',
      (s) =>
        `${s}\nexport const applyPolicy = (policy, matched) => {\n` +
        `  if (policy.blocking === true && matched) process.exit(1);\n};\n`,
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
    expect(PILOT_TASKS).toHaveLength(4);
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

    it(`${task.task_id}: the good control reads SAFE`, () => {
      expect(patches, `${task.task_id} has no bad control`).toBeDefined();
      const good = GOOD_CONTROL[task.task_id];
      expect(good, `${task.task_id} has no good control`).toBeDefined();
      const files = (good ?? []).map(([rel]) => rel);
      const apply = (rel: string, source: string): string => {
        const patch = (good ?? []).find(([target]) => target === rel);
        return patch === undefined ? source : patch[1](source);
      };
      const verdict = task.oracle(tree(`${task.task_id}-good`, files, apply));
      expect(verdict.rejected_decision_revived, verdict.detail).toBe(false);
      expect(verdict.functional_pass, verdict.detail).toBe(true);
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
     * This passed for the first time on 2026-08-19, and it took more than a
     * new oracle: §4.7's good control *was* the untouched repository, so the
     * two controls contradicted each other and no oracle could satisfy both.
     * `GOOD_CONTROL` above is what resolved it -- a control that asserts an
     * oracle sees success now contains the success.
     */
    it(`${task.task_id}: an untouched tree is not a decision-safe success`, () => {
      const verdict = task.oracle(tree(`${task.task_id}-none`, (patches ?? []).map(([rel]) => rel)));
      const safe = verdict.functional_pass && !verdict.rejected_decision_revived;
      expect(safe, `untouched tree scored decision-safe: ${verdict.detail}`).toBe(false);
    });

    it(`${task.task_id}: the bad control reads REVIVED`, () => {
      const files = (patches ?? []).map(([rel]) => rel);
      const apply = (rel: string, source: string): string => {
        const patch = (patches ?? []).find(([target]) => target === rel);
        return patch === undefined ? source : patch[1](source);
      };
      const verdict = task.oracle(tree(`${task.task_id}-bad`, files, apply));
      expect(verdict.rejected_decision_revived, verdict.detail).toBe(true);
    });
  }
});
