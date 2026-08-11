/**
 * CDEB-04 acceptance: the ON arm is the shipping hook, observed without
 * changing a byte.  These tests drive the CLI subprocess rather than the core
 * injection function so a replacement renderer cannot satisfy them.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  assertCaptureSurfaceAbsent,
  assertFrozenShippingProxy,
  readShippingConfigurationFreeze,
  shippingProxySha256,
  writeCdebArmConfig,
} from "../bench/cdeb/runtime/arm-settings.ts";
import { ExposureIntegrityError, readExposureEvents } from "../bench/cdeb/runtime/exposure.ts";
import { CLI_ENTRY } from "../bench/hooks-settings.ts";
import { CLAUDE_HOOK_EVENT, CLAUDE_HOOK_MATCHER } from "../dist/hooks/claude-settings.js";
import { execGit } from "../src/core/git.js";
import { createTestRepo } from "./git-fixtures.js";

const PROXY = resolve("bench/cdeb/runtime/shipping-proxy.ts");
const PARSER = resolve("bench/cdeb/runtime/exposure.ts");
const scratch: string[] = [];

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const path = mkdtempSync(join(tmpdir(), `cdeb-proxy-${label}-`));
  scratch.push(path);
  return path;
};

const createRepo = (): string => {
  const repo = createTestRepo({ path: temp("repo") });
  execGit(["config", "user.email", "owner@example.invalid"], { cwd: repo });
  execGit(["config", "user.name", "owner"], { cwd: repo });
  return repo;
};

const seed = (repo: string, file = "pricing.ts", id = "r-proxy01"): void => {
  writeFileSync(join(repo, file), "export const price = 1;\n");
  execGit(["add", file], { cwd: repo });
  execGit(
    [
      "commit",
      "--no-verify",
      "-m",
      [
        "feat: price",
        "",
        "Ruled-out: shared cache | it would introduce an unowned runtime dependency",
        `Record-Id: ${id}`,
        "Provenance: authored",
      ].join("\n"),
    ],
    { cwd: repo },
  );
};

const payload = (file: string): Buffer =>
  Buffer.from(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: file },
    }),
    "utf8",
  );

const direct = (repo: string, input: Buffer) =>
  spawnSync(process.execPath, [CLI_ENTRY, "inject", "--hook-input"], {
    cwd: repo,
    input,
    encoding: "buffer",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });

const proxied = (repo: string, exposure: string, input: Buffer) =>
  spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", PROXY, "--exposure", exposure, "--node", process.execPath, "--shipping-cli", CLI_ENTRY],
    { cwd: repo, input, encoding: "buffer", env: { ...process.env, NODE_NO_WARNINGS: "1" } },
  );

const output = (value: Buffer | string | undefined): Buffer =>
  Buffer.isBuffer(value) ? value : Buffer.from(value ?? "", "utf8");

let repo: string;
beforeEach(() => {
  repo = createRepo();
});

describe("CDEB §9.3 transparent shipping proxy", () => {
  it("forwards a real shipping injection byte-for-byte", () => {
    seed(repo);
    const input = payload("pricing.ts");
    const directResult = direct(repo, input);
    const exposure = join(temp("identity"), "exposure.jsonl");
    const proxyResult = proxied(repo, exposure, input);

    expect(proxyResult.status).toBe(directResult.status);
    expect(output(proxyResult.stdout).equals(output(directResult.stdout))).toBe(true);
    expect(output(proxyResult.stderr).equals(output(directResult.stderr))).toBe(true);

    const events = readExposureEvents(exposure);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tool_name: "Read",
      repository_relative_path: "pricing.ts",
      child_exit_code: 0,
      parsed_record_ids: ["r-proxy01"],
      parse_state: "parsed",
    });
    expect(events[0]?.stdout_bytes).toBe(output(directResult.stdout).length);
  });

  it("keeps product errors byte-identical too", () => {
    const input = Buffer.from("not JSON\n", "utf8");
    const directResult = direct(repo, input);
    const exposure = join(temp("error"), "exposure.jsonl");
    const proxyResult = proxied(repo, exposure, input);

    expect(proxyResult.status).toBe(directResult.status);
    expect(output(proxyResult.stdout).equals(output(directResult.stdout))).toBe(true);
    expect(output(proxyResult.stderr).equals(output(directResult.stderr))).toBe(true);
    expect(readExposureEvents(exposure)[0]?.product_error).toContain("unparseable JSON");
  });

  it("records a fired hook with no delivery differently from no hook at all", () => {
    writeFileSync(join(repo, "unrelated.ts"), "export const unrelated = true;\n");
    execGit(["add", "unrelated.ts"], { cwd: repo });
    execGit(["commit", "--no-verify", "-m", "feat: unrelated"], { cwd: repo });
    const exposure = join(temp("empty"), "exposure.jsonl");

    const result = proxied(repo, exposure, payload("unrelated.ts"));

    expect(result.status).toBe(0);
    expect(output(result.stdout)).toEqual(Buffer.alloc(0));
    expect(readExposureEvents(exposure)).toMatchObject([{ parse_state: "empty", parsed_record_ids: [] }]);
  });

  // A fired-but-empty hook has stdout, and `sha256("")` is a valid digest of
  // it. If that reached the event, a summariser collecting payload digests
  // would count the empty delivery as a payload — the same conflation §9.5
  // forbids one layer down.
  it("attaches no payload digest to an empty delivery", () => {
    writeFileSync(join(repo, "unrelated.ts"), "export const unrelated = true;\n");
    execGit(["add", "unrelated.ts"], { cwd: repo });
    execGit(["commit", "--no-verify", "-m", "feat: unrelated"], { cwd: repo });
    const exposure = join(temp("no-payload"), "exposure.jsonl");

    proxied(repo, exposure, payload("unrelated.ts"));

    const [event] = readExposureEvents(exposure);
    expect(event?.payload_sha256).toBeNull();
    expect(event?.stdout_sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("refuses an event that claims a payload the hook never delivered", () => {
    writeFileSync(join(repo, "unrelated.ts"), "export const unrelated = true;\n");
    execGit(["add", "unrelated.ts"], { cwd: repo });
    execGit(["commit", "--no-verify", "-m", "feat: unrelated"], { cwd: repo });
    const exposure = join(temp("forged-payload"), "exposure.jsonl");
    proxied(repo, exposure, payload("unrelated.ts"));
    const original = readFileSync(exposure, "utf8");
    const forged = JSON.parse(original.trim()) as Record<string, unknown>;
    forged["payload_sha256"] = forged["stdout_sha256"];
    writeFileSync(exposure, `${JSON.stringify(forged)}\n`);

    expect(() => readExposureEvents(exposure)).toThrowError(/reports a payload for an? empty delivery/u);
  });

  it("refuses an ambiguous output parse instead of silently calling it empty", () => {
    seed(repo);
    const exposure = join(temp("ambiguous"), "exposure.jsonl");
    proxied(repo, exposure, payload("pricing.ts"));
    const original = readFileSync(exposure, "utf8");
    writeFileSync(exposure, original.replace('"parse_state":"parsed"', '"parse_state":"unknown"').replace('"parsed_record_ids":["r-proxy01"]', '"parsed_record_ids":null'));

    expect(() => readExposureEvents(exposure)).toThrowError(ExposureIntegrityError);
  });
});

describe("CDEB §§2.3 and 9.2 arm integrity", () => {
  it("uses the exact shipping event, matcher, default budget, trust, and index policy", () => {
    execGit(["config", "--add", "commitlore.trustedAuthor", "owner@example.invalid"], { cwd: repo });

    const freeze = readShippingConfigurationFreeze(repo);

    expect(freeze.hookEvent).toBe(CLAUDE_HOOK_EVENT);
    expect(freeze.matcher).toBe(CLAUDE_HOOK_MATCHER);
    expect(freeze.childCommand.slice(-2)).toEqual(["inject", "--hook-input"]);
    expect(freeze.childCommand).not.toContain("--budget");
    expect(freeze.childCommand).not.toContain("--trusted-author");
    expect(freeze.childCommand).not.toContain("--no-index");
    expect(freeze.defaultBudget).toBe(800);
    expect(freeze.trustedAuthors).toEqual(["owner@example.invalid"]);
    expect(freeze.noIndex).toBe(false);
  });

  it("makes ON and OFF differ only by the delivery hook", () => {
    const on = writeCdebArmConfig(repo, temp("on-config"), "on");
    const offRepo = createRepo();
    const off = writeCdebArmConfig(offRepo, temp("off-config"), "off");

    expect(on.mcpJson).toBe(off.mcpJson);
    expect(on.shipping).toEqual(off.shipping);
    expect(JSON.parse(off.settingsJson)).toEqual({ hooks: {} });
    expect(JSON.parse(on.settingsJson)).toEqual({
      hooks: {
        [CLAUDE_HOOK_EVENT]: [
          {
            matcher: CLAUDE_HOOK_MATCHER,
            hooks: [
              {
                type: "command",
                command: expect.stringContaining("shipping-proxy.ts"),
              },
            ],
          },
        ],
      },
    });
    expect(on.settingsJson).not.toContain("--budget");
    expect(on.settingsJson).not.toContain("--trusted-author");
    expect(on.settingsJson).not.toContain("--no-index");
  });

  it.each(["on", "off"] as const)("refuses an active capture hook in the %s arm", (arm) => {
    const config = writeCdebArmConfig(repo, temp(`${arm}-capture-config`), arm);
    const captureHook = join(repo, ".git", "hooks", "prepare-commit-msg");
    mkdirSync(join(repo, ".git", "hooks"), { recursive: true });
    writeFileSync(captureHook, "#!/bin/sh\nexit 0\n");
    chmodSync(captureHook, 0o755);

    expect(() => assertCaptureSurfaceAbsent(repo, config)).toThrowError(/prepare-commit-msg/);
  });
});

describe("CDEB proxy provenance", () => {
  it("hard-refuses a changed proxy or frozen parser", () => {
    const expected = shippingProxySha256(PROXY, PARSER);
    const changedProxy = join(temp("changed-proxy"), "shipping-proxy.ts");
    writeFileSync(changedProxy, `${readFileSync(PROXY, "utf8")}\n`);

    expect(() => assertFrozenShippingProxy(expected, changedProxy, PARSER)).toThrowError(/shipping proxy changed/);
  });

  it("has no benchmark context assembler on the ON path", () => {
    const onPathSources = [
      readFileSync(PROXY, "utf8"),
      readFileSync(PARSER, "utf8"),
      readFileSync(resolve("bench/cdeb/runtime/arm-settings.ts"), "utf8"),
    ];

    for (const source of onPathSources) {
      expect(source).not.toContain("assembleContext");
      expect(source).not.toContain("buildInjection");
    }
  });
});
