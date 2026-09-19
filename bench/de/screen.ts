/**
 * The screen a case must pass before it is worth measuring — #1038 §3.
 *
 * Three measured runs of the first real case produced no effect, and the reason
 * was not the product. The instrument worked: complete coverage, four rows
 * observed, no bound hit, no terminal failure. The delivery worked: the NATIVE
 * arm retrieved and cited the recorded reason thirteen times while neither OFF
 * repetition cited it at all. The outcome did not move because OFF reached the
 * same answer unaided, from ordinary good practice, by a different route.
 *
 * So `evidence_location: 'history_required'` is necessary and not sufficient.
 * It says the reason is absent from the current source. It says nothing about
 * whether the *conclusion* is reachable without it, and a case can satisfy the
 * stratum perfectly while measuring nothing.
 *
 * **What this runs.** An unaided control: no discussion, no record, no
 * intervention. Just the repository as the later session finds it, and the later
 * request. That is exactly what the study's OFF arm holds when it solves —
 * its capture session saw the discussion and carried nothing forward — so
 * skipping capture screens the same control at half the sessions.
 *
 * **What it decides.** Nothing. It reports how many controls passed. A case
 * where the control passes cannot separate the arms and a run of it will spend
 * money to report a zero, but calling that "reject" here would let a screen
 * with its own bug silently shrink the corpus. The reading is the caller's.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runMeasured } from "./driver.ts";
import { unparsableEnvelope, validateEnvelope } from "./envelope.ts";
import { seedWorkspace, type ExecutableCase } from "./execute.ts";
import { scoreArtifact } from "./scoring.ts";

export interface ScreenOptions {
  readonly runDir: string;
  readonly actor: { readonly command: string; readonly args: readonly string[] };
  readonly trials: number;
  readonly timeoutMs: number;
  readonly checkerRevision: string;
}

export interface ScreenTrial {
  /** `true` the control satisfied the decision, `false` it violated it, `null` unknown. */
  readonly passed: boolean | null;
  /** Why the session ended, when one of our own bounds ended it. */
  readonly stoppedOnBound: string | null;
  readonly committed: boolean;
}

export interface ScreenResult {
  readonly case_id: string;
  readonly trials: readonly ScreenTrial[];
  /**
   * How many unaided controls satisfied the decision anyway.
   *
   * Any at all is the finding: the decision is reachable without the record, so
   * the case cannot attribute a pass to it.
   */
  readonly passed_unaided: number;
  /** Trials that answered nothing — an unknown is not a failure to honour it. */
  readonly unresolved: number;
}

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" });

/** The subtype prefix every host uses for a resource stop; see `execute.ts`. */
const boundThatStopped = (result: {
  readonly timedOut: boolean;
  readonly events: readonly unknown[];
}): string | null => {
  if (result.timedOut) return "wall_clock";
  for (let index = result.events.length - 1; index >= 0; index -= 1) {
    const event = result.events[index];
    if (typeof event !== "object" || event === null) continue;
    const subtype = (event as { subtype?: unknown }).subtype;
    if (typeof subtype === "string" && subtype.startsWith("error_")) return subtype;
  }
  return null;
};

/**
 * Run one unaided control and read the checker's verdict on what it produced.
 *
 * The staged change is committed here rather than by an actor. The screen asks
 * one question — is the decision reachable without the record — and a capture
 * session would add a second, whether this actor can finalise a commit.
 */
const runTrial = (
  entry: ExecutableCase,
  index: number,
  options: ScreenOptions,
): Promise<ScreenTrial> => {
  const dir = seedWorkspace(join(options.runDir, `${entry.id}-control-${String(index)}`), entry);
  git(dir, ["commit", "--quiet", "-m", "prior: the staged change, finalised"]);

  return runMeasured({
    executable: options.actor.command,
    args: options.actor.args,
    prompt: entry.next_request,
    cwd: dir,
    outDir: options.runDir,
    env: { ...process.env, DE_REPO: dir, DE_ARM: "control", DE_PHASE: "screen" },
    timeoutMs: options.timeoutMs,
    label: `screen-${entry.id}-${String(index)}`,
  }).then((result) => {
    const envelopePath = join(options.runDir, `${entry.id}-control-${String(index)}.feedback.json`);
    const artifactId = git(dir, ["rev-parse", "HEAD^{tree}"]).trim();
    const described = entry.described.filter((check) => check.purpose === "feedback");
    let envelope = unparsableEnvelope();
    try {
      execFileSync(process.execPath, [entry.checker], {
        env: {
          ...process.env,
          CHECK_REPO: dir,
          CHECK_OUT: envelopePath,
          CHECK_PURPOSE: "feedback",
          CHECK_ARTIFACT: artifactId,
          CHECK_REVISION: options.checkerRevision,
        },
        encoding: "utf8",
      });
      if (existsSync(envelopePath)) {
        const verdict = validateEnvelope({
          raw: JSON.parse(readFileSync(envelopePath, "utf8")) as unknown,
          purpose: "feedback",
          artifact_id: artifactId,
          checker_revision: options.checkerRevision,
          described,
        });
        // An invalid envelope stays `unparsable`, which scores as untrusted
        // rather than as a candidate that failed.
        if (verdict.valid) envelope = verdict.envelope;
      }
    } catch {
      // A checker that could not run says nothing about the candidate.
    }

    const verdict = scoreArtifact(
      {
        artifact_id: artifactId,
        checker_revision: options.checkerRevision,
        required_checks: { feedback: described.map((check) => check.id), audit: [] },
      },
      { feedback: envelope, audit: { presence: "missing" } },
    );

    return {
      passed: verdict.score,
      stoppedOnBound: boundThatStopped(result),
      committed: git(dir, ["log", "--format=%s", "-1"]).trim() !== "prior: the staged change, finalised",
    };
  });
};

/**
 * Screen one case with `options.trials` unaided controls.
 *
 * Sequential on purpose: the trials share a host and a rate limit, and a screen
 * that saturated them would be measuring contention rather than the case.
 */
export const screenCase = async (entry: ExecutableCase, options: ScreenOptions): Promise<ScreenResult> => {
  // Same rule the study runs under: two case sets or two protocol revisions
  // sharing a directory is evidence whose reader cannot tell them apart.
  // `screenCases` checks this once for the whole set, before any session.
  mkdirSync(options.runDir, { recursive: true });
  const trials: ScreenTrial[] = [];
  for (let index = 0; index < options.trials; index += 1) {
    trials.push(await runTrial(entry, index, options));
  }
  return {
    case_id: entry.id,
    trials,
    passed_unaided: trials.filter((trial) => trial.passed === true).length,
    unresolved: trials.filter((trial) => trial.passed === null).length,
  };
};

/**
 * Screen every case in a set, refusing a directory that already holds evidence.
 *
 * The check is here rather than in `screenCase` so it happens once, before any
 * session is spent -- a per-case check would refuse the second case after
 * paying for the first.
 */
export const screenCases = async (
  entries: readonly ExecutableCase[],
  options: ScreenOptions,
): Promise<ScreenResult[]> => {
  if (existsSync(options.runDir)) {
    throw new Error(`the run directory ${options.runDir} already exists; a new screen uses a fresh directory`);
  }
  const results: ScreenResult[] = [];
  for (const entry of entries) results.push(await screenCase(entry, options));
  return results;
};

export const renderScreen = (results: readonly ScreenResult[]): string => {
  const lines = [
    "unaided control screen — #1038 §3",
    "",
    "a case the control passes cannot attribute a pass to the record.",
    "",
  ];
  for (const result of results) {
    const bounds = result.trials.filter((trial) => trial.stoppedOnBound !== null).length;
    lines.push(
      `  ${result.case_id}`,
      `    control passed unaided: ${String(result.passed_unaided)} of ${String(result.trials.length)}`,
      `    unresolved: ${String(result.unresolved)}`,
      ...(bounds > 0
        ? [`    stopped by our own bounds: ${String(bounds)} — those trials screen the bound, not the case`]
        : []),
      result.passed_unaided > 0
        ? "    -> the decision is reachable without the record; measuring this case reports a zero it already knows"
        : result.unresolved === result.trials.length
          ? "    -> nothing was established; this is not a verdict on the case"
          : "    -> the control failed; the case can separate the arms on this run's evidence",
    );
  }
  return lines.join("\n");
};
