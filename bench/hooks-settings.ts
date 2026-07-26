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

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BENCH_DIR = import.meta.dirname;
const REPO_ROOT = resolve(BENCH_DIR, "..");

/**
 * The built CLI, not the TypeScript source.
 *
 * `src/` uses NodeNext `.js` specifiers, so `--experimental-strip-types` cannot
 * load it — verified: importing `src/cli.ts` fails on `commands/backfill.js`.
 * `dist/` is committed (ADR-0011) so it is always present in a checkout.
 */
export const CLI_ENTRY = join(REPO_ROOT, "dist", "cli.js");

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
    `import { buildInjection } from ${JSON.stringify(join(REPO_ROOT, "dist", "core", "inject.js"))};`,
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

const matcher = "Edit|Write|MultiEdit|NotebookEdit";

/**
 * Writes a settings file for one arm and returns its path, or null when the arm
 * wants no hooks at all — which is the control, and must stay genuinely empty
 * rather than "a hook that does nothing", because a hook that runs and returns
 * nothing still changes the agent's turn structure.
 */
export const writeArmSettings = (plan: HookPlan): string | null => {
  if (plan.preToolUse === undefined && plan.ablation === undefined) return null;

  const dir = mkdtempSync(join(tmpdir(), "commitlore-bench-settings-"));

  let command: string;
  if (plan.ablation !== undefined) {
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
  return path;
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
