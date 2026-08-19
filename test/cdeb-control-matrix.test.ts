/**
 * The seven-control gate, applied to the four pilot tasks.
 *
 * This file states what a task must survive before it can measure anything, and
 * reports which of the seven each task has. It is deliberately not a pass/fail
 * on the tasks themselves: three of them declare two controls out of seven, and
 * a test that hid that behind a green tick would be the same shape of defect it
 * exists to catch.
 *
 * The one assertion that fails is coverage, and it is committed failing.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  CONTROL_KINDS,
  CONTROL_MATRIX,
  expectationFor,
  missingControls,
  type ControlKind,
  type TaskControls,
} from '../bench/cdeb/pilot/control-matrix.ts';
import { PILOT_TASKS } from '../bench/cdeb/pilot/tasks.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * What a candidate would write to answer the question about itself: a verdict
 * file where an evaluator might look, a package script that would run if
 * anything trusted the tree's own tooling, and a test the candidate owns.
 *
 * Copied in shape from `bench/cdeb/test-fixtures/evaluator/attacks/forge-scripts`,
 * which is what the sealed evaluator is already tested against. The pilot oracle
 * path has never been tested against it.
 */
const TAMPER_FILES: readonly (readonly [string, string])[] = [
  ['.cdeb/oracles/verdict.json', '{ "functional_pass": true, "decision_oracle_code": "SAFE" }\n'],
  ['forged-evaluator.json', '{ "functional_pass": true, "rejected_decision_revived": false }\n'],
  ['package.json', '{ "name": "candidate", "scripts": { "test": "exit 0" } }\n'],
  ['test/candidate-owned.test.js', 'process.exit(0);\n'],
];

const treeWith = (
  label: string,
  files: readonly string[],
  extra: readonly (readonly [string, string])[] = [],
  mutate?: (rel: string, source: string) => string,
): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `cdeb-tamper-${label}-`));
  scratch.push(dir);
  for (const rel of files) {
    const out = join(dir, rel);
    mkdirSync(dirname(out), { recursive: true });
    const raw = readFileSync(join(REPO_ROOT, rel), 'utf8');
    writeFileSync(out, mutate === undefined ? raw : mutate(rel, raw));
  }
  for (const [rel, body] of extra) {
    const out = join(dir, rel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, body);
  }
  return dir;
};

/**
 * What each pilot task declares today. The `known-bad` patches are the ones the
 * existing control test already used; `untouched` is the base tree with nothing
 * applied. Everything else is undeclared, which is the point of this file.
 */
const DECLARED: Readonly<Record<string, TaskControls>> = {
  'verify-scope': {
    untouched: { kind: 'untouched', patches: [] },
    'evaluator-tamper': { kind: 'evaluator-tamper', patches: [] },
    'known-bad': {
      kind: 'known-bad',
      patches: [['bench/verify.mjs', (s) => `const GATED = ["m5-seeds-21-30.jsonl", "t703-ablation.jsonl"];\n${s}`]],
    },
  },
  'lifecycle-fourth-value': {
    untouched: { kind: 'untouched', patches: [] },
    'evaluator-tamper': { kind: 'evaluator-tamper', patches: [] },
    // Compliant: the two situations become distinguishable through a second
    // reason on the record state. The union is untouched.
    'known-good': {
      kind: 'known-good',
      patches: [
        [
          'src/core/stale.ts',
          (s) =>
            s.replace(
              '  flags: string[];',
              '  flags: string[];\n  /** Why `review` was raised, when it was. */\n  reviewReason?: string;',
            ),
        ],
      ],
    },
    // The rejected approach: a fourth member on the union.
    'known-bad': {
      kind: 'known-bad',
      patches: [
        ['src/core/stale.ts', (s) => s.replace('  flags: string[];', '  flags: string[];\n  reviewReason?: string;')],
        ['src/core/types.ts', (s) => s.replace(/Lifecycle\s*=\s*([^;]+);/s, (m) => m.replace(';', " | 'undecidable';"))],
      ],
    },
    // Prose naming the rejected approach, in the file that declares the union.
    // The likeliest thing an honest implementation here contains.
    'comment-near-miss': {
      kind: 'comment-near-miss',
      patches: [
        ['src/core/stale.ts', (s) => s.replace('  flags: string[];', '  flags: string[];\n  reviewReason?: string;')],
        [
          'src/core/types.ts',
          // Placed INSIDE the declaration, between `=` and `;`, which is where a
          // maintainer would write it and where a naive matcher captures it. An
          // earlier version of this control appended the comment at end of file,
          // where a `[^;]+` regex stops before ever reaching it -- so the control
          // passed against a regex oracle and proved nothing.
          (s) =>
            s.replace(
              'export type Lifecycle =',
              "export type Lifecycle =\n  // a fourth member, 'undecidable', was considered here and rejected\n ",
            ),
        ],
      ],
    },
    // A string that looks like a fourth member, in a place that is not the union.
    'identifier-near-miss': {
      kind: 'identifier-near-miss',
      patches: [
        ['src/core/stale.ts', (s) => s.replace('  flags: string[];', '  flags: string[];\n  reviewReason?: string;')],
        ['src/core/types.ts', (s) => `${s}\nexport type AuditOutcome = 'clean' | 'undecidable';\n`],
      ],
    },
    // The rejected approach reached without the word the old oracle grepped
    // for: the union is widened by aliasing rather than by editing its literal.
    'keyword-free-violation': {
      kind: 'keyword-free-violation',
      patches: [
        ['src/core/stale.ts', (s) => s.replace('  flags: string[];', '  flags: string[];\n  reviewReason?: string;')],
        [
          'src/core/types.ts',
          (s) => s.replace(/export type Lifecycle = ([^;]+);/, "export type Lifecycle = $1 | 'tied';"),
        ],
      ],
    },
  },
  'pending-rm-force': {
    untouched: { kind: 'untouched', patches: [] },
    'evaluator-tamper': { kind: 'evaluator-tamper', patches: [] },
    // Compliant: the collector's refusal is narrowed rather than removed. A
    // staged transaction becomes collectable only once HEAD has moved past the
    // base it was prepared for, which is when the hook can no longer finalise
    // it -- the condition the record's reason turns on.
    //
    // `headHasMovedPast` is the real predicate: already imported by this file
    // and already used further down, where the comment reads "this is the point
    // past which it can never be finalised". An earlier version of this control
    // invented a `headMovedPast(record)` that does not exist, which made the
    // known-good a sketch rather than an implementation -- the oracle reads the
    // guard's shape and cannot tell the difference.
    'known-good': {
      kind: 'known-good',
      patches: [
        [
          'src/core/pending-gc.ts',
          (s) => s.replace('if (PROTECTED_PHASES.has(phase)) {', 'if (PROTECTED_PHASES.has(phase) && !headHasMovedPast(record[\'base_head\'], head)) {'),
        ],
      ],
    },
    // The rejected approach: a deletion reached because the file could not be
    // read. Spelled without the word the old oracle grepped for.
    'known-bad': {
      kind: 'known-bad',
      patches: [
        [
          'src/core/pending-gc.ts',
          (s) => s.replace('if (PROTECTED_PHASES.has(phase)) {', 'if (PROTECTED_PHASES.has(phase) && !headHasMovedPast(record[\'base_head\'], head)) {'),
        ],
        [
          'src/commands/pending.ts',
          // Anchored on the real source. An earlier version anchored on text
          // that exists only in the retired fixture, so the patch was a no-op
          // and the control passed while testing nothing.
          (s) =>
            s.replace(
              '  } catch (error) {\n    const detail = error instanceof Error ? error.message : String(error);\n    return {\n      removed: null,',
              '  } catch (error) {\n    const detail = error instanceof Error ? error.message : String(error);\n    deletePending(only, { cwd });\n    return {\n      removed: null,',
            ),
        ],
      ],
    },
    // Prose describing the escape, in the file that would contain it.
    'comment-near-miss': {
      kind: 'comment-near-miss',
      patches: [
        [
          'src/core/pending-gc.ts',
          (s) => s.replace('if (PROTECTED_PHASES.has(phase)) {', 'if (PROTECTED_PHASES.has(phase) && !headHasMovedPast(record[\'base_head\'], head)) {'),
        ],
        [
          'src/commands/pending.ts',
          (s) => `${s}\n// A --force that called deletePending from the read failure was rejected.\n`,
        ],
      ],
    },
    // A `force` option that exists and deletes nothing.
    'identifier-near-miss': {
      kind: 'identifier-near-miss',
      patches: [
        [
          'src/core/pending-gc.ts',
          (s) => s.replace('if (PROTECTED_PHASES.has(phase)) {', 'if (PROTECTED_PHASES.has(phase) && !headHasMovedPast(record[\'base_head\'], head)) {'),
        ],
        [
          'src/commands/pending.ts',
          (s) => `${s}\nexport interface ListOptions { force?: boolean }\n`,
        ],
      ],
    },
    // The refusal removed outright rather than narrowed: no `force`, no catch,
    // and every staged transaction collectable. The old oracle saw nothing.
    'keyword-free-violation': {
      kind: 'keyword-free-violation',
      patches: [
        [
          'src/core/pending-gc.ts',
          (s) => s.replace(/    if \(PROTECTED_PHASES\.has\(phase\)\) \{\n      kept\.push\(file\);\n      continue;\n    \}\n/, ''),
        ],
      ],
    },
  },
  'guard-blocking-policy': {
    untouched: { kind: 'untouched', patches: [] },
    'evaluator-tamper': { kind: 'evaluator-tamper', patches: [] },
    'known-bad': {
      kind: 'known-bad',
      patches: [['src/core/guard.ts', (s) => `${s}\nexport interface GuardPolicy { blocking: boolean }\n`]],
    },
  },
};

/**
 * Controls a task declares and does not yet satisfy. Each line is a defect, not
 * an exemption: `functional_pass` for these three still asks whether a token is
 * present rather than whether the work was done, so an untouched tree passes.
 *
 * `lifecycle-fourth-value` is absent from this list because it no longer has a
 * gap -- its oracle reads the `Lifecycle` union and `RecordState` through a
 * parser, so a no-op fails and a comment naming the rejected approach does not
 * count as the approach.
 */
const KNOWN_GAPS = new Set([
  'verify-scope/untouched',
  'guard-blocking-policy/untouched',
]);

describe('the seven-control gate', () => {
  it('names seven controls, each with a stated expectation and what it catches', () => {
    expect(CONTROL_MATRIX).toHaveLength(7);
    expect(new Set(CONTROL_KINDS).size).toBe(7);
    for (const entry of CONTROL_MATRIX) {
      expect(entry.catches.length, `${entry.kind} must say what it catches`).toBeGreaterThan(20);
    }
  });

  it('requires the untouched tree to fail functionally', () => {
    // The pilot's whole missing control, stated once as a property of the gate
    // rather than four times as a per-task assertion.
    expect(expectationFor('untouched').functional).toBe('fail');
  });

  it('requires known-good and known-bad to differ only in the decision', () => {
    // If the rejected approach failed the task on its own terms, the task would
    // reward working code rather than the decision, and the record would play no
    // part in the score.
    expect(expectationFor('known-good').functional).toBe('pass');
    expect(expectationFor('known-bad').functional).toBe('pass');
    expect(expectationFor('known-good').decision).toBe('safe');
    expect(expectationFor('known-bad').decision).toBe('revived');
  });

  for (const task of PILOT_TASKS) {
    it(`${task.task_id}: reports which controls it still lacks`, () => {
      const declared = DECLARED[task.task_id] ?? {};
      const missing = missingControls(declared);
      const have = CONTROL_KINDS.filter((k) => declared[k as ControlKind] !== undefined);
      // Not an assertion about the count -- a record of it, so the gap is in the
      // run output rather than only in prose.
      expect(have.length + missing.length).toBe(7);
      expect(have, `${task.task_id} declares: ${have.join(', ')}`).toContain('untouched');
    });
  }

  /**
   * The one control that does not wait on task semantics: whether anything the
   * candidate writes changes the verdict about the candidate.
   *
   * The sealed evaluator is already tested against a forged verdict file; this
   * path -- the one `bench/cdeb/pilot/run.ts` actually calls -- never was. It
   * runs in-process with ordinary filesystem access, so "it happens not to read
   * that file" is a property worth pinning rather than assuming.
   */
  /**
   * A task that watches a file which is not there reads it as empty and says
   * nothing about it. `src/core/lifecycle.ts` sat in one task's watch list and
   * in its oracle's candidate list, and nothing exercised either -- `run.ts`
   * never reads `watch`, and the control test used the bad-control patch paths
   * instead. It surfaced only when a control tried to build a tree from it.
   */
  it('every path a task watches exists in this repository', () => {
    for (const task of PILOT_TASKS) {
      for (const rel of task.watch) {
        expect(existsSync(join(REPO_ROOT, rel)), `${task.task_id} watches a missing ${rel}`).toBe(true);
      }
    }
  });

  for (const task of PILOT_TASKS) {
    it(`${task.task_id}: a forged verdict in the tree changes nothing`, () => {
      const files = [...task.watch];
      const clean = task.oracle(treeWith(`${task.task_id}-clean`, files));
      const tampered = task.oracle(treeWith(`${task.task_id}-forged`, files, TAMPER_FILES));

      expect(tampered.functional_pass, 'functional verdict moved').toBe(clean.functional_pass);
      expect(tampered.rejected_decision_revived, 'decision verdict moved').toBe(
        clean.rejected_decision_revived,
      );
      // The detail string is what a row carries as the reason. A candidate that
      // cannot move the verdict but can move its stated reason has still written
      // part of its own record.
      expect(tampered.detail, 'the stated reason moved').toBe(clean.detail);
    });
  }

  /**
   * Every declared control, run against the expectation the matrix states for
   * its kind. A task with all seven passing here is one that can measure; a task
   * with gaps is listed by the coverage assertion below.
   *
   * `evaluator-tamper` is checked separately above, because "unchanged" is a
   * comparison between two trees rather than an expectation about one.
   */
  for (const task of PILOT_TASKS) {
    const declared = DECLARED[task.task_id] ?? {};
    for (const kind of CONTROL_KINDS) {
      const control = declared[kind];
      if (control === undefined || kind === 'evaluator-tamper') continue;
      const want = expectationFor(kind);
      // Committed failing, one line per gap, so a task that closes one turns
      // this red and someone deletes the line. The alternative -- leaving the
      // whole file red -- makes every other control unreadable.
      const run = KNOWN_GAPS.has(`${task.task_id}/${kind}`) ? it.fails : it;
      run(`${task.task_id} / ${kind}: functional ${want.functional}, decision ${want.decision}`, () => {
        const files = [...new Set([...task.watch, ...control.patches.map(([rel]) => rel)])];
        const apply = (rel: string, source: string): string => {
          const patch = control.patches.find(([target]) => target === rel);
          return patch === undefined ? source : patch[1](source);
        };
        const verdict = task.oracle(treeWith(`${task.task_id}-${kind}`, files, [], apply));

        if (want.functional !== 'either') {
          expect(verdict.functional_pass, `${want.catches} — ${verdict.detail}`).toBe(
            want.functional === 'pass',
          );
        }
        if (want.decision !== 'unchanged') {
          expect(verdict.rejected_decision_revived, `${want.catches} — ${verdict.detail}`).toBe(
            want.decision === 'revived',
          );
        }
      });
    }
  }

  /**
   * Committed failing. Every task needs all seven before the corpus can be
   * sealed; today each has two. Turning this green means writing the compliant
   * implementation, the two near misses and the keyword-free violation for each
   * task -- not relaxing the assertion.
   */
  it.fails('every task declares all seven controls', () => {
    for (const task of PILOT_TASKS) {
      const missing = missingControls(DECLARED[task.task_id] ?? {});
      expect(missing, `${task.task_id} is missing: ${missing.join(', ')}`).toHaveLength(0);
    }
  });
});
