/**
 * CDEB §4.6 runtime-boundedness qualification: will this task finish inside its
 * budget, often enough to be worth sealing?
 *
 * CDEB-P sealed a task that hit the fifteen-minute wall in **all four runs** —
 * 903, 902, 902, 902 seconds. Both arms timed out, so it contributed nothing to
 * any comparison while consuming a quarter of the study. §4.6 asked for
 * "bounded implementation, completable in one fresh agent session" and had no
 * way to check it.
 *
 * Three things about this gate are deliberately narrow, and each was a review
 * finding against the first draft:
 *
 *   1. **It runs both arms.** Runtime is treatment-sensitive; qualifying on one
 *      unspecified arm selects a corpus that arm finishes faster, and that bias
 *      is not separable from the result afterwards.
 *   2. **The selector sees `wall_ms` and `stop_reason` and nothing else.** No
 *      oracle runs. No functional or revival field is produced. Reading an
 *      outcome to decide corpus membership would be selection on the dependent
 *      variable.
 *   3. **It screens runtime, not completion.** `stop_reason == completed` means
 *      the process returned; a no-op satisfies it. The pilot measured a ×4.9
 *      spread between two repeats of one cell (89 s → 431 s), so two probes
 *      cannot bound the tail. Study timeouts stay ordinary measured failures
 *      under intention-to-treat. What this prevents is the observed case: every
 *      run of a task timing out.
 *
 * The 0.6 fraction is not a guess. Completed pilot runs topped out at 0.48 of
 * budget and the failing task sat at 1.00, so good and bad separate anywhere
 * between; 0.6 touches neither end.
 *
 * Those pilot runs were measured under a hook matcher the product does not
 * ship (`Edit|Write|MultiEdit|NotebookEdit`, which never fires on `Read`,
 * instead of the shipping `Read|Edit|Write`), so the 0.48/1.00 split is
 * UNVERIFIED against the surface the study measures — the ON arm it screened
 * was lighter than the shipping one. 0.6 stays frozen as the screen; whether
 * the split needs re-measuring is a separate decision this fix does not make
 * (PRD §4.6).
 */

import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_HOOK_MATCHER, CLI_ENTRY } from "../../hooks-settings.ts";

/** Fraction of the per-task budget a probe must finish within (PRD §4.6). */
export const RUNTIME_FRACTION = 0.6;

export type ProbeCondition = "commitlore-on" | "commitlore-off";

export interface RuntimeProbe {
  readonly condition: ProbeCondition;
  /**
   * The model this probe ran. Recorded and checked, not assumed.
   *
   * A probe on a different model than the study measures the runtime of work
   * the study will never do, which makes the gate a screen against the wrong
   * distribution. §2.2 already forces a new study id when the observed model
   * changes; this is the same rule reaching the qualification that selects the
   * corpus.
   */
  readonly model: string;
  readonly stop_reason: "completed" | "timeout" | "agent_error";
  readonly wall_ms: number;
  readonly artifact_sha256: string;
}

export interface RuntimeQualification {
  readonly qualified: boolean;
  readonly threshold_ms: number;
  readonly probes: readonly RuntimeProbe[];
  /** Why it failed, when it did. Empty on a pass. */
  readonly reasons: readonly string[];
}

const sha256 = (input: string): string => createHash("sha256").update(input).digest("hex");

/**
 * Settings for one probe arm — the ON arm's shipping hook, or nothing.
 *
 * Both arms get a settings file of the same shape so the probe differs by the
 * hook and not by whether settings exist, matching §9.1.
 */
const armSettings = (dir: string, condition: ProbeCondition): string => {
  const path = join(dir, "settings.json");
  const hooks =
    condition === "commitlore-on"
      ? {
          PreToolUse: [
            {
              matcher: CLAUDE_HOOK_MATCHER,
              hooks: [{ type: "command", command: `node ${JSON.stringify(CLI_ENTRY)} inject --hook-input` }],
            },
          ],
        }
      : {};
  writeFileSync(path, `${JSON.stringify({ hooks }, null, 2)}\n`);
  return path;
};

const emptyMcp = (dir: string): string => {
  const path = join(dir, "mcp.json");
  writeFileSync(path, `${JSON.stringify({ mcpServers: {} })}\n`);
  return path;
};

/**
 * One probe run.
 *
 * The returned object carries no field the selector must not see. The full
 * transcript is hashed into `artifact_sha256` and written by the caller into
 * sealed qualification storage — a qualification nobody can recheck is not a
 * gate, which is why the first draft's "discard the probe row" was withdrawn.
 */
export const runProbe = (
  workdir: string,
  prompt: string,
  condition: ProbeCondition,
  timeoutMs: number,
  model: string,
): { probe: RuntimeProbe; artifact: string } => {
  const scratch = mkdtempSync(join(tmpdir(), "cdeb-probe-"));
  const settings = armSettings(scratch, condition);
  const mcp = emptyMcp(scratch);

  const start = Date.now();
  const result = spawnSync(
    "claude",
    [
      "-p", prompt,
      "--output-format", "json",
      "--permission-mode", "acceptEdits",
      "--strict-mcp-config",
      "--mcp-config", mcp,
      "--setting-sources", "",
      "--no-session-persistence",
      "--settings", settings,
      "--model", model,
    ],
    { cwd: workdir, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
  );
  const wall_ms = Date.now() - start;

  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  const stop_reason: RuntimeProbe["stop_reason"] = timedOut
    ? "timeout"
    : result.status === 0
      ? "completed"
      : "agent_error";

  const artifact = `${result.stdout ?? ""}\n---stderr---\n${result.stderr ?? ""}`;
  return {
    probe: { condition, model, stop_reason, wall_ms, artifact_sha256: sha256(artifact) },
    artifact,
  };
};

/**
 * §4.6: both arms must complete, and the slower of the two must land inside the
 * threshold.
 *
 * `max` rather than the mean: the study runs each task six times, so the arm
 * that is already slower in a two-run probe is the one that decides whether the
 * task's runs fit. Averaging lets a fast arm carry a slow one into the corpus.
 */
export const qualifyRuntime = (
  probes: readonly RuntimeProbe[],
  timeoutMs: number,
  pinnedModel: string,
): RuntimeQualification => {
  const threshold_ms = Math.floor(timeoutMs * RUNTIME_FRACTION);
  const reasons: string[] = [];

  const arms = new Set(probes.map((probe) => probe.condition));
  if (arms.size !== 2) {
    reasons.push(`both arms are required; probes cover ${[...arms].join(", ") || "nothing"}`);
  }
  for (const probe of probes) {
    if (probe.stop_reason !== "completed") {
      reasons.push(`${probe.condition} stopped as ${probe.stop_reason}`);
    }
    if (probe.model !== pinnedModel) {
      reasons.push(
        `${probe.condition} probed ${probe.model} but the study is pinned to ${pinnedModel} — ` +
          "a runtime screen on another model screens the wrong distribution",
      );
    }
  }
  const slowest = probes.reduce((worst, probe) => Math.max(worst, probe.wall_ms), 0);
  if (probes.length > 0 && slowest > threshold_ms) {
    reasons.push(`slowest probe ${slowest}ms exceeds the ${threshold_ms}ms threshold`);
  }

  return { qualified: reasons.length === 0, threshold_ms, probes, reasons };
};
