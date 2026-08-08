/**
 * CDEB §4.6 acceptance (#457): the runtime-boundedness gate admits and rejects
 * the cases the pilot actually produced.
 *
 * The decision function is tested against real pilot numbers rather than round
 * ones, so a case that passes is a case the study saw. `qualifyRuntime` is pure
 * — it takes probe results and returns a verdict — which is why the gate can be
 * tested without spending two agent sessions per assertion. `runProbe` spends
 * them; the split is deliberate and is what makes this suite runnable in CI.
 */

import { describe, expect, it } from 'vitest';

import {
  RUNTIME_FRACTION,
  qualifyRuntime,
  type ProbeCondition,
  type RuntimeProbe,
} from '../bench/cdeb/freeze/runtime-probe.ts';

/** The pilot's per-task budget. */
const BUDGET_MS = 900_000;

/**
 * The model this study is pinned to.
 *
 * Sonnet, because the 0.6 threshold these cases check was derived from Sonnet
 * wall times — the pilot's 0.48-vs-1.00 separation is Sonnet data, and a model
 * change makes the derivation a guess again. M1 and M5 also measured Sonnet, so
 * this keeps CDEB comparable with the evidence already published.
 */
const MODEL = 'sonnet';

const probe = (
  condition: ProbeCondition,
  wall_ms: number,
  stop_reason: RuntimeProbe['stop_reason'] = 'completed',
  model: string = MODEL,
): RuntimeProbe => ({ condition, model, stop_reason, wall_ms, artifact_sha256: 'a'.repeat(64) });

describe('§4.6 runtime-boundedness qualification', () => {
  it('qualifies a task at the pilot\'s fastest observed pair', () => {
    // guard-blocking-policy: 80 s off, 89 s on.
    const result = qualifyRuntime(
      [probe('commitlore-off', 80_000), probe('commitlore-on', 89_000)],
      BUDGET_MS,
      MODEL,
    );
    expect(result.qualified, result.reasons.join('; ')).toBe(true);
    expect(result.threshold_ms).toBe(540_000);
  });

  it('rejects the task that timed out in all four pilot runs', () => {
    // lifecycle-fourth-value: 902 s and 903 s, both arms, every run.
    const result = qualifyRuntime(
      [probe('commitlore-off', 902_000, 'timeout'), probe('commitlore-on', 903_000, 'timeout')],
      BUDGET_MS,
      MODEL,
    );
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/stopped as timeout/);
  });

  it('qualifies the pilot\'s slowest completed run — 431 s is 0.48 of budget', () => {
    // The observed separation: completed runs topped out at 0.48, the failing
    // task sat at 1.00, and the threshold sits between without touching either.
    const result = qualifyRuntime(
      [probe('commitlore-off', 88_000), probe('commitlore-on', 431_000)],
      BUDGET_MS,
      MODEL,
    );
    expect(result.qualified, result.reasons.join('; ')).toBe(true);
    expect(431_000 / BUDGET_MS).toBeLessThan(RUNTIME_FRACTION);
  });

  it('judges on the slower arm, so a fast arm cannot carry a slow one in', () => {
    const result = qualifyRuntime(
      [probe('commitlore-off', 10_000), probe('commitlore-on', 700_000)],
      BUDGET_MS,
      MODEL,
    );
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/slowest probe 700000ms exceeds the 540000ms/);
  });

  it('refuses a single-arm qualification — runtime is treatment-sensitive', () => {
    // Qualifying on one arm selects a corpus that arm finishes faster, and the
    // bias is not separable from the result afterwards.
    const result = qualifyRuntime([probe('commitlore-on', 100_000)], BUDGET_MS, MODEL);
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/both arms are required/);
  });

  it('refuses two probes of the same arm', () => {
    const result = qualifyRuntime(
      [probe('commitlore-on', 100_000), probe('commitlore-on', 110_000)],
      BUDGET_MS,
      MODEL,
    );
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/both arms are required/);
  });

  it('refuses an arm that errored, however fast it did so', () => {
    const result = qualifyRuntime(
      [probe('commitlore-off', 5_000, 'agent_error'), probe('commitlore-on', 90_000)],
      BUDGET_MS,
      MODEL,
    );
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/stopped as agent_error/);
  });

  it('exposes only fields the selector is allowed to see', () => {
    // Reading an outcome to decide corpus membership would be selection on the
    // dependent variable. The probe type must not carry one.
    const keys = Object.keys(probe('commitlore-on', 1_000));
    expect(keys.sort()).toEqual(['artifact_sha256', 'condition', 'model', 'stop_reason', 'wall_ms']);
    for (const forbidden of ['functional_pass', 'rejected_decision_revived', 'decision_safe_success']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('refuses a probe run on a model the study is not pinned to', () => {
    // The qualification decides corpus membership by runtime. A probe on
    // another model screens a distribution the study will never produce, so
    // §2.2's "model change means a new study" reaches this gate too.
    const result = qualifyRuntime(
      [probe('commitlore-off', 80_000), probe('commitlore-on', 89_000, 'completed', 'opus')],
      BUDGET_MS,
      MODEL,
    );
    expect(result.qualified).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/probed opus but the study is pinned to sonnet/);
  });
});
