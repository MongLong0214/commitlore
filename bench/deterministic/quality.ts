import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadTasks } from '../task-loader.ts';
import { createWorkspace, destroyWorkspace } from '../workspace.ts';
import { scanInjection } from '../../dist/core/grade.js';
import { DEFAULT_THRESHOLD, guard } from '../../dist/core/guard.js';
import { parseCommitMessage } from '../../dist/core/trailers.js';
import type { GuardQualityRow, InjectionDetectionRow, RowBase } from './types.ts';

interface InjectionExpected {
  readonly blocked: boolean;
}

interface GuardArtifact {
  readonly task: string;
  readonly cond: string;
  readonly seed: number;
  readonly reproposed: boolean;
  readonly diff: string;
}

const objectField = (value: unknown, name: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;

const stringField = (value: unknown, name: string): string => {
  const field = objectField(value, name);
  if (typeof field !== 'string') throw new Error(`${name} must be a string`);
  return field;
};

const booleanField = (value: unknown, name: string): boolean => {
  const field = objectField(value, name);
  if (typeof field !== 'boolean') throw new Error(`${name} must be a boolean`);
  return field;
};

const numberField = (value: unknown, name: string): number => {
  const field = objectField(value, name);
  if (typeof field !== 'number') throw new Error(`${name} must be a number`);
  return field;
};

const loadExpected = (path: string): InjectionExpected => {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return { blocked: booleanField(parsed, 'blocked') };
};

export const measureInjectionDetection = (
  base: RowBase,
  repoRoot: string,
): InjectionDetectionRow => {
  const fixtureRoot = join(repoRoot, 'spec', 'fixtures', 'injection');
  const names = readdirSync(fixtureRoot)
    .filter((name) => name.endsWith('.txt'))
    .map((name) => name.slice(0, -4))
    .sort();

  let truePositives = 0;
  let falseNegatives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  for (const name of names) {
    const message = readFileSync(join(fixtureRoot, `${name}.txt`), 'utf8');
    const expected = loadExpected(join(fixtureRoot, `${name}.expected.json`));
    const warn = parseCommitMessage(message).find((trailer) => trailer.key === 'Warn')?.value;
    if (warn === undefined) throw new Error(`${name}: injection fixture has no Warn trailer`);
    const detected = scanInjection(warn).length > 0;
    if (expected.blocked && detected) truePositives += 1;
    else if (expected.blocked) falseNegatives += 1;
    else if (detected) falsePositives += 1;
    else trueNegatives += 1;
  }

  const positives = truePositives + falseNegatives;
  const negatives = falsePositives + trueNegatives;
  if (positives === 0 || negatives === 0) throw new Error('injection corpus needs both labels');
  return {
    ...base,
    metric: 'injection_detection',
    corpus: 'spec/fixtures/injection',
    positives,
    negatives,
    true_positives: truePositives,
    false_negatives: falseNegatives,
    false_positives: falsePositives,
    true_negatives: trueNegatives,
    true_positive_rate: truePositives / positives,
    false_positive_rate: falsePositives / negatives,
  };
};

const loadGuardArtifact = (path: string): GuardArtifact => {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return {
    task: stringField(parsed, 'task'),
    cond: stringField(parsed, 'cond'),
    seed: numberField(parsed, 'seed'),
    reproposed: booleanField(parsed, 'reproposed'),
    diff: stringField(parsed, 'diff'),
  };
};

export const measureGuardQuality = (
  base: RowBase,
  repoRoot: string,
): GuardQualityRow => {
  const corpus = 'bench/results/transcripts-final';
  const artifactRoot = join(repoRoot, corpus);
  const artifacts = readdirSync(artifactRoot)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => loadGuardArtifact(join(artifactRoot, name)))
    .filter((artifact) => artifact.cond === 'commitlore-on');
  const tasks = new Map(
    loadTasks(join(repoRoot, 'bench', 'tasks')).map((task) => [task.id, task]),
  );
  const workspaces = new Map<string, string>();

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;
  try {
    for (const artifact of artifacts) {
      const task = tasks.get(artifact.task);
      if (task === undefined) throw new Error(`no task fixture for ${artifact.task}`);
      let workspace = workspaces.get(task.id);
      if (workspace === undefined) {
        workspace = createWorkspace(task, artifact.seed, repoRoot).dir;
        workspaces.set(task.id, workspace);
      }
      const detected =
        guard({
          proposal: artifact.diff,
          cwd: workspace,
          threshold: DEFAULT_THRESHOLD,
          noIndex: true,
        }).matches.length > 0;
      if (artifact.reproposed && detected) truePositives += 1;
      else if (artifact.reproposed) falseNegatives += 1;
      else if (detected) falsePositives += 1;
      else trueNegatives += 1;
    }
  } finally {
    for (const workspace of workspaces.values()) destroyWorkspace(workspace);
  }

  const predictedPositive = truePositives + falsePositives;
  const actualPositive = truePositives + falseNegatives;
  if (predictedPositive === 0 || actualPositive === 0) {
    throw new Error('guard corpus produced an undefined precision or recall');
  }
  return {
    ...base,
    metric: 'guard_quality',
    corpus,
    threshold: DEFAULT_THRESHOLD,
    true_positives: truePositives,
    false_positives: falsePositives,
    false_negatives: falseNegatives,
    true_negatives: trueNegatives,
    precision: truePositives / predictedPositive,
    recall: truePositives / actualPositive,
  };
};
