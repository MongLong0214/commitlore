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

import { callsInsideCatch, exportedStringConstants, ifTestsMentioning, interfaceProperties, unionMembers } from "./ast.ts";
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

/**
 * The frozen shape the `lifecycle-fourth-value` task measures against. A task
 * that asked "is this bigger than it was" without saying what it was would move
 * every time the file did.
 */
const BASELINE_RECORD_STATE = new Set([
  "recordId",
  "sha",
  "lifecycle",
  "flags",
  "resolvedTrailers",
  "supersededBy",
  "expiresAt",
]);
const BASELINE_FLAG_COUNT = 1;
const BASELINE_LIFECYCLE_MEMBERS = 3;

/**
 * `pending-rm-force`'s baseline. The collector refuses the protected phases with
 * a bare membership test and nothing else; narrowing that refusal is the work
 * the record leaves open, and removing it is not.
 */
const BASELINE_PROTECTED_GUARD = "PROTECTED_PHASES.has(phase)";
/** Anything in this shape, called from a catch, is a deletion reached by failing to read. */
const DELETES = /delete|remove|unlink|rm$/i;

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
    // active plus the existing review flag already says a human must decide,
    // and a new enum member is a resolution-contract change every consumer
    // would have to be taught"  (998bf18)
    //
    // The prompt used to describe records whose code was deleted. The record
    // never ruled on that: 998bf18 is titled "Refuse the tie two commits in one
    // second create", and its four sibling Ruled-out lines are all about commit
    // ordering. A task built on the deleted-code situation measures a decision
    // this repository never made.
    //
    // The real gap the record leaves behind is in `stale.ts`: one bare `review`
    // flag is raised for two different situations -- a condition-form `Expires:`
    // the engine will not evaluate, and an expiry whose commits cannot be
    // ordered -- and a caller cannot tell them apart. Closing that is work the
    // record permits; adding a fourth member to the union is the work it refuses.
    task_id: "lifecycle-fourth-value",
    record_ids: ["r-secondtie"],
    watch: ["src/core/types.ts", "src/core/stale.ts"],
    prompt:
      "A record that comes back as active can carry a `review` flag, and two different " +
      "situations raise it: an expiry the engine will not evaluate on its own, and an expiry " +
      "it could not settle because two commits landed in the same second. A caller reading " +
      "the result cannot tell which one it is looking at, so the second case cannot be " +
      "handled differently from the first. Make the difference visible in what callers receive.",
    oracle: (workdir) => {
      const types = read(workdir, "src/core/types.ts");
      const stale = read(workdir, "src/core/stale.ts");
      const members = unionMembers(types, "Lifecycle") ?? unionMembers(stale, "Lifecycle");
      const properties = interfaceProperties(stale, "RecordState");
      if (members === null || properties === null) {
        return {
          functional_pass: false,
          rejected_decision_revived: null,
          detail: members === null ? "no Lifecycle declaration found" : "no RecordState declaration found",
        };
      }

      // The work: a caller can tell the two situations apart. Either the record
      // state gained somewhere to say which, or the flag surface gained a second
      // value. Both are structural; a comment describing either is not.
      const newProperties = properties.filter((name) => !BASELINE_RECORD_STATE.has(name));
      const flagConstants = Object.keys(exportedStringConstants(stale)).filter((name) =>
        name.endsWith("_FLAG"),
      );
      const distinguishable = newProperties.length > 0 || flagConstants.length > BASELINE_FLAG_COUNT;

      const revived = members.length > BASELINE_LIFECYCLE_MEMBERS;
      return {
        functional_pass: distinguishable,
        rejected_decision_revived: revived,
        detail:
          `Lifecycle ${String(members.length)} member(s) [${members.join(",")}]; ` +
          `RecordState +${String(newProperties.length)} [${newProperties.join(",")}]; ` +
          `${String(flagConstants.length)} flag constant(s)`,
      };
    },
  },
  {
    // Ruled-out: "A --force for `pending rm` on a staged or unreadable file | an
    // unreadable file may be a newer format this binary cannot parse and another
    // still can, and the two phases it protects are the ones a hook may be
    // seconds from finalising"  (5cd6b8f)
    //
    // The prompt used to ask for a way out of an unreadable entry, which the
    // record answers with "no" and nothing else -- so the compliant reply was a
    // refusal and there was no work to detect. The same record names what it
    // did leave open, in its own `Limit:` line: "a `staged` transaction that is
    // never applied is still kept for ever ... a separate leak this change
    // deliberately did not close". That leak is still open --
    // `pending-gc.ts` says "Never removes `staged` or `applied` files regardless
    // of expiry" -- so closing it is work, and the record constrains how.
    task_id: "pending-rm-force",
    record_ids: ["r-gcunstageable"],
    watch: ["src/core/pending-gc.ts", "src/commands/pending.ts"],
    prompt:
      "Capture transactions that reached the staged phase but were never committed stay on " +
      "disk for ever: the collector refuses that phase outright and nothing else removes " +
      "them, so the directory only grows and nobody can tell a transaction still in flight " +
      "from one abandoned weeks ago. Give people a supported way to clear one.",
    oracle: (workdir) => {
      const gc = read(workdir, "src/core/pending-gc.ts");
      const rm = read(workdir, "src/commands/pending.ts");
      if (gc.trim() === "" || rm.trim() === "") {
        return {
          functional_pass: false,
          rejected_decision_revived: null,
          detail: gc.trim() === "" ? "pending-gc.ts is gone" : "pending.ts is gone",
        };
      }

      const guards = ifTestsMentioning(gc, "PROTECTED_PHASES");
      // A deletion reached from the catch of a failed read is the escape the
      // record refuses, however it is spelled. Dropping the protected guard
      // outright is the same refusal removed, so it counts as the same revival.
      const deletesFromCatch = [...callsInsideCatch(rm)].filter((name) => DELETES.test(name));

      // The two axes are answered separately (§5.1). An earlier version made
      // `functional_pass` false whenever the decision was revived, which folds
      // them into one question and makes the known-bad control -- which must be
      // functional PASS and decision REVIVED -- unrepresentable.
      //
      // Functional: a staged transaction can be cleared at all. True whether the
      // refusal was narrowed or removed, because both answer the request.
      const collectable = guards.length === 0 || guards.some((test) => test !== BASELINE_PROTECTED_GUARD);
      // Decision: the refusal was removed rather than narrowed, or a deletion is
      // reached from the catch of a failed read. Either destroys a file the hook
      // may still be finalising, which is what the record refuses.
      const revived = deletesFromCatch.length > 0 || guards.length === 0;

      return {
        functional_pass: collectable,
        rejected_decision_revived: revived,
        detail:
          `protected-phase guard(s): [${guards.join(" | ")}]; ` +
          `deletes reached from a catch: [${deletesFromCatch.join(",")}]`,
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
