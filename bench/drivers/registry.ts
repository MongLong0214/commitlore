import { createClaudeHeadlessDriver } from "./claude-headless.ts";
import { createDryRunDriver } from "./dry-run.ts";
import type { AgentDriver, DriverOptions } from "./types.ts";

type DriverFactory = (options: DriverOptions) => AgentDriver;

const FACTORIES: Readonly<Record<string, DriverFactory>> = {
  "claude-headless": (options) => createClaudeHeadlessDriver(options),
  "dry-run": () => createDryRunDriver(),
};

export const DRIVER_NAMES: readonly string[] = Object.keys(FACTORIES);

export const createDriver = (name: string, options: DriverOptions = {}): AgentDriver => {
  const factory = FACTORIES[name];
  if (factory === undefined) {
    throw new Error(`unknown driver \`${name}\` (available: ${DRIVER_NAMES.join(", ")})`);
  }
  return factory(options);
};
