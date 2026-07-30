import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadTasks } from '../task-loader.ts';
import { createWorkspace, destroyWorkspace } from '../workspace.ts';
import { scanInjection } from '../../dist/core/grade.js';
import { DEFAULT_THRESHOLD, guard } from '../../dist/core/guard.js';
import { parseCommitMessage } from '../../dist/core/trailers.js';
import type {
  GuardQualityRow,
  GuardScoreBand,
  GuardThresholdPoint,
  InjectionDetectionRow,
  PrecisionInterval,
  RowBase,
} from './types.ts';

interface InjectionExpected {
  readonly blocked: boolean;
}

interface AdversarialCorpus {
  readonly label: string;
  readonly source: string;
  readonly cases: readonly { readonly name: string; readonly payload: string }[];
}

interface GuardArtifact {
  readonly task: string;
  readonly cond: string;
  readonly seed: number;
  readonly diff: string;
}

export interface GuardCorpusDecision extends GuardArtifact {
  readonly artifact: string;
  readonly reproposed: boolean;
  readonly basis: string;
  readonly disagreement?: string;
}

export interface GuardScoredDecision {
  readonly reproposed: boolean;
  readonly score: number | undefined;
}

export const GUARD_THRESHOLD_STEP = 0.05;
const WILSON_Z_95 = 1.959963984540054;

export const wilsonPrecisionInterval = (
  successes: number,
  trials: number,
): PrecisionInterval => {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || successes < 0 || successes > trials || trials === 0) {
    throw new Error('Wilson interval needs integer successes between zero and a positive number of trials');
  }
  const proportion = successes / trials;
  const zSquared = WILSON_Z_95 ** 2;
  const denominator = 1 + zSquared / trials;
  const center = (proportion + zSquared / (2 * trials)) / denominator;
  const margin =
    (WILSON_Z_95 * Math.sqrt(proportion * (1 - proportion) / trials + zSquared / (4 * trials ** 2))) /
    denominator;
  return { level: 0.95, lower: center - margin, upper: center + margin };
};

export const sweepGuardThresholds = (
  decisions: readonly GuardScoredDecision[],
  step = GUARD_THRESHOLD_STEP,
): readonly GuardThresholdPoint[] => {
  if (!(Number.isFinite(step) && step >= 0.01 && step <= 1)) {
    throw new Error('guard threshold step must be between 0.01 and 1');
  }
  const positives = decisions.filter((decision) => decision.reproposed).length;
  if (positives === 0) throw new Error('guard corpus needs at least one positive label');
  const points: GuardThresholdPoint[] = [];
  const steps = Math.ceil(1 / step);
  for (let index = 0; index <= steps; index += 1) {
    const threshold = Number(Math.min(index * step, 1).toFixed(12));
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let trueNegatives = 0;
    for (const decision of decisions) {
      const detected = decision.score !== undefined && decision.score >= threshold;
      if (decision.reproposed && detected) truePositives += 1;
      else if (decision.reproposed) falseNegatives += 1;
      else if (detected) falsePositives += 1;
      else trueNegatives += 1;
    }
    const firings = truePositives + falsePositives;
    const precision = firings === 0 ? null : truePositives / firings;
    const recall = truePositives / positives;
    points.push({
      threshold,
      true_positives: truePositives,
      false_positives: falsePositives,
      false_negatives: falseNegatives,
      true_negatives: trueNegatives,
      precision,
      recall,
      f1: precision === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall),
      firings,
      correct_silences: trueNegatives,
    });
  }
  return points;
};

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

const arrayField = (value: unknown, name: string): readonly unknown[] => {
  const field = objectField(value, name);
  if (!Array.isArray(field)) throw new Error(`${name} must be an array`);
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

  // Separate from the pattern-authored corpus above: this set was written
  // without reading `INJECTION_PATTERNS` (GitHub issue #70), so it is the
  // closest thing this suite has to an independent detection-rate estimate.
  // Mixing it into the count above would let a corpus scored by its own
  // authors stand in for one it did not write.
  const adversarialPath = join(fixtureRoot, 'adversarial.json');
  const adversarial = JSON.parse(readFileSync(adversarialPath, 'utf8')) as AdversarialCorpus;
  if (adversarial.cases.length === 0) throw new Error('adversarial corpus is empty');
  const adversarialDetected = adversarial.cases.filter(
    (candidate) => scanInjection(candidate.payload).length > 0,
  ).length;

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
    adversarial_corpus: 'spec/fixtures/injection/adversarial.json',
    adversarial_source: adversarial.source,
    adversarial_total: adversarial.cases.length,
    adversarial_detected: adversarialDetected,
  };
};

const loadGuardArtifact = (path: string): GuardArtifact => {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return {
    task: stringField(parsed, 'task'),
    cond: stringField(parsed, 'cond'),
    seed: numberField(parsed, 'seed'),
    diff: stringField(parsed, 'diff'),
  };
};

export const loadGuardCorpus = (repoRoot: string): readonly GuardCorpusDecision[] => {
  const fixture = JSON.parse(
    readFileSync(join(repoRoot, 'bench', 'fixtures', 'guard-quality.json'), 'utf8'),
  ) as unknown;
  const seen = new Set<string>();
  return arrayField(fixture, 'cases').map((candidate) => {
    const artifact = stringField(candidate, 'artifact');
    if (
      !artifact.startsWith('bench/results/transcripts') ||
      !artifact.endsWith('.json') ||
      artifact.includes('..') ||
      seen.has(artifact)
    ) {
      throw new Error(`invalid or duplicate guard corpus artifact: ${artifact}`);
    }
    seen.add(artifact);
    const loaded = loadGuardArtifact(join(repoRoot, artifact));
    const disagreement = objectField(candidate, 'disagreement');
    if (disagreement !== undefined && typeof disagreement !== 'string') {
      throw new Error('disagreement must be a string');
    }
    return {
      ...loaded,
      artifact,
      reproposed: booleanField(candidate, 'reproposed'),
      basis: stringField(candidate, 'basis'),
      ...(disagreement === undefined ? {} : { disagreement }),
    };
  });
};

/**
 * Fixed, not fit to any single run's data — issue #61 rejected choosing a
 * boundary from the same firings it would then describe as "the noise floor"
 * or "the reliable band", which is post-hoc subset selection with a different
 * name (`bench/PREREGISTRATION.md` §4 already forbids that shape for the
 * behavior benchmark). The floor is `DEFAULT_THRESHOLD`; the other edges are
 * round numbers chosen before looking at where any particular run's scores
 * happen to fall.
 */
const GUARD_SCORE_BAND_EDGES: readonly number[] = [DEFAULT_THRESHOLD, 0.5, 0.75, 1.0];

const bandIndexOf = (score: number): number => {
  for (let index = 0; index < GUARD_SCORE_BAND_EDGES.length - 1; index += 1) {
    const min = GUARD_SCORE_BAND_EDGES[index] ?? 0;
    const max = GUARD_SCORE_BAND_EDGES[index + 1] ?? 1;
    const isLastBand = index === GUARD_SCORE_BAND_EDGES.length - 2;
    if (score >= min && (score < max || isLastBand)) return index;
  }
  throw new Error(`score ${score} outside the guard band edges`);
};

export const measureGuardQuality = (
  base: RowBase,
  repoRoot: string,
): GuardQualityRow => {
  const corpus = 'bench/fixtures/guard-quality.json';
  const artifacts = loadGuardCorpus(repoRoot);
  const tasks = new Map(
    loadTasks(join(repoRoot, 'bench', 'tasks')).map((task) => [task.id, task]),
  );
  const workspaces = new Map<string, string>();

  const decisions: GuardScoredDecision[] = [];
  const bandFirings = new Array<number>(GUARD_SCORE_BAND_EDGES.length - 1).fill(0);
  const bandCorrect = new Array<number>(GUARD_SCORE_BAND_EDGES.length - 1).fill(0);
  try {
    for (const artifact of artifacts) {
      const task = tasks.get(artifact.task);
      if (task === undefined) throw new Error(`no task fixture for ${artifact.task}`);
      let workspace = workspaces.get(task.id);
      if (workspace === undefined) {
        workspace = createWorkspace(task, artifact.seed, repoRoot).dir;
        workspaces.set(task.id, workspace);
      }
      // `guard` sorts matches strongest first (`compareMatches`), so the top
      // score is what decided this firing.
      const matches = guard({
        proposal: artifact.diff,
        cwd: workspace,
        threshold: 0,
        noIndex: true,
      }).matches;
      const topScore = matches[0]?.score;
      decisions.push({ reproposed: artifact.reproposed, score: topScore });

      if (topScore !== undefined && topScore >= DEFAULT_THRESHOLD) {
        const band = bandIndexOf(topScore);
        bandFirings[band] = (bandFirings[band] ?? 0) + 1;
        if (artifact.reproposed) bandCorrect[band] = (bandCorrect[band] ?? 0) + 1;
      }
    }
  } finally {
    for (const workspace of workspaces.values()) destroyWorkspace(workspace);
  }

  const curve = sweepGuardThresholds(decisions);
  const defaultPoint = curve.find((point) => point.threshold === DEFAULT_THRESHOLD);
  if (defaultPoint === undefined || defaultPoint.precision === null) {
    throw new Error('guard corpus produced an undefined default precision');
  }
  const bands: GuardScoreBand[] = [];
  for (let index = 0; index < GUARD_SCORE_BAND_EDGES.length - 1; index += 1) {
    bands.push({
      min: GUARD_SCORE_BAND_EDGES[index] ?? 0,
      max: GUARD_SCORE_BAND_EDGES[index + 1] ?? 1,
      firings: bandFirings[index] ?? 0,
      correct: bandCorrect[index] ?? 0,
    });
  }
  return {
    ...base,
    metric: 'guard_quality',
    corpus,
    threshold: DEFAULT_THRESHOLD,
    true_positives: defaultPoint.true_positives,
    false_positives: defaultPoint.false_positives,
    false_negatives: defaultPoint.false_negatives,
    true_negatives: defaultPoint.true_negatives,
    precision: defaultPoint.precision,
    recall: defaultPoint.recall,
    firings: defaultPoint.firings,
    bands,
    curve_step: GUARD_THRESHOLD_STEP,
    curve,
    precision_interval: wilsonPrecisionInterval(defaultPoint.true_positives, defaultPoint.firings),
  };
};
