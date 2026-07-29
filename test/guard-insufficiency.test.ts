/**
 * ADR-0019 falsification condition: the current signals cannot separate
 * revivals from coincidental matches.
 *
 * This test pins the structural finding. It is falsified (and should be removed)
 * if a reweighting of the current three signals — token Jaccard, keyword
 * strength, Record-Id hit — produces a precision whose 95% Wilson lower bound
 * exceeds the current upper bound (57.5%) without reducing recall below 22.0%,
 * on the unchanged 417-decision corpus.
 */

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadGuardCorpus,
  sweepGuardThresholds,
  wilsonPrecisionInterval,
  type GuardScoredDecision,
} from '../bench/deterministic/quality.ts';
import { createWorkspace, destroyWorkspace } from '../bench/workspace.ts';
import { loadTasks } from '../bench/task-loader.ts';
import { DEFAULT_THRESHOLD, guard } from '../dist/core/guard.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');

/**
 * The upper bound of the current 95% Wilson precision interval (ADR-0016).
 * A threshold change that moves the lower bound above this falsifies ADR-0019.
 */
const CURRENT_PRECISION_UPPER = 0.575;

/** The current recall baseline. A change must not reduce recall below this. */
const CURRENT_RECALL_BASELINE = 0.22;

describe('ADR-0019: guard signal insufficiency', () => {
  it('no threshold of the current signals produces precision lower bound above current upper bound without recall regression', () => {
    const corpus = loadGuardCorpus(REPO_ROOT);
    const tasks = new Map(
      loadTasks(resolve(REPO_ROOT, 'bench', 'tasks')).map((task) => [task.id, task]),
    );
    const workspaces = new Map<string, string>();

    const decisions: GuardScoredDecision[] = [];
    try {
      for (const artifact of corpus) {
        const task = tasks.get(artifact.task);
        if (task === undefined) throw new Error(`no task fixture for ${artifact.task}`);
        let workspace = workspaces.get(task.id);
        if (workspace === undefined) {
          workspace = createWorkspace(task, artifact.seed, REPO_ROOT).dir;
          workspaces.set(task.id, workspace);
        }
        const matches = guard({
          proposal: artifact.diff,
          cwd: workspace,
          threshold: 0,
          noIndex: true,
        }).matches;
        const topScore = matches[0]?.score;
        decisions.push({ reproposed: artifact.reproposed, score: topScore });
      }
    } finally {
      for (const workspace of workspaces.values()) destroyWorkspace(workspace);
    }

    // Sweep all thresholds and check the falsification condition at each
    const curve = sweepGuardThresholds(decisions, 0.01);

    for (const point of curve) {
      if (point.precision === null) continue;
      if (point.recall < CURRENT_RECALL_BASELINE) continue;

      const firings = point.true_positives + point.false_positives;
      if (firings === 0) continue;

      const interval = wilsonPrecisionInterval(point.true_positives, firings);

      // The ADR claims no threshold can beat this. If one does, the ADR is wrong.
      expect(
        interval.lower,
        `threshold ${point.threshold}: precision lower bound ${(interval.lower * 100).toFixed(1)}% ` +
        `should not exceed ${(CURRENT_PRECISION_UPPER * 100).toFixed(1)}% ` +
        `while maintaining recall >= ${(CURRENT_RECALL_BASELINE * 100).toFixed(1)}% ` +
        `(actual recall: ${(point.recall * 100).toFixed(1)}%)`,
      ).toBeLessThanOrEqual(CURRENT_PRECISION_UPPER);
    }
  });

  it('49 false negatives from semantic revivals produce zero corroborated signal', () => {
    // Shape 1 from the analysis: tasks whose FNs all score undefined (zero
    // corroborated matches). We verify at least 49 positives produce no match.
    const corpus = loadGuardCorpus(REPO_ROOT);
    const tasks = new Map(
      loadTasks(resolve(REPO_ROOT, 'bench', 'tasks')).map((task) => [task.id, task]),
    );
    const workspaces = new Map<string, string>();

    const SHAPE1_TASKS = new Set([
      'reproposal-node20-floor',
      'qualification-gitseed-single-smoke-sample',
      'qualification-gitseed-fake-tty',
      'reproposal-jwt-sessions',
      'qualification-gitseed-drop-withheld',
    ]);

    let zeroSignalPositives = 0;
    try {
      for (const artifact of corpus) {
        if (!artifact.reproposed) continue;
        if (!SHAPE1_TASKS.has(artifact.task)) continue;

        const task = tasks.get(artifact.task);
        if (task === undefined) throw new Error(`no task fixture for ${artifact.task}`);
        let workspace = workspaces.get(task.id);
        if (workspace === undefined) {
          workspace = createWorkspace(task, artifact.seed, REPO_ROOT).dir;
          workspaces.set(task.id, workspace);
        }
        const matches = guard({
          proposal: artifact.diff,
          cwd: workspace,
          threshold: 0,
          noIndex: true,
        }).matches;

        if (matches.length === 0 || matches[0]?.score === undefined) {
          zeroSignalPositives += 1;
        }
      }
    } finally {
      for (const workspace of workspaces.values()) destroyWorkspace(workspace);
    }

    // The analysis found exactly 49 positives from these tasks produce zero signal.
    // Assert at least 49 to pin the finding; more would strengthen the claim.
    expect(zeroSignalPositives).toBeGreaterThanOrEqual(49);
  });
});
