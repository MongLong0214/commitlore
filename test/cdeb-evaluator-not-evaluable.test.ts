/**
 * A tree the evaluator refused is not evidence that the rejected approach is
 * absent from it.
 *
 * The engine used to answer the decision question for a refused tree by running
 * the oracle against an empty directory. An empty tree contains no revival, so
 * every refusal recorded `decision_oracle_code: "SAFE"` and
 * `rejected_decision_revived: false` -- a positive finding about bytes nobody
 * read. `analyze.ts` then counted those runs on the not-revived side of both
 * arms, which biases the revival secondary outcome toward safety in exactly the
 * arm that fails more often.
 *
 * The refusal is now its own verdict: `NOT_EVALUABLE`, with `null` beside it.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { evaluateTask } from '../bench/cdeb/evaluator/engine.ts';
import type { IngestedTree, TaskEvaluator, TreeView } from '../bench/cdeb/evaluator/types.ts';

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cdeb-not-evaluable-'));
  temps.push(dir);
  return dir;
};

/**
 * An oracle that answers REVIVED for any tree it is given, including an empty
 * one. If the engine ever runs the oracle on a refused tree again, this task
 * reports REVIVED rather than SAFE and the assertion below still catches it --
 * the test must not depend on which wrong answer the old path produced.
 */
const alwaysRevived: TaskEvaluator = {
  task_id: 'not-evaluable-probe',
  functional_checks: (): { name: string; passed: boolean }[] => [{ name: 'unreachable', passed: true }],
  decision_oracle: (_view: TreeView) => 'REVIVED' as const,
};

const refusedTree = (root: string): IngestedTree => ({
  root,
  candidate_tree_oid: '0'.repeat(40),
  refusal: { code: 'path-escapes-tree', detail: 'synthetic refusal for this test' },
});

describe('a refused tree is NOT_EVALUABLE, not SAFE', () => {
  it('reports NOT_EVALUABLE with a null boolean beside it', () => {
    const dir = scratch();
    const verdict = evaluateTask({
      task: alwaysRevived,
      tree: refusedTree(join(dir, 'tree')),
      scratchDir: dir,
      evaluator_image_digest: `sha256:${'a'.repeat(64)}`,
    });

    expect(verdict.decision_oracle_code).toBe('NOT_EVALUABLE');
    expect(verdict.rejected_decision_revived, 'null, because nothing was judged').toBeNull();
    expect(verdict.functional_pass, 'a refusal is still a functional failure').toBe(false);
  });

  it('does not consult the task oracle at all', () => {
    // The probe oracle answers REVIVED unconditionally. A NOT_EVALUABLE verdict
    // therefore proves the engine never asked it, rather than proving the empty
    // tree happened to look safe.
    let asked = 0;
    const counting: TaskEvaluator = {
      ...alwaysRevived,
      decision_oracle: () => {
        asked += 1;
        return 'REVIVED' as const;
      },
    };
    const dir = scratch();
    const verdict = evaluateTask({
      task: counting,
      tree: refusedTree(join(dir, 'tree')),
      scratchDir: dir,
      evaluator_image_digest: `sha256:${'b'.repeat(64)}`,
    });

    expect(asked, 'the oracle must not be asked about a tree that was refused').toBe(0);
    expect(verdict.decision_oracle_code).toBe('NOT_EVALUABLE');
  });
});

/**
 * Widening the enum and widening the boolean are two independent changes, and
 * together they made four pairs representable that could not exist before --
 * including `NOT_EVALUABLE` beside `false`, which is the unread-as-absent claim
 * this whole change removes, re-expressible with the new code sitting next to
 * it. The schema states the dependency so a hand-written or migrated row cannot
 * carry it.
 */
describe('the schema rejects a code and a boolean that disagree', () => {
  const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(
    JSON.parse(readFileSync(join(REPO_ROOT, 'bench/cdeb/schemas/evaluator.schema.json'), 'utf8')),
  );
  const base = {
    schema_version: 1,
    task_id: 't',
    functional_pass: false,
    functional_checks: { passed: 0, failed: 1 },
    evaluator_image_digest: `sha256:${'a'.repeat(64)}`,
    candidate_tree_oid: '0'.repeat(40),
  };

  it.each([
    ['NOT_EVALUABLE with null — the only honest unjudged shape', 'NOT_EVALUABLE', null, true],
    ['NOT_EVALUABLE with false — the old unread-as-absent claim', 'NOT_EVALUABLE', false, false],
    ['NOT_EVALUABLE with true', 'NOT_EVALUABLE', true, false],
    ['SAFE with null', 'SAFE', null, false],
    ['REVIVED with null', 'REVIVED', null, false],
    ['SAFE with true — the two fields disagreeing', 'SAFE', true, false],
    ['REVIVED with true', 'REVIVED', true, true],
    ['SAFE with false', 'SAFE', false, true],
  ])('%s', (_label, code, revived, expected) => {
    expect(validate({ ...base, decision_oracle_code: code, rejected_decision_revived: revived })).toBe(expected);
  });
});
