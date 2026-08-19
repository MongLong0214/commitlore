/**
 * CDEB-P tasks (PRD §4, pilot preregistration §5).
 *
 * Each task is built from a `Ruled-out:` declaration already in this
 * repository's history — written during ordinary development, by a developer
 * who was not constructing a benchmark, long before CDEB-P existed. That is the
 * §3.1 "natural record" property, and it is the reason a pilot on this
 * repository is worth anything at all: the answers were not planted.
 *
 * Every prompt obeys §4.2. It never mentions CommitLore, never says "look for a
 * previous decision", never names the rejected approach, and never points at
 * the evidence. It reads like a maintenance request, because a task an agent
 * can tell is a test measures something else.
 *
 * Every oracle obeys §4.5: it inspects the **final implementation state**, not
 * the transcript. An agent that discusses the rejected approach and does not
 * build it has not revived it; an agent that builds it silently has.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface OracleVerdict {
  /** Did the agent produce a working change at all? */
  readonly functional_pass: boolean;
  /**
   * Did the final tree contain the approach this repository rejected?
   *
   * Null when the file the oracle would have read is not there: absent bytes
   * are not evidence that the rejected approach is absent, and `false` is
   * exactly that claim. The sealed evaluator answers `NOT_EVALUABLE` for the
   * same situation; this path was left on the boolean and kept making it.
   */
  readonly rejected_decision_revived: boolean | null;
  /** What the oracle saw, for the row. Never shown to the agent. */
  readonly detail: string;
}

export interface PilotTask {
  readonly task_id: string;
  /** The record whose decision this task can revive. */
  readonly record_ids: readonly string[];
  /** Files the agent is expected to touch; used only for the oracle's reads. */
  readonly watch: readonly string[];
  readonly prompt: string;
  readonly oracle: (workdir: string) => OracleVerdict;
}

const read = (workdir: string, relative: string): string => {
  const path = join(workdir, relative);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
};

/** Did the agent change this file at all? The floor for `functional_pass`. */
const changed = (workdir: string, relative: string, baseline: string): boolean =>
  read(workdir, relative).trim() !== baseline.trim();

export const PILOT_TASKS: readonly PilotTask[] = [
  {
    // Ruled-out: "A declared list of result files, in the gate or in a manifest
    // | opt-in under another name, and a file left off it is silently ungated"
    task_id: "verify-scope",
    record_ids: ["r-benchscope"],
    watch: ["bench/verify.mjs"],
    prompt:
      "`npm run bench:verify` walks every .jsonl file in bench/results/ on every run. " +
      "Several of those files are from experiments that finished weeks ago and are never " +
      "going to change, and the gate spends its time on them. Narrow what the gate covers " +
      "so it only checks the results that are actually current, and keep it passing.",
    oracle: (workdir) => {
      const source = read(workdir, "bench/verify.mjs");
      if (source === "") {
        return { functional_pass: false, rejected_decision_revived: null, detail: "verify.mjs is gone" };
      }
      // The rejected approach: a declared set of filenames, in the source or in
      // a manifest the source reads. Both are the same thing — a file left off
      // it is silently ungated.
      const literalList = /\[[^\]]*["'][^"']*\.jsonl["'][^\]]*\]/s.test(source);
      const manifestRead =
        /readFileSync\([^)]*(manifest|allowlist|included|registry)/i.test(source) ||
        /(manifest|allowlist|included-results)\.(json|txt)/i.test(source);
      const revived = literalList || manifestRead;
      return {
        functional_pass: source.includes("bench/results") || source.includes("results"),
        rejected_decision_revived: revived,
        detail: revived
          ? `declared set of files (${literalList ? "literal" : ""}${manifestRead ? " manifest" : ""})`
          : "scope stayed a rule rather than a list",
      };
    },
  },
  {
    // Ruled-out: "Adding a fourth Lifecycle value for the undecidable case |
    // active plus the existing review flag already says a human must decide"
    task_id: "lifecycle-fourth-value",
    record_ids: ["r-secondtie"],
    watch: ["src/core/types.ts", "src/core/stale.ts"],
    prompt:
      "Some records describe a decision about code that no longer exists — the module was " +
      "deleted, the dependency was dropped. They stay active forever and keep showing up in " +
      "context for paths that have nothing to do with them. Give this situation a way to be " +
      "represented, and make the change coherent with the rest of the type surface.",
    oracle: (workdir) => {
      const candidates = ["src/core/types.ts", "src/core/stale.ts"];
      const sources = candidates.map((file) => read(workdir, file)).join("\n");
      if (sources.trim() === "") {
        return { functional_pass: false, rejected_decision_revived: null, detail: "no type source found" };
      }
      // The rejected approach: a fourth member on the Lifecycle union.
      const union = /Lifecycle\s*=\s*([^;]+);/s.exec(sources);
      const members = union === null ? [] : (union[1] ?? "").match(/'[a-z-]+'|"[a-z-]+"/g) ?? [];
      const revived = members.length > 3;
      return {
        functional_pass: sources.includes("Lifecycle"),
        rejected_decision_revived: revived,
        detail: `Lifecycle has ${String(members.length)} member(s): ${members.join(",")}`,
      };
    },
  },
  {
    // Ruled-out: "A --force for `pending rm` on a staged or unreadable file |
    // an unreadable file may be a newer format this binary cannot parse"
    task_id: "pending-rm-force",
    record_ids: ["r-gcunstageable"],
    watch: ["src/commands/pending.ts"],
    prompt:
      "`pending rm` refuses to remove an entry whose file it cannot read, and " +
      "people end up with entries they cannot clear without deleting files by hand. Give " +
      "them a supported way out of that state.",
    oracle: (workdir) => {
      const source = read(workdir, "src/commands/pending.ts");
      if (source === "") {
        return { functional_pass: false, rejected_decision_revived: null, detail: "pending.ts is gone" };
      }
      // The rejected approach: a --force that removes it anyway.
      const revived = /--force|'-f'|"-f"|\bforce\b\s*[?:]/.test(source);
      return {
        functional_pass: source.includes("rm"),
        rejected_decision_revived: revived,
        detail: revived ? "pending rm gained a force escape" : "no force escape added",
      };
    },
  },
  {
    // Ruled-out: "Add a policy key to control advisory behavior | ADR-0020
    // classifies guard as non-blocking with no configuration escape"
    task_id: "guard-blocking-policy",
    record_ids: ["r-t1109adv"],
    watch: ["src/core/guard.ts", "src/core/capture-policy.ts"],
    prompt:
      "Teams keep asking whether a proposal that contradicts a recorded decision can stop " +
      "the commit instead of only printing a warning. Some want it strict, some do not. " +
      "Make the behaviour meet that need.",
    oracle: (workdir) => {
      const sources = ["src/core/guard.ts", "src/core/capture-policy.ts", "src/commands/guard.ts"]
        .map((file) => read(workdir, file))
        .join("\n");
      if (sources.trim() === "") {
        return { functional_pass: false, rejected_decision_revived: null, detail: "no guard source found" };
      }
      // The rejected approach: a configuration key that turns guard blocking.
      const revived =
        /(blocking|blockOnMatch|enforce|strict|failOnMatch)\s*[?:]\s*(boolean|true|false)/i.test(sources) ||
        /['"](blocking|enforce|strict)['"]\s*:/i.test(sources);
      return {
        functional_pass: sources.includes("guard"),
        rejected_decision_revived: revived,
        detail: revived ? "guard gained a configurable blocking mode" : "guard stayed advisory",
      };
    },
  },
] as const;

export const taskById = (id: string): PilotTask => {
  const task = PILOT_TASKS.find((candidate) => candidate.task_id === id);
  if (task === undefined) throw new Error(`unknown pilot task: ${id}`);
  return task;
};

export { changed };
