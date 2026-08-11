/**
 * The two CDEB arm configurations (PRD §§2.3, 9.1–9.2).
 *
 * This writer deliberately has no option for a budget, trusted author, or
 * index policy.  The proxy invokes the pinned shipping command with exactly
 * the installed hook's arguments, so those product defaults remain product
 * defaults rather than benchmark choices.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { DEFAULT_BUDGET_TOKENS } from "../../../dist/core/inject.js";
import { configuredTrustedAuthors } from "../../../dist/core/trusted-authors.js";
import { CLAUDE_HOOK_EVENT, CLAUDE_HOOK_MATCHER } from "../../../dist/hooks/claude-settings.js";

import { EMPTY_MCP_CONFIG } from "./isolation.ts";
import { CONTAINER_NODE_EXECUTABLE, CONTAINER_SHIPPING_CLI, SHIPPING_HOOK_ARGS } from "./shipping-proxy.ts";

export type CdebArm = "on" | "off";

export const CONTAINER_PROXY_ENTRY = "/opt/cdeb/shipping-proxy.ts";
export const CONTAINER_EXPOSURE_PATH = "/repo/.git/cdeb/exposure.jsonl";
export const CDEB_EXPOSURE_RELATIVE_PATH = ".git/cdeb/exposure.jsonl";

const CAPTURE_HOOK_NAMES = ["commit-msg", "prepare-commit-msg", "post-commit", "pre-push"] as const;

export interface ShippingConfigurationFreeze {
  readonly hookEvent: string;
  readonly matcher: string;
  readonly childCommand: readonly string[];
  readonly defaultBudget: number;
  readonly trustedAuthors: readonly string[];
  readonly noIndex: false;
}

export interface CdebArmConfig {
  readonly arm: CdebArm;
  readonly configDir: string;
  readonly settingsPath: string;
  readonly mcpPath: string;
  readonly exposurePath: string;
  readonly settingsJson: string;
  readonly mcpJson: string;
  readonly shipping: ShippingConfigurationFreeze;
}

export class CaptureSurfaceError extends Error {
  public constructor(message: string) {
    super(`CDEB capture surface must be absent: ${message}`);
    this.name = "CaptureSurfaceError";
  }
}

const quote = (value: string): string => JSON.stringify(value);

/** Command the Claude settings shell runs; the child is the shipping injector. */
export const proxyHookCommand = (): string =>
  [
    quote(CONTAINER_NODE_EXECUTABLE),
    "--no-warnings",
    "--experimental-strip-types",
    quote(CONTAINER_PROXY_ENTRY),
    "--exposure",
    quote(CONTAINER_EXPOSURE_PATH),
    "--node",
    quote(CONTAINER_NODE_EXECUTABLE),
    "--shipping-cli",
    quote(CONTAINER_SHIPPING_CLI),
  ].join(" ");

export const readShippingConfigurationFreeze = (cwd: string): ShippingConfigurationFreeze => ({
  hookEvent: CLAUDE_HOOK_EVENT,
  matcher: CLAUDE_HOOK_MATCHER,
  childCommand: [CONTAINER_NODE_EXECUTABLE, CONTAINER_SHIPPING_CLI, ...SHIPPING_HOOK_ARGS],
  defaultBudget: DEFAULT_BUDGET_TOKENS,
  trustedAuthors: configuredTrustedAuthors(cwd),
  noIndex: false,
});

const settingsFor = (arm: CdebArm): Record<string, unknown> =>
  arm === "off"
    ? { hooks: {} }
    : {
        hooks: {
          [CLAUDE_HOOK_EVENT]: [
            {
              matcher: CLAUDE_HOOK_MATCHER,
              hooks: [{ type: "command", command: proxyHookCommand() }],
            },
          ],
        },
      };

const activeCaptureHooks = (cwd: string): readonly { name: string; path: string }[] => {
  // `git rev-parse --git-path` resolves linked worktrees and core.hooksPath.
  const result = spawnSync("git", ["rev-parse", "--git-path", "hooks"], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new CaptureSurfaceError(`cannot locate git hooks (${(result.stderr ?? "").trim()})`);
  const hooksDir = resolve(cwd, (result.stdout ?? "").trim());
  return CAPTURE_HOOK_NAMES.flatMap((name) => {
    const path = join(hooksDir, name);
    if (!existsSync(path)) return [];
    try {
      return (statSync(path).mode & 0o111) === 0 ? [] : [{ name, path }];
    } catch {
      return [{ name, path }];
    }
  });
};

const assertSettingsContainOnlyDelivery = (config: CdebArmConfig): void => {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(config.settingsPath, "utf8"));
  } catch {
    throw new CaptureSurfaceError(`${config.arm} settings are unreadable`);
  }
  const expected = settingsFor(config.arm);
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new CaptureSurfaceError(`${config.arm} settings are not the frozen delivery-only shape`);
  }
};

/** Refuses a run where any capture hook could run in either condition. */
export const assertCaptureSurfaceAbsent = (cwd: string, config: CdebArmConfig): void => {
  assertSettingsContainOnlyDelivery(config);
  const active = activeCaptureHooks(cwd);
  if (active.length > 0) {
    throw new CaptureSurfaceError(
      `${config.arm} arm has active ${active.map((hook) => `${hook.name} (${hook.path})`).join(", ")}`,
    );
  }
};

/**
 * Writes the CDEB-controlled files consumed by `executeAgentRun`.  The caller
 * supplies a fresh config directory; reusing one risks mixing an exposure log
 * from another logical run, so that is refused rather than overwritten.
 */
export const writeCdebArmConfig = (cwd: string, configDir: string, arm: CdebArm): CdebArmConfig => {
  mkdirSync(configDir, { recursive: true });
  const settingsPath = join(configDir, "settings.json");
  const mcpPath = join(configDir, "mcp.json");
  const exposurePath = join(cwd, CDEB_EXPOSURE_RELATIVE_PATH);
  if (existsSync(settingsPath) || existsSync(mcpPath)) {
    throw new Error(`CDEB config directory is not fresh: ${configDir}`);
  }
  if (existsSync(exposurePath)) {
    throw new Error(`CDEB exposure path already exists: ${exposurePath}`);
  }
  mkdirSync(dirname(exposurePath), { recursive: true });
  writeFileSync(exposurePath, "", { flag: "wx" });

  const settingsJson = `${JSON.stringify(settingsFor(arm), null, 2)}\n`;
  const mcpJson = `${EMPTY_MCP_CONFIG}\n`;
  writeFileSync(settingsPath, settingsJson, { flag: "w" });
  writeFileSync(mcpPath, mcpJson, { flag: "w" });
  const config: CdebArmConfig = {
    arm,
    configDir,
    settingsPath,
    mcpPath,
    exposurePath,
    settingsJson,
    mcpJson,
    shipping: readShippingConfigurationFreeze(cwd),
  };
  assertCaptureSurfaceAbsent(cwd, config);
  return config;
};

/** Hash the complete observer implementation, including its frozen parser. */
export const shippingProxySha256 = (proxyPath: string, parserPath: string): string => {
  const hash = createHash("sha256");
  for (const path of [proxyPath, parserPath]) {
    hash.update(path).update("\0").update(readFileSync(path)).update("\0");
  }
  return hash.digest("hex");
};

export const assertFrozenShippingProxy = (expectedSha256: string, proxyPath: string, parserPath: string): void => {
  const actual = shippingProxySha256(proxyPath, parserPath);
  if (actual !== expectedSha256) {
    throw new Error(`CDEB shipping proxy changed: expected sha256 ${expectedSha256}, found ${actual}`);
  }
};
