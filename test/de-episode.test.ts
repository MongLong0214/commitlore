/**
 * The paired episode's phase order — #1036 and #1034 §5, revision
 * `native-efficacy-r6.1`.
 *
 * Sequence is what this module owns, and sequence is the part of a run that a
 * results file cannot show you: phases that interleaved wrongly produce rows
 * that look exactly like correct ones. So every case here drives the real
 * function with recording effects and asserts against the log of what happened
 * in what order.
 *
 * The rules, from the issues:
 *
 *   - "assign supported shared SOLVE read instant after both handoffs"
 *   - "assign supported shared REPAIR read instant after both first checkpoints"
 *   - "use a shared solve instant after BOTH capture checkpoints, then a shared
 *      repair instant after BOTH first-solve checkpoints and before repair. Do
 *      not use the earlier handoff instant to hide newly created legitimate
 *      solve notes."
 *   - "close all model execution / run frozen audit on saved checkpoints"
 *   - "Never repair failed handoffs, transplant another arm's output or drop
 *      unstarted rows."
 */

import { describe, expect, it } from 'vitest';

import { runEpisode, type EpisodeEffects } from '../bench/de/episode.ts';
import type { NormalizedFeedback } from '../bench/de/repair.ts';
import type { Arm, ScheduledPair } from '../bench/de/schedule.ts';

const pair = (order: readonly [Arm, Arm] = ['off', 'native']): ScheduledPair => ({
  case_id: 'case-1',
  cluster_id: 'cluster-1',
  repetition: 1,
  order,
});

const failing = (): NormalizedFeedback => ({
  trusted: true,
  verdict: {
    score: false,
    coverage: 'complete',
    observed: [{ purpose: 'feedback', id: 'c1', passed: false }],
    unobserved: [],
    untrusted: [],
  },
  public_explanation: true,
  environment_fault: false,
});

const passing = (): NormalizedFeedback => ({
  trusted: true,
  verdict: {
    score: true,
    coverage: 'complete',
    observed: [{ purpose: 'feedback', id: 'c1', passed: true }],
    unobserved: [],
    untrusted: [],
  },
  public_explanation: true,
  environment_fault: false,
});

interface Harness {
  readonly effects: EpisodeEffects;
  readonly log: string[];
}

const harness = (over: Partial<EpisodeEffects> = {}): Harness => {
  const log: string[] = [];
  let ticks = 0;
  const effects: EpisodeEffects = {
    instant: () => {
      ticks += 1;
      const stamp = `t${ticks}`;
      log.push(`instant:${stamp}`);
      return stamp;
    },
    runCapture: async (arm) => {
      log.push(`capture:${arm}`);
      return { handoff: 'valid', committed: `${arm}-commit` };
    },
    runSolve: async (arm, input) => {
      log.push(`solve:${arm}@${input.readInstant}:from=${String(input.committed)}`);
      return { execution: 'completed', checkpoint: 'complete', feedback: failing(), artifact: `${arm}-first` };
    },
    runRepair: async (arm, input) => {
      log.push(`repair:${arm}@${input.readInstant}:checkpointOf=${input.checkpointOf}`);
      return { execution: 'completed', feedback: passing(), artifact: `${arm}-final` };
    },
    runAudit: async (arm, input) => {
      log.push(`audit:${arm}:first=${String(input.first)}:final=${String(input.final)}`);
      return passing();
    },
    ...over,
  };
  return { effects, log };
};

const indexOf = (log: readonly string[], prefix: string): number =>
  log.findIndex((entry) => entry.startsWith(prefix));

describe('#1034 §5 the shared solve instant comes after both handoffs', () => {
  it('draws one instant, after every capture and before any solve', async () => {
    // Per-arm instants would give the arm that captured second a later read
    // time -- and the treatment is the arm that writes notes, so it would be
    // reading its own newer memory under a clock the control never got.
    const { effects, log } = harness();

    const record = await runEpisode(pair(), effects);

    expect(indexOf(log, 'instant:')).toBeGreaterThan(indexOf(log, 'capture:native'));
    expect(indexOf(log, 'instant:')).toBeLessThan(indexOf(log, 'solve:'));
    expect(log.filter((entry) => entry.startsWith('capture:'))).toHaveLength(2);
    expect(record.solveInstant).toBe('t1');
  });

  it('gives both arms the same solve instant', async () => {
    const { effects, log } = harness();

    await runEpisode(pair(), effects);
    const instants = log
      .filter((entry) => entry.startsWith('solve:'))
      .map((entry) => entry.split('@')[1]!.split(':')[0]);

    expect(new Set(instants).size).toBe(1);
  });
});

describe('#1034 §5 the shared repair instant comes after both first checkpoints', () => {
  it('is a second, later instant drawn before any repair', async () => {
    // "Do not use the earlier handoff instant to hide newly created legitimate
    // solve notes."
    const { effects, log } = harness();

    const record = await runEpisode(pair(), effects);
    const second = log.lastIndexOf('instant:t2');

    expect(record.repairInstant).toBe('t2');
    expect(record.repairInstant).not.toBe(record.solveInstant);
    expect(second).toBeGreaterThan(log.lastIndexOf('solve:native@t1:from=native-commit'));
    expect(second).toBeLessThan(indexOf(log, 'repair:'));
  });

  it('gives both arms the same repair instant', async () => {
    const { effects, log } = harness();

    await runEpisode(pair(), effects);
    const instants = log
      .filter((entry) => entry.startsWith('repair:'))
      .map((entry) => entry.split('@')[1]!.split(':')[0]);

    expect(instants).toHaveLength(2);
    expect(new Set(instants).size).toBe(1);
  });
});

describe('#1042 every model phase closes before the audit', () => {
  it('audits only after the last repair', async () => {
    // An audit that ran while an arm was still working would be grading a
    // moving tree.
    const { effects, log } = harness();

    await runEpisode(pair(), effects);
    const lastModelPhase = Math.max(
      ...log.map((entry, index) => (/^(capture|solve|repair):/.test(entry) ? index : -1)),
    );

    expect(indexOf(log, 'audit:')).toBeGreaterThan(lastModelPhase);
  });

  it('hands the audit the saved artifacts rather than re-running anything', async () => {
    const { effects, log } = harness();

    await runEpisode(pair(), effects);

    expect(log).toContain('audit:off:first=off-first:final=off-final');
    expect(log).toContain('audit:native:first=native-first:final=native-final');
  });
});

describe('#1036 the frozen arm order is reused across every phase', () => {
  it('walks native first when the pair says so', async () => {
    const { effects, log } = harness();

    await runEpisode(pair(['native', 'off']), effects);
    const phases = ['capture', 'solve', 'repair', 'audit'];

    for (const phase of phases) {
      const arms = log.filter((entry) => entry.startsWith(`${phase}:`)).map((entry) => entry.split(':')[1]!.split('@')[0]);
      expect(arms).toEqual(['native', 'off']);
    }
  });
});

describe('#1036 nothing crosses between arms', () => {
  it('solves each arm from its own committed state', async () => {
    const { effects, log } = harness();

    await runEpisode(pair(), effects);

    expect(log).toContain('solve:off@t1:from=off-commit');
    expect(log).toContain('solve:native@t1:from=native-commit');
  });

  it('repairs each arm from its own first checkpoint', async () => {
    const { effects, log } = harness();

    await runEpisode(pair(), effects);

    expect(log).toContain('repair:off@t2:checkpointOf=off');
    expect(log).toContain('repair:native@t2:checkpointOf=native');
  });
});

describe('#1036 a failed handoff is preserved, never repaired or dropped', () => {
  it('keeps the row, launches no solve, and records the reason', async () => {
    const { effects, log } = harness({
      runCapture: async (arm) => {
        log.push(`capture:${arm}`);
        return arm === 'off'
          ? { handoff: 'terminal_failure', committed: null }
          : { handoff: 'valid', committed: `${arm}-commit` };
      },
    });

    const record = await runEpisode(pair(), effects);
    const off = record.arms.find((entry) => entry.arm === 'off')!;

    // The row exists. A dropped row turns a failure into a smaller denominator.
    expect(record.arms).toHaveLength(2);
    expect(off.solve).toBeNull();
    expect(off.repair).toBeNull();
    expect(off.repairChoice?.decision).toBe('terminal_handoff');
    expect(off.notes.join(' ')).toMatch(/solve not launched: handoff is terminal_failure/);
    expect(log.some((entry) => entry.startsWith('solve:off'))).toBe(false);
    expect(log.some((entry) => entry.startsWith('repair:off'))).toBe(false);
  });

  it('still runs the other arm in full', async () => {
    const { effects, log } = harness({
      runCapture: async (arm) => {
        log.push(`capture:${arm}`);
        return arm === 'off'
          ? { handoff: 'terminal_failure', committed: null }
          : { handoff: 'valid', committed: `${arm}-commit` };
      },
    });

    await runEpisode(pair(), effects);

    expect(log).toContain('solve:native@t1:from=native-commit');
    expect(log).toContain('repair:native@t2:checkpointOf=native');
  });
});

describe('#1042 a passing first result triggers no repair', () => {
  it('records not_triggered and runs no repair session', async () => {
    const { effects, log } = harness({
      runSolve: async (arm, input) => {
        log.push(`solve:${arm}@${input.readInstant}:from=${String(input.committed)}`);
        return { execution: 'completed', checkpoint: 'complete', feedback: passing(), artifact: `${arm}-first` };
      },
    });

    const record = await runEpisode(pair(), effects);

    expect(log.some((entry) => entry.startsWith('repair:'))).toBe(false);
    for (const arm of record.arms) expect(arm.repairChoice?.decision).toBe('not_triggered');
    // The repair instant is still drawn: the phase boundary does not depend on
    // whether a repair happened, so both arms are read at one time whatever the
    // outcome.
    expect(record.repairInstant).toBe('t2');
  });
});
