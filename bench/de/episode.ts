/**
 * One paired episode, in the order #1036 fixes — revision
 * `native-efficacy-r6.1`.
 *
 * Every effect is injected. This module owns **sequence**, which is the part of
 * the runner that a results file cannot show you: a run whose phases interleaved
 * wrongly produces rows that look exactly like correct ones.
 *
 * Four boundaries carry the comparison, and each is a rule about *when* rather
 * than about what:
 *
 *   1. **The shared solve instant is assigned after both handoffs.** #1034 §5
 *      asks for "a shared solve instant after BOTH capture checkpoints". Per-arm
 *      instants would give the arm that captured second a later read time, and
 *      the treatment is the arm that writes notes — so it would be reading its
 *      own newer memory under a clock the control never got.
 *   2. **The shared repair instant is assigned after both first checkpoints and
 *      before any repair.** Same reason, one phase along; and using the earlier
 *      handoff instant "to hide newly created legitimate solve notes" is called
 *      out by name.
 *   3. **All model execution closes before the audit.** #1042: the audit reads
 *      frozen saved checkpoints and makes zero model calls. An audit that ran
 *      while an arm was still working would be grading a moving tree.
 *   4. **Nothing crosses between arms.** Each arm solves from its own committed
 *      state and repairs from its own first checkpoint.
 *
 * The arms run in the frozen order from `schedule.ts`, unchanged across capture,
 * solve and repair.
 *
 * An arm whose handoff failed still produces a row. #1036: "Never repair failed
 * handoffs, transplant another arm's output or drop unstarted rows" — a dropped
 * row silently turns a failure into a smaller denominator.
 */

import { chooseRepair, type CheckpointStatus, type HandoffStatus, type NormalizedFeedback, type RepairChoice, type SolveExecution } from "./repair.ts";
import type { Arm, ScheduledPair } from "./schedule.ts";

export type Phase = "capture" | "solve" | "repair" | "audit";

export interface CaptureOutcome {
  readonly handoff: HandoffStatus;
  /** Whatever the runner needs to start a solve from this arm's own state. */
  readonly committed: unknown;
  /**
   * Why the session ended, when it ended on a bound the harness itself set.
   *
   * The verdict above stays as #1033 §3 defines it -- "failure to produce the
   * required handoff within the declared bound is false when observed" -- so a
   * truncated session is still a `terminal_failure`. This says *whose* bound
   * stopped it, which the verdict cannot.
   *
   * That is the difference between data and an instrument fault. In the first
   * measured run both arms ended on `error_max_turns`, at different phases, and
   * the report said only "terminal handoff failures: 1": a reader could not
   * tell an actor that failed from a bound too tight to finish in, and the pair
   * was not a comparison at all (#1035, "record supported hard/soft limits and
   * in-flight overshoot").
   *
   * Optional because a test recorder has no bound to report, and inventing one
   * for it would put a fact in the evidence that nothing observed.
   */
  readonly stoppedOnBound?: string | null;
}

export interface SolveOutcome {
  readonly execution: SolveExecution;
  readonly checkpoint: CheckpointStatus;
  readonly feedback: NormalizedFeedback;
  readonly artifact: unknown;
}

export interface RepairOutcome {
  readonly execution: SolveExecution;
  readonly feedback: NormalizedFeedback;
  readonly artifact: unknown;
}

/**
 * The effects one episode needs.
 *
 * Injected rather than imported so a test can drive the whole sequence with no
 * model, no network and no repository, and so the runner's own ordering is what
 * is under test rather than the behaviour of whatever it calls.
 */
export interface EpisodeEffects {
  /** A monotonic source of read instants. Called exactly twice per pair. */
  readonly instant: () => string;
  readonly runCapture: (arm: Arm, pair: ScheduledPair) => Promise<CaptureOutcome>;
  readonly runSolve: (arm: Arm, input: { readonly committed: unknown; readonly readInstant: string }) => Promise<SolveOutcome>;
  readonly runRepair: (arm: Arm, input: { readonly checkpointOf: Arm; readonly readInstant: string }) => Promise<RepairOutcome>;
  /** Reads frozen saved state only. Runs after every model phase has closed. */
  readonly runAudit: (arm: Arm, input: { readonly first: unknown; readonly final: unknown }) => Promise<NormalizedFeedback>;
}

export interface ArmRecord {
  readonly arm: Arm;
  readonly capture: CaptureOutcome;
  /** Null when the handoff was not valid: the solve was never launched. */
  readonly solve: SolveOutcome | null;
  readonly repairChoice: RepairChoice | null;
  readonly repair: RepairOutcome | null;
  readonly audit: NormalizedFeedback | null;
  /** Why a phase did not run, in the runner's own words. */
  readonly notes: readonly string[];
}

export interface EpisodeRecord {
  readonly pair: ScheduledPair;
  readonly solveInstant: string;
  readonly repairInstant: string;
  readonly arms: readonly ArmRecord[];
}

const armOrder = (pair: ScheduledPair): readonly Arm[] => pair.order;

/**
 * Run one paired episode.
 *
 * Reads as a transcript of #1036's loop on purpose: the phase boundaries are
 * the statements between the loops, not conditions inside them, so a future
 * edit that moves a call into the wrong loop changes the shape of this function
 * rather than hiding inside it.
 */
export const runEpisode = async (pair: ScheduledPair, effects: EpisodeEffects): Promise<EpisodeRecord> => {
  const order = armOrder(pair);

  // Capture, both arms, frozen order.
  const captures = new Map<Arm, CaptureOutcome>();
  for (const arm of order) captures.set(arm, await effects.runCapture(arm, pair));

  // Only now: one instant, shared by both arms.
  const solveInstant = effects.instant();

  const solves = new Map<Arm, SolveOutcome>();
  const notes = new Map<Arm, string[]>(order.map((arm) => [arm, []]));
  for (const arm of order) {
    const capture = captures.get(arm)!;
    if (capture.handoff !== "valid") {
      // Preserved as a planned-but-unstarted row with its actual reason. Not
      // dropped, and not rescued.
      notes.get(arm)!.push(`solve not launched: handoff is ${capture.handoff}`);
      continue;
    }
    solves.set(arm, await effects.runSolve(arm, { committed: capture.committed, readInstant: solveInstant }));
  }

  // Only now: the second instant, after both first checkpoints exist.
  const repairInstant = effects.instant();

  const choices = new Map<Arm, RepairChoice>();
  const repairs = new Map<Arm, RepairOutcome>();
  for (const arm of order) {
    const capture = captures.get(arm)!;
    const solve = solves.get(arm);
    const choice = chooseRepair(
      capture.handoff,
      solve?.execution ?? "unstarted",
      solve?.feedback ?? unavailableFeedback(),
      solve?.checkpoint ?? "unavailable",
    );
    choices.set(arm, choice);
    if (choice.decision !== "repair") {
      notes.get(arm)!.push(`repair ${choice.decision} (rule ${String(choice.rule)}): ${choice.reason}`);
      continue;
    }
    // From its own first checkpoint. The parameter is named so a future caller
    // cannot quietly hand it the other arm's.
    repairs.set(arm, await effects.runRepair(arm, { checkpointOf: arm, readInstant: repairInstant }));
  }

  // Every model phase has closed. The audit reads saved state only.
  const audits = new Map<Arm, NormalizedFeedback>();
  for (const arm of order) {
    const solve = solves.get(arm);
    if (solve === undefined) {
      notes.get(arm)!.push("audit not run: nothing was solved");
      continue;
    }
    audits.set(
      arm,
      await effects.runAudit(arm, { first: solve.artifact, final: repairs.get(arm)?.artifact ?? null }),
    );
  }

  return {
    pair,
    solveInstant,
    repairInstant,
    arms: order.map((arm) => ({
      arm,
      capture: captures.get(arm)!,
      solve: solves.get(arm) ?? null,
      repairChoice: choices.get(arm) ?? null,
      repair: repairs.get(arm) ?? null,
      audit: audits.get(arm) ?? null,
      notes: notes.get(arm)!,
    })),
  };
};

/**
 * The feedback stand-in for an arm that never solved.
 *
 * Untrusted with an empty verdict, so `chooseRepair` reaches its own rule for
 * the situation rather than being handed a fabricated pass or failure.
 */
const unavailableFeedback = (): NormalizedFeedback => ({
  trusted: false,
  verdict: { score: null, coverage: "unavailable", observed: [], unobserved: [], untrusted: [] },
  public_explanation: false,
  environment_fault: false,
});
