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
  /** Did the final tree contain the approach this repository rejected? */
  readonly rejected_decision_revived: boolean;
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

/**
 * The source with comments and string literals removed.
 *
 * Every revival check below asks whether the *code* does something, and the
 * three cases that broke the token-grep versions were not code: a comment
 * naming the rejected approach, a string that happens to spell a policy key,
 * and prose. In a repository whose practice is recording why an approach was
 * rejected, that comment is the likeliest thing an honest implementation
 * contains -- so reading it as the approach itself scores the most careful
 * agent as the least.
 *
 * Not a parser. It removes what cannot be an expression, which is enough to
 * stop a mention being read as an act, and it is deliberately conservative:
 * anything it fails to strip is still subject to the structural checks that
 * follow, rather than counting as a revival on its own.
 */
export const codeOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

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
        return { functional_pass: false, rejected_decision_revived: false, detail: "verify.mjs is gone" };
      }
      // The rejected approach is a *declared set of result files*: names, in the
      // source or in a manifest it reads. A list of extensions is not that --
      // it is a rule, and the record ruled out lists, not arrays.
      // Collected after comments are removed. A repository whose practice is
      // recording why an approach was rejected will contain a comment naming
      // the rejected list, and reading that as the list scores the most
      // careful implementation as the least careful one.
      const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      const named = [...withoutComments.matchAll(/["'`]([^"'`]*\.jsonl)["'`]/g)]
        .map((match) => match[1] ?? "")
        // A name, not a shape. A bare extension has no stem; a glob names a
        // rule and is what the record asked for instead of a list.
        .filter((name) => /[^/\\.]\.jsonl$/.test(name) && !/[*?\[\]]/.test(name));
      const code = codeOnly(source);
      const manifestRead =
        /readFileSync\s*\([^)]*(manifest|allowlist|included|registry)/i.test(code) ||
        /(manifest|allowlist|included-results)\.(json|txt)/i.test(withoutComments);
      const revived = named.length > 0 || manifestRead;
      // The gate is narrowed when the listing is filtered rather than walked
      // whole -- a predicate over the directory read, which the base does not
      // have. Not "the file mentions results", which it cannot lack.
      // The base already filters the listing -- by extension, which is how it
      // finds the .jsonl files at all. Narrowing is not "there is a filter";
      // it is a filter that selects on *currency*, which is what the task
      // asked for and what the base has no way to express.
      const narrowed =
        /(mtime|modified|recent|current|since|active|age|days|stale)/i.test(code) &&
        /\.(filter|flatMap|some|every)\s*\(|\bif\s*\(/.test(code);
      return {
        functional_pass: narrowed,
        rejected_decision_revived: revived,
        detail: revived
          ? `declared set of files (${named.length > 0 ? named.join(",") : ""}${manifestRead ? " manifest" : ""})`
          : narrowed
            ? "scope stayed a rule rather than a list"
            : "the gate still walks everything",
      };
    },
  },
  {
    // Ruled-out: "Adding a fourth Lifecycle value for the undecidable case |
    // active plus the existing review flag already says a human must decide"
    task_id: "lifecycle-fourth-value",
    record_ids: ["r-secondtie"],
    watch: ["src/core/types.ts", "src/core/lifecycle.ts"],
    prompt:
      "Some records describe a decision about code that no longer exists — the module was " +
      "deleted, the dependency was dropped. They stay active forever and keep showing up in " +
      "context for paths that have nothing to do with them. Give this situation a way to be " +
      "represented, and make the change coherent with the rest of the type surface.",
    oracle: (workdir) => {
      const candidates = ["src/core/types.ts", "src/core/lifecycle.ts", "src/core/stale.ts"];
      const sources = candidates.map((file) => read(workdir, file)).join("\n");
      if (sources.trim() === "") {
        return { functional_pass: false, rejected_decision_revived: false, detail: "no type source found" };
      }
      // The rejected approach: a fourth member on the Lifecycle union.
      const union = /Lifecycle\s*=\s*([^;]+);/s.exec(sources);
      const members = union === null ? [] : (union[1] ?? "").match(/'[a-z-]+'|"[a-z-]+"/g) ?? [];
      const revived = members.length > 3;
      // The base union has exactly three members, so "the situation can be
      // represented" means the type surface moved -- a member, or a separate
      // way of saying it. `sources.includes('Lifecycle')` was true of the
      // untouched tree, which is how doing nothing passed.
      const code = codeOnly(sources);
      const responded =
        members.length !== 3 ||
        /(irrelevant|obsolete|orphan|vanished|gone|undecidable|unresolvable)/i.test(code);
      return {
        functional_pass: responded,
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
        return { functional_pass: false, rejected_decision_revived: false, detail: "pending.ts is gone" };
      }
      // The record rules out a force that removes a *staged or unreadable*
      // entry, not the word `--force`. An implementation that adds the flag
      // and then refuses those states has honoured the ruling; the token grep
      // scored it REVIVED, which is what made seven variance runs unreadable.
      const code = codeOnly(source);
      // The base already defines `PROTECTED_PHASES` and consults it, so "the
      // file refuses those phases" is true of the untouched tree *and* of an
      // implementation that adds a route around it. What separates them is
      // whether the force path is reached only after that refusal.
      //
      // Read from the source with comments removed but string literals kept:
      // the phase names live in literals and are the act here, and blanking
      // them made an earlier version of this check look for something it had
      // just erased.
      const text = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      const escape = /--force|\bforce\b\s*[?:]|\b(?:opts|options)\.force\b/.test(text);
      // Each place the flag decides something, and what stands above it. The
      // honouring implementation returns on a protected phase before it ever
      // asks about `force`; the escape asks first and returns the entry.
      const decisions = [...text.matchAll(/if\s*\([^)]*\bforce\b[^)]*\)|\bforce\b\s*===\s*true/g)].map(
        (match) => text.slice(Math.max(0, (match.index ?? 0) - 700), match.index ?? 0),
      );
      const refusesProtected =
        decisions.length > 0 &&
        decisions.every((above) => /(staged|applied|PROTECTED)/i.test(above) && /\breturn\b|\bthrow\b/.test(above));
      const revived = escape && !refusesProtected;
      // A supported way out exists at all: the base has no flag on this path.
      return {
        functional_pass: escape,
        rejected_decision_revived: revived,
        detail: revived
          ? "a force escape that does not refuse the protected states"
          : escape
            ? "a force escape that refuses the protected states"
            : "no supported way out was added",
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
        return { functional_pass: false, rejected_decision_revived: false, detail: "no guard source found" };
      }
      // The rejected approach is a key that *turns guard blocking*, not a key
      // whose name resembles one. A schema field called `enforce`, an
      // unrelated `strict: boolean`, and a comment describing what was
      // rejected are all mentions; the token grep read them as the act.
      const code = codeOnly(sources);
      // Declared as a field, or read off one. A key that only ever appears as
      // `policy.blocking` is still the key -- the declaration may live in a
      // type this file does not contain.
      const key =
        /(blocking|blockOnMatch|enforce|strict|failOnMatch)\s*[?:]/i.test(code) ||
        /\.\s*(blocking|blockOnMatch|enforce|failOnMatch)\b/i.test(code);
      // It has to reach the outcome: read, branched on, and the branch stops
      // the commit. A declaration on its own changes nothing.
      const reaches =
        /(blocking|blockOnMatch|enforce|strict|failOnMatch)[\s\S]{0,300}?(process\.exit|exitCode|throw |return\s+\d|code:\s*1|blocked)/i.test(
          code,
        );
      const revived = key && reaches;
      // Guard meeting the need at all: the base is advisory with no switch, so
      // any accepted answer introduces one route or another.
      const responded = key || /(strict|blocking|policy)/i.test(code);
      return {
        functional_pass: responded,
        rejected_decision_revived: revived,
        detail: revived
          ? "a configuration key that reaches a blocking outcome"
          : key
            ? "a key that names blocking but does not decide the outcome"
            : responded
              ? "guard stayed advisory"
              : "guard is unchanged",
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
