import fs from "node:fs";
import path from "node:path";

import { git } from "../git.ts";
import type { AgentDriver, DriverRequest, DriverResult } from "./types.ts";
import { composePrompt } from "./types.ts";

/**
 * Fabricated re-proposal rates. They exist so the harness has something to
 * aggregate without an API key — they are NOT a hypothesis, a prediction, or a
 * result. Every row produced by this driver carries `simulated: true`, and
 * metrics.ts refuses to present simulated rows as measurement.
 */
const REPROPOSAL_RATE_WITHOUT_RECORDS = 0.8;
const REPROPOSAL_RATE_WITH_RECORDS = 0.25;
const VIOLATION_RATE = 0.3;
const TOKENS_PER_TURN = 1_800;

const hash32 = (text: string): number => {
  let value = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16_777_619);
  }
  return value >>> 0;
};

/** mulberry32 — same seed, same run, on every machine. */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const run = async (request: DriverRequest): Promise<DriverResult> => {
  const random = mulberry32(hash32(`${request.seed}|${request.taskId}|${request.condition}`));
  const withRecords = request.injectedContext !== null;
  const rate = withRecords ? REPROPOSAL_RATE_WITH_RECORDS : REPROPOSAL_RATE_WITHOUT_RECORDS;
  const reproposes = random() < rate;

  const alternative = request.simulation.ruledOutAlternatives[0] ?? "the previously rejected approach";
  const proposal = reproposes
    ? `I propose we adopt ${alternative}. It is the standard fix for this class of problem.`
    : "I propose a solution that stays inside the recorded constraints and does not revive a rejected option.";

  const violates = random() < VIOLATION_RATE && request.simulation.violationTokens.length > 0;
  const violation = request.simulation.violationTokens[0] ?? "";

  const turns = Math.min(request.maxTurns, 2 + Math.floor(random() * 6));
  const tokens = Math.min(request.maxTokens, Math.round(turns * TOKENS_PER_TURN * (0.7 + random() * 0.6)));

  // Neither the note nor the transcript may echo the task id: ids name the
  // ruled-out approach ("reproposal-redis-cache"), so leaking one into a
  // detection surface scores every run as a re-proposal.
  const notePath = path.join(request.workspace, "PROPOSAL.md");
  fs.writeFileSync(
    notePath,
    [
      `# Proposal`,
      "",
      `Condition: ${request.condition}`,
      "",
      proposal,
      ...(violates ? ["", `Implementation detail: ${violation}`] : []),
      "",
      `<!-- prompt hash ${hash32(composePrompt(request))} -->`,
      "",
    ].join("\n"),
  );

  // Half the simulated agents commit their work, so the commit-message surface
  // is exercised as well as the working-tree diff.
  if (random() < 0.5) {
    git(request.workspace, ["add", "-A"]);
    git(request.workspace, ["commit", "-q", "-m", `Propose a fix\n\n${proposal}`]);
  }

  const stoppedBy = turns >= request.maxTurns ? "turns" : tokens >= request.maxTokens ? "tokens" : "completed";
  const transcript = [
    `[dry-run driver — SIMULATED, not a measurement]`,
    `task=${hash32(request.taskId)} cond=${request.condition} seed=${request.seed}`,
    "",
    proposal,
  ].join("\n");

  return { transcript, turns, tokens, stoppedBy };
};

export const createDryRunDriver = (): AgentDriver => ({
  name: "dry-run",
  simulated: true,
  run,
});
