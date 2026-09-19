/**
 * The execution loop — #1036, revision `native-efficacy-r6.1`.
 *
 * Thin on purpose. Every decision it makes was made in a module already: the
 * plan and the reservation in `schedule.ts`, the phase order in `episode.ts`,
 * the invocation in `driver.ts`, the snapshot in `checkpoint.ts`, the envelope
 * in `envelope.ts`, the verdict in `scoring.ts`, the repair in `repair.ts`. What
 * is here is the wiring and the run directory, and the wiring is the part that
 * had no test until this existed.
 *
 * **The actor is a command, not a model.** That is the whole reason this can be
 * proved at zero cost: a node script that edits files and commits exercises the
 * same code path a host CLI will, so the loop is verified before a single token
 * is spent. #1035 asks for exactly this separation -- "Synthetic fake-actor
 * smoke proves actual Git/native wiring, not spontaneous live capture or
 * semantic accuracy" -- and it is also why nothing here decides what an actor
 * is: `--actor` names one.
 *
 * **A run directory is new, always.** #1036: "A new run uses a fresh
 * directory." Appending to an existing one would let two protocol revisions,
 * two case sets or two budgets share a file whose reader cannot tell them apart.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { checkpointStatusOf, restoreCheckpoint, takeCheckpoint, type Checkpoint } from "./checkpoint.ts";
import { runMeasured } from "./driver.ts";
import { runEpisode, type EpisodeEffects, type EpisodeRecord } from "./episode.ts";
import { unparsableEnvelope, validateEnvelope, type CheckDefinition } from "./envelope.ts";
import { capturePrompt, type LeakSecret } from "./prompt.ts";
import { reservePair, type Arm, type PhaseLimits, type ScheduledPair } from "./schedule.ts";
import { scoreArtifact, type Purpose } from "./scoring.ts";

/** One case, with everything a run needs and nothing an actor may see. */
export interface ExecutableCase {
  readonly id: string;
  readonly cluster_id: string;
  readonly source_group: string;
  /** Replayed to the capture actor, with its original attribution. */
  readonly discussion: string;
  /** Files staged before the actor starts. Identical in both arms. */
  readonly staged: Readonly<Record<string, string>>;
  /** The later task. Never reaches capture; only the solve. */
  readonly next_request: string;
  /** A script that writes an envelope. Run in its own evaluation clone. */
  readonly checker: string;
  readonly described: readonly CheckDefinition[];
  /** Strings the capture prompt must not contain (#1038 §3). */
  readonly secrets: readonly LeakSecret[];
}

export interface ExecuteOptions {
  readonly runDir: string;
  /**
   * How to start one actor session.
   *
   * A command plus arguments rather than a bare path: a real host invocation
   * carries flags (model, permission mode, limits), and a fake actor is a
   * script the node binary runs. One shape covers both, which is what keeps the
   * zero-cost proof on the same code path as the measured run.
   */
  readonly actor: {
    readonly command: string;
    /** Common to both arms. Anything here is not the intervention. */
    readonly args: readonly string[];
    /**
     * **The intervention itself** (#1040). Everything else is held equal --
     * same model, same permissions, same isolation, same prompts -- and the
     * only difference between the arms is what these arguments give the actor:
     * the owned CommitLore integration, present for NATIVE and absent for OFF.
     *
     * A per-arm argv rather than a boolean, because #1040 warns that NATIVE
     * "must actually have the intended tools/skills/hooks enabled, not an
     * empty-MCP approximation", and a boolean would have to guess what enabling
     * means for a host this module does not own.
     */
    readonly perArm: Readonly<Record<Arm, readonly string[]>>;
  };
  readonly limits: PhaseLimits;
  readonly timeoutMs: number;
  /** Authorised tokens. `null` means unknown, which stops before any pair. */
  readonly budget: number | null;
  readonly checkerRevision: string;
}

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", [...args], { cwd, encoding: "utf8" });

/**
 * Both arms start from the same legitimate history and the same staged change.
 *
 * #1040's table: "Same starting evidence" is the first row, and it is the row
 * everything else rests on -- an arm that started from a different tree is not
 * a control.
 */
const seedWorkspace = (dir: string, entry: ExecutableCase): string => {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "--quiet", "--initial-branch=main"]);
  git(dir, ["config", "user.name", "DE Study"]);
  git(dir, ["config", "user.email", "de@example.invalid"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "DISCUSSION.md"), entry.discussion);
  for (const [path, content] of Object.entries(entry.staged)) writeFileSync(join(dir, path), content);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "prior: the legitimate history both arms start from"]);
  // Staged, not committed: the actor is asked to finalise this.
  for (const [path, content] of Object.entries(entry.staged)) {
    writeFileSync(join(dir, path), `${content}// staged change awaiting a commit\n`);
  }
  git(dir, ["add", "."]);
  return dir;
};

/** Runs the case's checker against a restored clone and validates what it wrote. */
/**
 * The public explanations attached to failing feedback rows.
 *
 * Carried separately from the envelope because #1042 grounds the repair prompt
 * in them: "Feedback false rows require nonempty public explanations grounded in
 * the stated accessible requirements." A repair told only that something failed
 * is being asked to guess, and what it guesses is not what the study measures.
 */
const explanationsIn = (raw: unknown): string[] => {
  if (typeof raw !== "object" || raw === null) return [];
  const rows = (raw as { checks?: unknown }).checks;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (row): row is { pass: boolean; public_feedback: string } =>
        typeof row === "object" &&
        row !== null &&
        (row as { pass?: unknown }).pass === false &&
        typeof (row as { public_feedback?: unknown }).public_feedback === "string" &&
        (row as { public_feedback: string }).public_feedback.trim() !== "",
    )
    .map((row) => row.public_feedback);
};

const checkIn = (
  entry: ExecutableCase,
  checkpoint: Checkpoint,
  cloneDir: string,
  purpose: Purpose,
  artifactId: string,
  revision: string,
) => {
  restoreCheckpoint(checkpoint, cloneDir);
  const envelopePath = `${cloneDir}.${purpose}.json`;
  try {
    execFileSync(process.execPath, [entry.checker], {
      env: {
        ...process.env,
        CHECK_REPO: cloneDir,
        CHECK_OUT: envelopePath,
        CHECK_PURPOSE: purpose,
        CHECK_ARTIFACT: artifactId,
        CHECK_REVISION: revision,
      },
      encoding: "utf8",
    });
  } catch {
    // A checker that could not run leaves no envelope, which the validator
    // reports as unparsable rather than as a failing artifact.
    return { envelope: unparsableEnvelope(), explanations: [] as string[] };
  }
  if (!existsSync(envelopePath)) return { envelope: unparsableEnvelope(), explanations: [] as string[] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(envelopePath, "utf8"));
  } catch {
    return { envelope: unparsableEnvelope(), explanations: [] as string[] };
  }
  const verdict = validateEnvelope({
    purpose,
    artifact_id: artifactId,
    checker_revision: revision,
    described: entry.described.filter((definition) => definition.purpose === purpose),
    raw,
  });
  return {
    envelope: verdict.valid ? verdict.envelope : unparsableEnvelope(),
    explanations: explanationsIn(raw),
  };
};

const requiredFor = (entry: ExecutableCase, purpose: Purpose): string[] =>
  entry.described.filter((definition) => definition.purpose === purpose).map((definition) => definition.id);

/**
 * Build the effects for one pair, closing over this run's directories.
 *
 * Every arm gets its own workspace, its own checkpoint and its own evaluation
 * clones; nothing is shared but the case fixture, which is the point.
 */
const effectsFor = (
  pair: ScheduledPair,
  entry: ExecutableCase,
  options: ExecuteOptions,
  pairDir: string,
): EpisodeEffects => {
  const workspaces = new Map<Arm, string>();
  const checkpoints = new Map<Arm, Checkpoint>();
  let ticks = 0;

  const explanations = new Map<Arm, string[]>();

  const feedbackVerdict = (arm: Arm, stage: string) => {
    const artifactId = checkpoints.get(arm)!.head;
    const { envelope, explanations: said } = checkIn(
      entry,
      checkpoints.get(arm)!,
      join(pairDir, `${arm}-${stage}-feedback`),
      "feedback",
      artifactId,
      options.checkerRevision,
    );
    explanations.set(arm, said);
    // Feedback purpose ALONE: the audit is never an input to repair selection.
    return scoreArtifact(
      {
        artifact_id: artifactId,
        checker_revision: options.checkerRevision,
        required_checks: { feedback: requiredFor(entry, "feedback"), audit: [] },
      },
      { feedback: envelope, audit: { presence: "missing" } },
    );
  };

  return {
    instant: () => `${new Date().toISOString()}#${String((ticks += 1))}`,
    runCapture: async (arm) => {
      const dir = seedWorkspace(join(pairDir, `arm-${arm}`), entry);
      workspaces.set(arm, dir);
      // The prompt is built and leak-checked before it can reach a child.
      const prompt = capturePrompt(
        {
          discussion: entry.discussion,
          sourceLocations: Object.keys(entry.staged),
          stagedContext: "The listed files are staged and awaiting one ordinary commit.",
        },
        entry.secrets,
      );
      const result = await runMeasured({
        executable: options.actor.command,
        args: [...options.actor.args, ...options.actor.perArm[arm]],
        prompt,
        cwd: dir,
        outDir: pairDir,
        env: { ...process.env, DE_REPO: dir, DE_ARM: arm, DE_PHASE: "capture" },
        timeoutMs: options.timeoutMs,
        label: `capture-${arm}`,
      });
      // A commit that exists is a valid handoff, with or without a record.
      const committed = git(dir, ["rev-parse", "HEAD"]).trim();
      const moved = git(dir, ["log", "--format=%s", "-1"]).trim();
      return {
        handoff: result.exitCode === 0 && moved !== "prior: the legitimate history both arms start from"
          ? "valid"
          : "terminal_failure",
        committed,
      };
    },
    runSolve: async (arm, input) => {
      const dir = workspaces.get(arm)!;
      const result = await runMeasured({
        executable: options.actor.command,
        args: [...options.actor.args, ...options.actor.perArm[arm]],
        prompt: `${entry.next_request}\n\n(read instant ${input.readInstant})`,
        cwd: dir,
        outDir: pairDir,
        env: { ...process.env, DE_REPO: dir, DE_ARM: arm, DE_PHASE: "solve" },
        timeoutMs: options.timeoutMs,
        label: `solve-${arm}`,
      });
      const checkpoint = takeCheckpoint({ cwd: dir, stage: "first_solve", outDir: pairDir });
      checkpoints.set(arm, checkpoint);
      return {
        execution: result.timedOut ? "interrupted" : "completed",
        checkpoint: checkpointStatusOf(checkpoint),
        feedback: {
          trusted: true,
          verdict: feedbackVerdict(arm, "first"),
          public_explanation: true,
          environment_fault: false,
        },
        artifact: checkpoint.head,
      };
    },
    runRepair: async (arm, input) => {
      // From its own first checkpoint, restored into a fresh workspace.
      const repairDir = join(pairDir, `arm-${arm}-repair`);
      restoreCheckpoint(checkpoints.get(input.checkpointOf)!, repairDir);
      const result = await runMeasured({
        executable: options.actor.command,
        args: [...options.actor.args, ...options.actor.perArm[arm]],
        // Grounded in what the feedback actually said (#1042). A repair told
        // only that something failed is being asked to guess.
        prompt: `A required check failed. Repair it.\n\n${
          (explanations.get(arm) ?? []).map((line) => `- ${line}`).join("\n") ||
          "- the checker reported a failure with no public explanation"
        }\n\n(read instant ${input.readInstant})`,
        cwd: repairDir,
        outDir: pairDir,
        env: { ...process.env, DE_REPO: repairDir, DE_ARM: arm, DE_PHASE: "repair" },
        timeoutMs: options.timeoutMs,
        label: `repair-${arm}`,
      });
      const final = takeCheckpoint({ cwd: repairDir, stage: "repair", outDir: pairDir });
      checkpoints.set(arm, final);
      return {
        execution: result.timedOut ? "interrupted" : "completed",
        feedback: {
          trusted: true,
          verdict: feedbackVerdict(arm, "final"),
          public_explanation: true,
          environment_fault: false,
        },
        artifact: final.head,
      };
    },
    runAudit: async (arm) => {
      const artifactId = checkpoints.get(arm)!.head;
      const { envelope } = checkIn(
        entry,
        checkpoints.get(arm)!,
        join(pairDir, `${arm}-audit`),
        "audit",
        artifactId,
        options.checkerRevision,
      );
      return {
        trusted: true,
        verdict: scoreArtifact(
          {
            artifact_id: artifactId,
            checker_revision: options.checkerRevision,
            required_checks: { feedback: [], audit: requiredFor(entry, "audit") },
          },
          { feedback: { presence: "missing" }, audit: envelope },
        ),
        public_explanation: false,
        environment_fault: false,
      };
    },
  };
};

export interface ExecutedPair {
  readonly pair: ScheduledPair;
  readonly reservation: ReturnType<typeof reservePair>;
  readonly episode: EpisodeRecord | null;
}

/**
 * Walk the plan, reserving before each pair and stopping when one cannot be
 * funded whole.
 *
 * Stopping rather than skipping: a run that quietly continued past an unfunded
 * pair would produce a results file whose gaps look like ordinary failures.
 */
export const executePlan = async (
  plan: readonly ScheduledPair[],
  cases: ReadonlyMap<string, ExecutableCase>,
  options: ExecuteOptions,
): Promise<ExecutedPair[]> => {
  if (existsSync(options.runDir)) {
    throw new Error(`the run directory ${options.runDir} already exists; a new run uses a fresh directory`);
  }
  mkdirSync(options.runDir, { recursive: true });

  const executed: ExecutedPair[] = [];
  let remaining = options.budget;

  for (const pair of plan) {
    const reservation = reservePair({ remaining, limits: options.limits });
    if (reservation.outcome !== "reserved") {
      executed.push({ pair, reservation, episode: null });
      break;
    }
    remaining = reservation.remainingAfter;

    const entry = cases.get(pair.case_id);
    if (entry === undefined) throw new Error(`the plan names case ${pair.case_id}, which the manifest does not define`);
    const pairDir = join(options.runDir, `${pair.case_id}-rep${String(pair.repetition)}`);
    mkdirSync(pairDir, { recursive: true });

    const episode = await runEpisode(pair, effectsFor(pair, entry, options, pairDir));
    writeFileSync(join(pairDir, "episode.json"), `${JSON.stringify(episode, null, 2)}\n`);
    executed.push({ pair, reservation, episode });
  }

  return executed;
};
