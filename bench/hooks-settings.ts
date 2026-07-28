/**
 * Settings files that put the shipped delivery path into the benchmark.
 *
 * `bench/context.ts` assembles one block of text before the agent starts. The
 * product does not do that. `src/core/inject.ts` is a PreToolUse hook: it runs
 * on every Edit, it is scoped to the path being edited, and it refuses an
 * unscoped path outright. Those are different delivery shapes, and only the
 * second one ships — which is why the `no-scope` arm was inert and why the
 * primary matrix measured records-versus-no-records rather than the product
 * (#36, `bench/ROUTE-GAP.md`).
 *
 * A settings file is how the harness reaches that path. `--setting-sources ""`
 * removes the operator's hooks, so the only hooks an arm has are the ones
 * written here.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

import type { GuardExposure } from "./types.ts";

const BENCH_DIR = import.meta.dirname;
const REPO_ROOT = resolve(BENCH_DIR, "..");

/**
 * The built CLI, not the TypeScript source.
 *
 * `src/` uses NodeNext `.js` specifiers, so `--experimental-strip-types` cannot
 * load it — verified: importing `src/cli.ts` fails on `commands/backfill.js`.
 * `dist/` is committed (ADR-0011) so it is always present in a checkout.
 *
 * Overridable via `COMMITLORE_BENCH_DIST_DIR`, which exists for exactly one
 * caller: `test/bench-ablation.test.ts` points it at a private snapshot so
 * the mid-run consistency check below cannot be tripped by an unrelated test
 * file rebuilding this repository's own `dist/` at the same time
 * (bug-issue-88). Nothing outside the test suite sets this variable, so a
 * real benchmark run reads the repository's `dist/` exactly as before.
 */
export const DIST_DIR = process.env.COMMITLORE_BENCH_DIST_DIR ?? join(REPO_ROOT, "dist");
export const CLI_ENTRY = join(DIST_DIR, "cli.js");

export const digestDistTree = (distDir: string = DIST_DIR): string => {
  const files: string[] = [];
  const collect = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) collect(path);
      else files.push(relative(distDir, path).split(sep).join("/"));
    }
  };
  collect(distDir);

  // M3 was invalidated when dist/core/guard.js changed mid-run while dist/cli.js stayed byte-identical.
  const hash = createHash("sha256");
  for (const path of files.sort()) {
    hash.update(path).update("\0").update(readFileSync(join(distDir, path))).update("\0");
  }
  return hash.digest("hex");
};

export interface HookPlan {
  /** Which commitlore subcommand the PreToolUse hook runs, or none. */
  readonly preToolUse?: "inject" | "guard";
  /** Extra arguments after the subcommand. */
  readonly args?: readonly string[];
  /**
   * Ablation flags for an arm that removes a guarantee.
   *
   * These do not go through the CLI, and must not. `src/commands/inject.ts`
   * builds `InjectOptions` field by field from parsed flags precisely so that
   * no command line, hook payload or settings file can set an ablation —
   * `noGrade` injects the prompt-injection payload that grading exists to
   * withhold, so a flag for it on the shipped binary would be a vulnerability.
   * An arm that needs one calls `buildInjection` directly through the shim
   * below, which lives here and ships nowhere.
   */
  readonly ablation?: Readonly<Record<string, boolean>>;
}

export interface ArmSettings {
  readonly settingsPath: string | null;
  readonly guardExposurePath: string | null;
}

export const noGuardExposure = (): GuardExposure => ({ complete: true, executed: false, checks: 0, fires: 0, matches: [] });

/**
 * A PreToolUse hook that calls the real `buildInjection` with ablation flags.
 *
 * Thin on purpose: it parses the hook payload, calls the shipped function, and
 * prints the shipped shape. What it must never become is `bench/context.ts` —
 * a second implementation that drifts from the product and then gets measured
 * instead of it.
 */
const ablationShim = (ablation: Readonly<Record<string, boolean>>): string =>
  [
    `import { buildInjection } from ${JSON.stringify(join(DIST_DIR, "core", "inject.js"))};`,
    "let raw = '';",
    "for await (const chunk of process.stdin) raw += chunk;",
    "const payload = JSON.parse(raw || '{}');",
    "const filePath = payload?.tool_input?.file_path;",
    "if (typeof filePath !== 'string' || filePath === '') process.exit(0);",
    `const ablation = ${JSON.stringify(ablation)};`,
    "let injection;",
    "try {",
    "  injection = buildInjection({ path: filePath, cwd: process.cwd(), ablation });",
    "} catch {",
    "  process.exit(0);", // a path with nothing, or one the injector refuses
    "}",
    "if (!injection.text) process.exit(0);",
    "process.stdout.write(JSON.stringify({",
    "  hookSpecificOutput: {",
    "    hookEventName: 'PreToolUse',",
    "    additionalContext: injection.text,",
    "  },",
    "}));",
    "",
  ].join("\n");

/**
 * The guard path needs a side channel because Claude only returns its final
 * response: hook output is otherwise gone by the time the runner writes a row.
 * This is deliberately a thin hook adapter, not a second matcher: it calls the
 * shipped guard implementation with the exact hook options and records its
 * structured match result before returning the normal hook JSON to Claude.
 */
const guardShim = (exposurePath: string): string =>
  [
    `import { appendFileSync } from "node:fs";`,
    `import { guard, DEFAULT_THRESHOLD, renderGuardMatch } from ${JSON.stringify(join(DIST_DIR, "core", "guard.js"))};`,
    `import { formatHookContext } from ${JSON.stringify(join(DIST_DIR, "commands", "guard.js"))};`,
    "let raw = '';",
    "for await (const chunk of process.stdin) raw += chunk;",
    "let payload;",
    "try { payload = JSON.parse(raw || '{}'); } catch { process.exit(0); }",
    "const proposal = payload?.tool_input?.new_string;",
    "const filePath = payload?.tool_input?.file_path;",
    "if (typeof proposal !== 'string' || proposal.trim() === '') process.exit(0);",
    "const result = guard({",
    "  proposal,",
    "  ...(typeof filePath === 'string' && filePath !== '' ? { paths: [filePath] } : {}),",
    "  threshold: DEFAULT_THRESHOLD, at: new Date(), requireContent: true,",
    "});",
    "const matches = result.matches.map((match) => {",
    "  const rendered = renderGuardMatch(match);",
    "  return {",
    "    path: typeof filePath === 'string' && filePath !== '' ? filePath : null,",
    "    alternative: rendered.trust === 'blocked' ? null : rendered.alternative,",
    "    record_id: rendered.recordId ?? rendered.sha,",
    "  };",
    "});",
    `appendFileSync(${JSON.stringify(exposurePath)}, JSON.stringify({ complete: !result.incomplete, fired: matches.length > 0, matches }) + '\\n');`,
    "const context = formatHookContext(result);",
    "if (context !== '') process.stdout.write(JSON.stringify({",
    "  hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context },",
    "}) + '\\n');",
    "",
  ].join("\n");

const matcher = "Edit|Write|MultiEdit|NotebookEdit";

/**
 * Writes a settings file for one arm and returns its path, or null when the arm
 * wants no hooks at all — which is the control, and must stay genuinely empty
 * rather than "a hook that does nothing", because a hook that runs and returns
 * nothing still changes the agent's turn structure.
 */
export const writeArmSettings = (plan: HookPlan, expectedDistDigest: string): ArmSettings => {
  const currentDistDigest = digestDistTree();
  if (currentDistDigest !== expectedDistDigest) {
    throw new Error(
      `dist/ changed after the benchmark matrix started: expected sha256 ${expectedDistDigest}, found ${currentDistDigest}`,
    );
  }
  if (plan.preToolUse === undefined && plan.ablation === undefined) {
    return { settingsPath: null, guardExposurePath: null };
  }

  const dir = mkdtempSync(join(tmpdir(), "commitlore-bench-settings-"));

  let command: string;
  let guardExposurePath: string | null = null;
  if (plan.preToolUse === "guard") {
    guardExposurePath = join(dir, "guard-exposure.jsonl");
    writeFileSync(guardExposurePath, '{"version":1}\n');
    const shimPath = join(dir, "guard-hook.mjs");
    writeFileSync(shimPath, guardShim(guardExposurePath));
    command = `${JSON.stringify(process.execPath)} ${JSON.stringify(shimPath)}`;
  } else if (plan.ablation !== undefined) {
    const shimPath = join(dir, "ablate-inject.mjs");
    writeFileSync(shimPath, ablationShim(plan.ablation));
    command = `${JSON.stringify(process.execPath)} ${JSON.stringify(shimPath)}`;
  } else {
    command = [
      JSON.stringify(process.execPath),
      JSON.stringify(CLI_ENTRY),
      plan.preToolUse,
      ...(plan.args ?? []),
    ].join(" ");
  }

  const settings = {
    hooks: {
      PreToolUse: [{ matcher, hooks: [{ type: "command", command }] }],
    },
  };

  const path = join(dir, "settings.json");
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return { settingsPath: path, guardExposurePath };
};

export const readGuardExposure = (exposurePath: string | null): GuardExposure | undefined => {
  if (exposurePath === null) return noGuardExposure();
  if (!existsSync(exposurePath)) return undefined;
  let checks = 0;
  let fires = 0;
  let complete = true;
  const matches: GuardExposure["matches"][number][] = [];
  const lines = readFileSync(exposurePath, "utf8").split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return undefined;
  let header: unknown;
  try {
    header = JSON.parse(lines[0] ?? "");
  } catch {
    return undefined;
  }
  if (typeof header !== "object" || header === null || !("version" in header) || header.version !== 1) return undefined;
  for (const line of lines.slice(1)) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (
      typeof event !== "object" ||
      event === null ||
      !("complete" in event) ||
      typeof event.complete !== "boolean" ||
      !("fired" in event) ||
      typeof event.fired !== "boolean" ||
      !("matches" in event) ||
      !Array.isArray(event.matches)
    ) {
      return undefined;
    }
    checks += 1;
    for (const match of event.matches) {
      if (
        typeof match !== "object" ||
        match === null ||
        !("alternative" in match) ||
        !("record_id" in match) ||
        !("path" in match) ||
        (match.alternative !== null && typeof match.alternative !== "string") ||
        typeof match.record_id !== "string" ||
        (match.path !== null && typeof match.path !== "string")
      ) {
        return undefined;
      }
      matches.push({ path: match.path, alternative: match.alternative, record_id: match.record_id });
    }
    if (event.fired !== (event.matches.length > 0)) {
      return undefined;
    }
    if (!event.complete) complete = false;
    if (event.fired) fires += 1;
  }
  return { complete, executed: checks > 0, checks, fires, matches };
};

/**
 * The hook plan for each condition.
 *
 * `commitlore-on` runs the real injector per edit. The arms that exist to
 * measure a removed guarantee pass the matching ablation flag straight through
 * to it, so they exercise the same code path with one thing switched off rather
 * than a re-implementation of it.
 */
export const HOOK_PLANS: Readonly<Record<string, HookPlan>> = {
  "commitlore-on": { preToolUse: "inject", args: ["--hook-input"] },
  "commitlore-off": {},
  "commitlore-guard": { preToolUse: "guard", args: ["--hook-input"] },
  "no-scope": { ablation: { noScope: true } },
  "no-grade": { ablation: { noGrade: true } },
  "no-lifecycle": { ablation: { noLifecycle: true } },
};
