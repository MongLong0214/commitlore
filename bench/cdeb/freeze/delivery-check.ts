/**
 * CDEB §4.9 delivery qualification: does the frozen shipping hook actually put
 * this task's record in front of an agent editing this task's paths?
 *
 * CDEB-P found two of four tasks delivering **zero** records to the ON arm.
 * Those runs were ON by assignment and OFF in substance, and they left one task
 * carrying the entire question the study exists to answer.
 *
 * The first fix for that checked `commitlore context <path>`, and an external
 * review rejected it for the right reason: **that is not the surface CDEB
 * measures.** Between a context query and the agent sit the injection budget,
 * trust grading, the injection guard, lifecycle projection, index behaviour,
 * the shipping matcher, hook-input parsing and output parsing. A record can
 * render in `context` and reach nobody. The defect being fixed was zero
 * *shipping* delivery, so the check has to drive the shipping path.
 *
 * So this module builds a real `PreToolUse` payload and runs the pinned
 * `commitlore inject --hook-input` exactly as the ON arm does — same command,
 * same budget, same trust configuration, same index policy, same snapshot —
 * and passes only when the expected record id appears in the bytes the hook
 * forwards. Nothing here renders context itself.
 *
 * What it cannot promise: that the agent will edit those paths, or use a tool
 * the matcher covers. That is product effectiveness and §9.5 records it. What
 * it excludes is the case where delivery was impossible before the agent
 * started.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import { CLI_ENTRY } from "../../hooks-settings.ts";

/** One (path, record) pair the frozen hook must actually deliver. */
export interface DeliveryExpectation {
  readonly path: string;
  readonly record_id: string;
}

export interface DeliveryProbe {
  readonly path: string;
  readonly record_id: string;
  readonly delivered: boolean;
  readonly payload_sha256: string;
  readonly payload_bytes: number;
  readonly exit_code: number;
  readonly stderr: string;
}

export interface DeliveryQualification {
  readonly qualified: boolean;
  readonly verified_via: "shipping-inject-hook";
  readonly injection_budget: number;
  readonly probes: readonly DeliveryProbe[];
  readonly unmet: readonly string[];
}

const sha256 = (input: string): string => createHash("sha256").update(input).digest("hex");

/**
 * The hook payload a `PreToolUse` event carries for an edit.
 *
 * `Edit` rather than `Read`: §4.9 asks whether the record reaches an agent
 * *about to change* the path. The shipping matcher (`Read|Edit|Write`) covers
 * both; `Edit` is the payload that exercises the case being asked about. A
 * payload the matcher would not have selected proves nothing about the arm
 * being measured.
 */
const hookPayload = (path: string): string =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: path, old_string: "", new_string: "" },
  });

/**
 * Runs the pinned shipping injector for one path and reports what it forwarded.
 *
 * The command is the one the ON arm's settings run. A non-zero exit is not an
 * exception here: the hook is fail-open by design, and a task whose record only
 * arrives when the product errors is not qualified either way. The exit code is
 * recorded rather than thrown so the freeze manifest can show it.
 */
export const probeDelivery = (
  cwd: string,
  expectation: DeliveryExpectation,
  budget: number,
  extraArgs: readonly string[] = [],
): DeliveryProbe => {
  const result = spawnSync(
    process.execPath,
    [CLI_ENTRY, "inject", "--hook-input", "--budget", String(budget), ...extraArgs],
    { cwd, input: hookPayload(expectation.path), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const stdout = result.stdout ?? "";
  return {
    path: expectation.path,
    record_id: expectation.record_id,
    // The record id must appear in the bytes the hook forwarded, not in
    // anything this module computed about the repository.
    delivered: stdout.includes(expectation.record_id),
    payload_sha256: sha256(stdout),
    payload_bytes: Buffer.byteLength(stdout, "utf8"),
    exit_code: result.status ?? -1,
    stderr: (result.stderr ?? "").trim(),
  };
};

/**
 * §4.9: every expected record must be delivered for at least one of the paths
 * the good control edits.
 *
 * "At least one path" rather than "every path" because a record scoped to one
 * file of a multi-file change still reaches the agent when it opens that file.
 * "Every record" because a task whose second record never arrives is a task
 * whose oracle can fire on a decision the ON arm never saw.
 */
export const qualifyDelivery = (
  cwd: string,
  expectedRecordIds: readonly string[],
  goodControlPaths: readonly string[],
  budget: number,
  extraArgs: readonly string[] = [],
): DeliveryQualification => {
  const probes: DeliveryProbe[] = [];
  for (const path of goodControlPaths) {
    for (const record_id of expectedRecordIds) {
      probes.push(probeDelivery(cwd, { path, record_id }, budget, extraArgs));
    }
  }
  const unmet = expectedRecordIds.filter(
    (id) => !probes.some((probe) => probe.record_id === id && probe.delivered),
  );
  return {
    qualified: unmet.length === 0,
    verified_via: "shipping-inject-hook",
    injection_budget: budget,
    probes,
    unmet,
  };
};
