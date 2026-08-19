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

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

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
