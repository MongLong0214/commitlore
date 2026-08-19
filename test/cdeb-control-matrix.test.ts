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

import { describe, expect, it } from 'vitest';

import {
  CONTROL_KINDS,
  CONTROL_MATRIX,
  expectationFor,
  missingControls,
  type ControlKind,
  type TaskControls,
} from '../bench/cdeb/pilot/control-matrix.ts';
import { PILOT_TASKS } from '../bench/cdeb/pilot/tasks.ts';

/**
 * What each pilot task declares today. The `known-bad` patches are the ones the
 * existing control test already used; `untouched` is the base tree with nothing
 * applied. Everything else is undeclared, which is the point of this file.
 */
const DECLARED: Readonly<Record<string, TaskControls>> = {
  'verify-scope': {
    untouched: { kind: 'untouched', patches: [] },
    'known-bad': {
      kind: 'known-bad',
      patches: [['bench/verify.mjs', (s) => `const GATED = ["m5-seeds-21-30.jsonl", "t703-ablation.jsonl"];\n${s}`]],
    },
  },
  'lifecycle-fourth-value': {
    untouched: { kind: 'untouched', patches: [] },
    'known-bad': {
      kind: 'known-bad',
      patches: [['src/core/types.ts', (s) => s.replace(/Lifecycle\s*=\s*([^;]+);/s, (m) => m.replace(';', " | 'orphaned';"))]],
    },
  },
  'pending-rm-force': {
    untouched: { kind: 'untouched', patches: [] },
    'known-bad': {
      kind: 'known-bad',
      patches: [['src/commands/pending.ts', (s) => `${s}\nexport const FORCE_FLAG = '--force';\n`]],
    },
  },
  'guard-blocking-policy': {
    untouched: { kind: 'untouched', patches: [] },
    'known-bad': {
      kind: 'known-bad',
      patches: [['src/core/guard.ts', (s) => `${s}\nexport interface GuardPolicy { blocking: boolean }\n`]],
    },
  },
};

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
