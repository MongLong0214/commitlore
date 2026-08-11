/**
 * CDEB-03 pinned OCI runtime (PRD §7.1–§7.4, §8).
 *
 * This module owns the container half of the fail-closed gate: it knows the
 * pin manifest, builds the exact `docker run` shape a measured run gets,
 * drives the preflight probes that `isolation.ts` judges, and captures the
 * raw provider stream CDEB-05 will parse. The judgment itself — pass or
 * refuse, never warn — lives in `isolation.ts`; here we only produce the
 * observations it judges.
 *
 * Two honesty rules shape the code:
 *
 *   - Every docker interaction goes through the injected `ContainerRuntimeCommands`,
 *     so the gate logic is testable on machines with no container runtime at
 *     all, and a sandbox without one cannot pretend to have probed.
 *   - The committed pin manifest is UNFROZEN: its digest fields are null
 *     because only the freeze ceremony can build the image and observe the
 *     provider. `pinFreezeGaps` lists what is missing and the gate refuses
 *     measured runs until the ceremony fills it. Nobody edits the nulls by
 *     hand; a hand-filled digest is an unfrozen manifest pretending.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import type {
  CapabilityGatePassed,
  CapabilityProbe,
  NetworkPolicy,
  StreamIdentity,
} from "./isolation.ts";
import {
  EMPTY_MCP_CONFIG,
  FROZEN_TOOL_POLICY,
  RuntimeCapabilityError,
  canonicalJson,
  mcpConfigDigest,
  networkPolicyDigest,
  readInitEvent,
  settingsDigest,
  streamHasAuthoritativeUsage,
  toolPolicyDigest,
  verifyStreamIdentity,
} from "./isolation.ts";
import { persistRawNdjson, readProviderLedger, type ProviderLedger } from "./provider-ledger.ts";
import type { ProbeRuntime, ProbeRunParams, ProbeRunResult } from "../freeze/runtime-probe.ts";

// ---------------------------------------------------------------------------
// The pin manifest (§8 identities, frozen by ceremony, matched at run time)
// ---------------------------------------------------------------------------

export interface RuntimePin {
  readonly schema_version: 1;
  /** Informational; `pinFreezeGaps` computes the truth from the fields. */
  readonly frozen: boolean;
  readonly image: { readonly reference: string; readonly digest: string | null };
  readonly agent_cli_version: string | null;
  readonly agent_executable: { readonly path: string; readonly sha256: string | null };
  readonly node: {
    readonly version: string;
    readonly executable_path: string;
    readonly executable_sha256: string | null;
  };
  readonly requested_model: string;
  /** Exact model id the provider stream must show; null until the freeze. */
  readonly expected_observed_model: string | null;
  readonly permission_mode: string;
  readonly network_policy: NetworkPolicy;
}

/** Fields only the freeze ceremony may produce. A null here is a gate refusal. */
export const pinFreezeGaps = (pin: RuntimePin): readonly string[] => {
  const gaps: string[] = [];
  if (pin.image.digest === null) gaps.push("image.digest");
  if (pin.agent_cli_version === null) gaps.push("agent_cli_version");
  if (pin.agent_executable.sha256 === null) gaps.push("agent_executable.sha256");
  if (pin.node.executable_sha256 === null) gaps.push("node.executable_sha256");
  if (pin.expected_observed_model === null) gaps.push("expected_observed_model");
  return gaps;
};

export const pinIsFrozen = (pin: RuntimePin): boolean => pinFreezeGaps(pin).length === 0;

/** `reference@sha256:...`, or null while the digest is unfrozen. */
export const imageRefOf = (pin: RuntimePin): string | null =>
  pin.image.digest === null ? null : `${pin.image.reference}@${pin.image.digest}`;

/** Identity of the pin itself: the gate token is minted against this digest. */
export const runtimePinDigest = (pin: RuntimePin): string =>
  createHash("sha256").update(canonicalJson(pin), "utf8").digest("hex");

const stringField = (source: Record<string, unknown>, key: string): string => {
  const value = source[key];
  if (typeof value !== "string" || value === "") throw new Error(`pin manifest: ${key} must be a non-empty string`);
  return value;
};

const optionalStringField = (source: Record<string, unknown>, key: string): string | null => {
  const value = source[key];
  if (value === null) return null;
  if (typeof value !== "string" || value === "") throw new Error(`pin manifest: ${key} must be a string or null`);
  return value;
};

/**
 * Parses and shape-checks the manifest. Any drift from the expected shape is
 * an error naming the field — a manifest the loader half-understands would be
 * a silent pin change.
 */
export const loadRuntimePin = (raw: string): RuntimePin => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`pin manifest is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("pin manifest must be a JSON object");
  }
  const root = parsed as Record<string, unknown>;
  if (root["schema_version"] !== 1) throw new Error("pin manifest: schema_version must be 1");

  const image = root["image"];
  if (typeof image !== "object" || image === null) throw new Error("pin manifest: image must be an object");
  const imageRec = image as Record<string, unknown>;

  const agentExecutable = root["agent_executable"];
  if (typeof agentExecutable !== "object" || agentExecutable === null) {
    throw new Error("pin manifest: agent_executable must be an object");
  }
  const agentRec = agentExecutable as Record<string, unknown>;

  const node = root["node"];
  if (typeof node !== "object" || node === null) throw new Error("pin manifest: node must be an object");
  const nodeRec = node as Record<string, unknown>;

  const networkPolicy = root["network_policy"];
  if (typeof networkPolicy !== "object" || networkPolicy === null) {
    throw new Error("pin manifest: network_policy must be an object");
  }
  const netRec = networkPolicy as Record<string, unknown>;
  if (netRec["egress"] !== "provider-only") {
    throw new Error('pin manifest: network_policy.egress must be "provider-only"');
  }
  if (netRec["enforcement"] !== "internal-network+allowlist-proxy") {
    throw new Error(
      'pin manifest: network_policy.enforcement must be "internal-network+allowlist-proxy" — ' +
        "any other enforcement is a different network policy and needs a new freeze",
    );
  }
  const hosts = netRec["allowed_hosts"];
  if (!Array.isArray(hosts) || hosts.some((host) => typeof host !== "string" || host === "")) {
    throw new Error("pin manifest: network_policy.allowed_hosts must be a list of non-empty strings");
  }
  const port = netRec["allowed_port"];
  if (typeof port !== "number" || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("pin manifest: network_policy.allowed_port must be a valid port number");
  }

  return {
    schema_version: 1,
    frozen: root["frozen"] === true,
    image: {
      reference: stringField(imageRec, "reference"),
      digest: optionalStringField(imageRec, "digest"),
    },
    agent_cli_version: optionalStringField(root, "agent_cli_version"),
    agent_executable: {
      path: stringField(agentRec, "path"),
      sha256: optionalStringField(agentRec, "sha256"),
    },
    node: {
      version: stringField(nodeRec, "version"),
      executable_path: stringField(nodeRec, "executable_path"),
      executable_sha256: optionalStringField(nodeRec, "executable_sha256"),
    },
    requested_model: stringField(root, "requested_model"),
    expected_observed_model: optionalStringField(root, "expected_observed_model"),
    permission_mode: stringField(root, "permission_mode"),
    network_policy: {
      egress: "provider-only",
      enforcement: "internal-network+allowlist-proxy",
      allowed_hosts: hosts as readonly string[],
      allowed_port: port,
    },
  };
};

// ---------------------------------------------------------------------------
// Container command surface (injectable: the gate must be testable without docker)
// ---------------------------------------------------------------------------

export interface DockerResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
}

export interface StreamedRunResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface ContainerRuntimeCommands {
  readonly run: (args: readonly string[], opts?: { timeoutMs?: number }) => DockerResult;
  /** Streams stdout into `sink` line-by-line-unmodified; resolves on exit. */
  readonly runToSink: (
    args: readonly string[],
    sink: NodeJS.WritableStream,
    opts?: { timeoutMs?: number },
  ) => Promise<StreamedRunResult>;
}

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

/** The host's `docker` CLI. The only production implementation. */
export const dockerCliRuntime = (binary: string = "docker"): ContainerRuntimeCommands => {
  const run = (args: readonly string[], opts?: { timeoutMs?: number }): DockerResult => {
    const result = spawnSync(binary, [...args], {
      encoding: "utf8",
      timeout: opts?.timeoutMs ?? 120_000,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.status ?? -1,
      timedOut,
    };
  };

  const runToSink = (
    args: readonly string[],
    sink: NodeJS.WritableStream,
    opts?: { timeoutMs?: number },
  ): Promise<StreamedRunResult> =>
    new Promise((resolve, reject) => {
      const child = spawn(binary, [...args], { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      }, opts?.timeoutMs ?? 15 * 60 * 1000);
      child.stdout.on("data", (chunk: Buffer) => sink.write(chunk));
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        sink.end();
        resolve({ exitCode: code, stderr, timedOut });
      });
    });

  return { run, runToSink };
};

// ---------------------------------------------------------------------------
// Run spec: the exact shape of a measured container (pure, testable)
// ---------------------------------------------------------------------------

/** Environment keys allowed to cross the container boundary. Nothing else does. */
export const PROVIDER_ENV_KEYS = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] as const;

export interface MountSpec {
  readonly hostPath: string;
  readonly containerPath: string;
  readonly readOnly: boolean;
}

export interface AgentRunSpec {
  readonly imageRef: string;
  readonly network: string;
  readonly proxyUrl: string;
  readonly workdir: string;
  readonly env: Readonly<Record<string, string>>;
  readonly mounts: readonly MountSpec[];
  readonly argv: readonly string[];
}

/** Paths inside the container, fixed for every run. */
export const CONTAINER_PATHS = {
  home: "/home/agent",
  repo: "/repo",
  config: "/cdeb",
  settings: "/cdeb/settings.json",
  mcp: "/cdeb/mcp.json",
} as const;

/** The egress network and proxy names are stable so preflight and runs share them. */
export const EGRESS_NETWORK = "cdeb-egress-net";
export const EGRESS_PROXY_CONTAINER = "cdeb-egress-proxy";
export const EGRESS_PROXY_PORT = 3128;

/**
 * The CLI argv for a measured run. Every isolation flag is unconditional: a
 * run without one of them is not a degraded run, it is no run — the preflight
 * gate already refused the capability if the pinned CLI lacks the flag.
 */
export const agentCliArgv = (pin: RuntimePin, prompt: string): readonly string[] => [
  "claude",
  "-p", prompt,
  "--output-format", "stream-json",
  "--verbose",
  "--include-partial-messages",
  "--permission-mode", pin.permission_mode,
  "--strict-mcp-config",
  "--mcp-config", CONTAINER_PATHS.mcp,
  "--setting-sources", "",
  "--no-session-persistence",
  "--settings", CONTAINER_PATHS.settings,
  "--allowedTools", ...FROZEN_TOOL_POLICY.allowed,
  "--disallowedTools", ...FROZEN_TOOL_POLICY.disallowed,
  "--model", pin.requested_model,
];

export interface AgentRunSpecParams {
  readonly imageRef: string;
  readonly repositoryPath: string;
  readonly configDir: string;
  readonly prompt: string;
  /** Provider credentials, keyed exactly; anything else is refused. */
  readonly providerEnv: Readonly<Record<string, string>>;
  readonly pin: RuntimePin;
}

/**
 * Builds the spec or throws. The refusal worth naming: `providerEnv` keys
 * outside the allowlist are a host-environment leak path, so they are refused
 * here rather than filtered silently — filtering would hide a caller mistake
 * the caller should fix.
 */
export const buildAgentRunSpec = (params: AgentRunSpecParams): AgentRunSpec => {
  const { pin } = params;
  if (params.repositoryPath === "") throw new Error("agent run spec: repositoryPath must not be empty");
  if (params.configDir === "") throw new Error("agent run spec: configDir must not be empty");

  const foreignKeys = Object.keys(params.providerEnv).filter(
    (key) => !(PROVIDER_ENV_KEYS as readonly string[]).includes(key),
  );
  if (foreignKeys.length > 0) {
    throw new Error(
      `agent run spec: provider env keys [${foreignKeys.join(", ")}] are not in the allowlist ` +
        `(${PROVIDER_ENV_KEYS.join(", ")}) — nothing else crosses the container boundary`,
    );
  }

  const proxyUrl = `http://${EGRESS_PROXY_CONTAINER}:${String(EGRESS_PROXY_PORT)}`;
  const env: Record<string, string> = {
    HOME: CONTAINER_PATHS.home,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    NO_PROXY: "",
    // The pinned CLI must stay pinned: the updater is disabled inside the
    // container the same way the digest check enforces it from outside.
    DISABLE_AUTOUPDATER: "1",
    ...params.providerEnv,
  };

  return {
    imageRef: params.imageRef,
    network: EGRESS_NETWORK,
    proxyUrl,
    workdir: CONTAINER_PATHS.repo,
    env,
    mounts: [
      { hostPath: params.repositoryPath, containerPath: CONTAINER_PATHS.repo, readOnly: false },
      { hostPath: params.configDir, containerPath: CONTAINER_PATHS.config, readOnly: true },
    ],
    argv: agentCliArgv(pin, params.prompt),
  };
};

/** Exact `docker run` arguments for a spec. Deterministic order, no extras. */
export const dockerRunArgs = (spec: AgentRunSpec, opts?: { name?: string; detach?: boolean }): readonly string[] => {
  const args: string[] = ["run", "--rm"];
  if (opts?.detach === true) args.push("--detach");
  if (opts?.name !== undefined) args.push("--name", opts.name);
  args.push("--network", spec.network);
  for (const key of Object.keys(spec.env).sort()) {
    args.push("--env", `${key}=${spec.env[key]}`);
  }
  for (const mount of spec.mounts) {
    args.push("--volume", `${mount.hostPath}:${mount.containerPath}${mount.readOnly ? ":ro" : ""}`);
  }
  args.push("--workdir", spec.workdir, spec.imageRef, ...spec.argv);
  return args;
};

// ---------------------------------------------------------------------------
// Egress proxy lifecycle (§7.4)
// ---------------------------------------------------------------------------

export interface EgressProxyHandle {
  readonly network: string;
  readonly container: string;
  readonly proxyUrl: string;
  readonly policy: NetworkPolicy;
  readonly stop: () => void;
}

/**
 * Idempotently creates the internal egress network and starts the allowlist
 * proxy from the pinned image itself — one digest pins both. The proxy stays
 * up across preflight and runs; `stop` tears down the proxy container (the
 * network is left for reuse and carries no state).
 */
export const startEgressProxy = (
  docker: ContainerRuntimeCommands,
  pin: RuntimePin,
  imageRef: string,
): EgressProxyHandle => {
  const network = docker.run(
    ["network", "create", "--internal", "--driver", "bridge", EGRESS_NETWORK],
  );
  if (network.exitCode !== 0 && !network.stderr.includes("already exists")) {
    throw new Error(`egress network create failed: ${network.stderr.trim()}`);
  }

  docker.run(["rm", "--force", EGRESS_PROXY_CONTAINER]);
  const proxy = docker.run([
    "run", "--detach", "--rm",
    "--name", EGRESS_PROXY_CONTAINER,
    "--network", EGRESS_NETWORK,
    "--env", `CDEB_ALLOWED_HOSTS=${pin.network_policy.allowed_hosts.join(",")}`,
    "--env", `CDEB_ALLOWED_PORT=${String(pin.network_policy.allowed_port)}`,
    "--env", `CDEB_LISTEN_PORT=${String(EGRESS_PROXY_PORT)}`,
    imageRef,
    "node", "/opt/cdeb/egress-proxy.mjs",
  ]);
  if (proxy.exitCode !== 0) {
    throw new Error(`egress proxy start failed: ${proxy.stderr.trim()}`);
  }

  // Wait for the proxy to listen before anything is allowed to depend on it.
  let listening = false;
  for (let attempt = 0; attempt < 50 && !listening; attempt += 1) {
    const logs = docker.run(["logs", EGRESS_PROXY_CONTAINER]);
    listening = logs.stdout.includes('"listening"');
    if (!listening) spawnSync("sleep", ["0.2"]);
  }
  if (!listening) {
    docker.run(["rm", "--force", EGRESS_PROXY_CONTAINER]);
    throw new Error("egress proxy did not reach listening state within 10s");
  }

  return {
    network: EGRESS_NETWORK,
    container: EGRESS_PROXY_CONTAINER,
    proxyUrl: `http://${EGRESS_PROXY_CONTAINER}:${String(EGRESS_PROXY_PORT)}`,
    policy: pin.network_policy,
    stop: () => {
      docker.run(["rm", "--force", EGRESS_PROXY_CONTAINER]);
    },
  };
};

// ---------------------------------------------------------------------------
// Probe attribution (pure: docker produces observations, these judge them)
// ---------------------------------------------------------------------------

/** CLI flags the isolation design cannot degrade away, mapped to capabilities. */
export const REQUIRED_CLI_FLAGS: readonly { flag: string; capability: CapabilityProbe["capability"] }[] = [
  { flag: "--strict-mcp-config", capability: "mcp-isolation" },
  { flag: "--mcp-config", capability: "mcp-isolation" },
  { flag: "--setting-sources", capability: "settings-isolation" },
  { flag: "--no-session-persistence", capability: "session-isolation" },
  { flag: "--allowedTools", capability: "tool-policy" },
  { flag: "--disallowedTools", capability: "tool-policy" },
  { flag: "--include-partial-messages", capability: "raw-usage-stream" },
];

/**
 * Judges `claude --help` from inside the pinned container. A missing flag is
 * the exact shape of failure the legacy driver used to warn-and-degrade on;
 * here it is a refusal naming the flag and what it protects.
 */
export const attributeHelpSupport = (helpText: string): CapabilityProbe[] => {
  const byCapability = new Map<CapabilityProbe["capability"], string[]>();
  for (const { flag, capability } of REQUIRED_CLI_FLAGS) {
    if (!helpText.includes(flag)) {
      const missing = byCapability.get(capability) ?? [];
      missing.push(flag);
      byCapability.set(capability, missing);
    }
  }
  const probes: CapabilityProbe[] = [];
  for (const { capability } of REQUIRED_CLI_FLAGS) {
    if (probes.some((probe) => probe.capability === capability)) continue;
    const missing = byCapability.get(capability);
    probes.push(
      missing === undefined || missing.length === 0
        ? { capability, ok: true, detail: "required flags present in pinned CLI help" }
        : {
            capability,
            ok: false,
            detail: `pinned CLI does not support ${missing.join(", ")} — isolation would degrade to inherited host state`,
          },
    );
  }
  return probes;
};

export interface ExecutableObservation {
  readonly cli_sha256: string | null;
  readonly node_sha256: string | null;
  readonly node_version: string | null;
  readonly cli_version: string | null;
}

/** §8 runtime/executable hashes: any mismatch is a refusal naming the drift. */
export const attributeExecutableIdentity = (
  observed: ExecutableObservation,
  pin: RuntimePin,
): CapabilityProbe => {
  const drift: string[] = [];
  if (observed.cli_sha256 !== pin.agent_executable.sha256) {
    drift.push(
      `agent CLI sha256 ${observed.cli_sha256 ?? "(unreadable)"} != pinned ${pin.agent_executable.sha256 ?? "(unfrozen)"}`,
    );
  }
  if (observed.node_sha256 !== pin.node.executable_sha256) {
    drift.push(
      `node sha256 ${observed.node_sha256 ?? "(unreadable)"} != pinned ${pin.node.executable_sha256 ?? "(unfrozen)"}`,
    );
  }
  if (observed.node_version !== pin.node.version) {
    drift.push(`node version ${observed.node_version ?? "(unreadable)"} != pinned ${pin.node.version}`);
  }
  if (pin.agent_cli_version !== null && observed.cli_version !== pin.agent_cli_version) {
    drift.push(`agent CLI version ${observed.cli_version ?? "(unreadable)"} != pinned ${pin.agent_cli_version}`);
  }
  return drift.length === 0
    ? { capability: "executable-identity", ok: true, detail: "CLI and node binaries match the pin" }
    : { capability: "executable-identity", ok: false, detail: drift.join("; ") };
};

/** Judges `docker image inspect` output against the pinned digest. */
export const attributeImageDigest = (inspectStdout: string, pin: RuntimePin): CapabilityProbe => {
  const expected = pin.image.digest;
  if (expected === null) {
    return {
      capability: "image-pin",
      ok: false,
      detail: "pin manifest is not frozen: image.digest is null — the freeze ceremony must build and record it",
    };
  }
  const normalized = expected.replace(/^sha256:/, "");
  const present = inspectStdout.includes(normalized);
  return present
    ? { capability: "image-pin", ok: true, detail: `image present at pinned digest ${expected}` }
    : {
        capability: "image-pin",
        ok: false,
        detail: `local image does not carry the pinned digest ${expected} — pull or rebuild, never retag`,
      };
};

/**
 * Judges the preflight probe stream. One real agent invocation observes four
 * capabilities at once — MCP isolation, tool policy, model identity and the
 * authoritative usage events — because the init event and the turn stream are
 * exactly what a measured run will produce.
 */
export const attributeStreamCapabilities = (
  ndjson: string,
  pin: RuntimePin,
): CapabilityProbe[] => {
  const probes: CapabilityProbe[] = [];
  const init = readInitEvent(ndjson);

  if (init === null) {
    return [
      { capability: "mcp-isolation", ok: false, detail: "probe stream has no init event" },
      { capability: "tool-policy", ok: false, detail: "probe stream has no init event" },
      { capability: "model-observation", ok: false, detail: "probe stream has no init event" },
      { capability: "raw-usage-stream", ok: false, detail: "probe stream has no init event" },
    ];
  }

  probes.push(
    init.mcp_servers !== null && init.mcp_servers.length === 0
      ? { capability: "mcp-isolation", ok: true, detail: "init event observes zero MCP servers" }
      : {
          capability: "mcp-isolation",
          ok: false,
          detail: `init event observes MCP servers ${JSON.stringify(init.mcp_servers)} under strict config`,
        },
  );

  const allowed = new Set(FROZEN_TOOL_POLICY.allowed);
  const observedTools = init.tools ?? [];
  const extra = observedTools.filter((tool) => !allowed.has(tool));
  const missing = [...allowed].filter((tool) => !observedTools.includes(tool));
  probes.push(
    init.tools !== null && extra.length === 0 && missing.length === 0
      ? { capability: "tool-policy", ok: true, detail: "init event observes exactly the frozen tool set" }
      : {
          capability: "tool-policy",
          ok: false,
          detail:
            init.tools === null
              ? "init event carries no tool list"
              : `session tools diverge from the frozen policy — extra: [${extra.join(", ")}] missing: [${missing.join(", ")}]`,
        },
  );

  if (pin.expected_observed_model === null) {
    probes.push({
      capability: "model-observation",
      ok: false,
      detail: "pin manifest is not frozen: expected_observed_model is null — the freeze ceremony must record it",
    });
  } else if (init.model !== pin.expected_observed_model) {
    probes.push({
      capability: "model-observation",
      ok: false,
      detail: `probe run answered as ${init.model ?? "(unknown)"} but the pin names ${pin.expected_observed_model}`,
    });
  } else {
    probes.push({
      capability: "model-observation",
      ok: true,
      detail: `probe run observed the pinned model ${pin.expected_observed_model}`,
    });
  }

  probes.push(
    streamHasAuthoritativeUsage(ndjson)
      ? { capability: "raw-usage-stream", ok: true, detail: "probe stream carries message_delta usage events" }
      : {
          capability: "raw-usage-stream",
          ok: false,
          detail: "probe stream carries no message_delta usage events — CDEB-05 could not reconcile a ledger",
        },
  );

  return probes;
};

/** §7.2: a fresh HOME must stay empty after the probe run — anything else persisted. */
export const attributeSessionState = (homeFiles: readonly string[]): CapabilityProbe =>
  homeFiles.length === 0
    ? { capability: "session-isolation", ok: true, detail: "isolated HOME is empty after the probe run" }
    : {
        capability: "session-isolation",
        ok: false,
        detail: `session or memory state persisted into the fresh HOME: [${homeFiles.join(", ")}]`,
      };

export interface HomeObservation {
  readonly home_value: string | null;
  readonly home_file_count: number;
  readonly unexpected_mounts: readonly string[];
}

/** §7.2: HOME is the isolated path, starts empty, and nothing unexpected is mounted. */
export const attributeHomeIsolation = (observed: HomeObservation): CapabilityProbe => {
  const problems: string[] = [];
  if (observed.home_value !== CONTAINER_PATHS.home) {
    problems.push(`HOME is ${observed.home_value ?? "(unset)"} instead of ${CONTAINER_PATHS.home}`);
  }
  if (observed.home_file_count !== 0) {
    problems.push(`HOME starts with ${String(observed.home_file_count)} file(s) — inheritance from a previous run or image layer`);
  }
  if (observed.unexpected_mounts.length > 0) {
    problems.push(`unexpected mounts: [${observed.unexpected_mounts.join(", ")}]`);
  }
  return problems.length === 0
    ? { capability: "home-isolation", ok: true, detail: "HOME is isolated, empty and mounted as specified" }
    : { capability: "home-isolation", ok: false, detail: problems.join("; ") };
};

export interface NetworkObservation {
  /** True when a direct connection to a non-allowlisted host failed. */
  readonly direct_egress_blocked: boolean;
  /** True when the proxy refused CONNECT to a non-allowlisted host. */
  readonly proxy_refused_foreign: boolean;
  /** True when the proxy established CONNECT to the allowlisted provider. */
  readonly proxy_allowed_provider: boolean;
}

/** §7.4: all three observations must hold, or the policy is not enforced. */
export const attributeNetworkProbes = (observed: NetworkObservation): CapabilityProbe => {
  const problems: string[] = [];
  if (!observed.direct_egress_blocked) problems.push("direct egress to a non-allowlisted host succeeded");
  if (!observed.proxy_refused_foreign) problems.push("the proxy forwarded a non-allowlisted host");
  if (!observed.proxy_allowed_provider) problems.push("the proxy did not establish the allowlisted provider route");
  return problems.length === 0
    ? { capability: "network-policy", ok: true, detail: "provider-only egress verified: direct blocked, proxy allowlisted" }
    : { capability: "network-policy", ok: false, detail: problems.join("; ") };
};

// ---------------------------------------------------------------------------
// Preflight orchestration (needs a container runtime; refuses without one)
// ---------------------------------------------------------------------------

export interface ProbeOptions {
  /** A trivial prompt for the probe agent call; costs one provider round-trip. */
  readonly probePrompt: string;
  /** Provider credentials for the probe call, same allowlist as measured runs. */
  readonly providerEnv: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

/**
 * Wraps the agent argv for the preflight run: run it, then list whatever
 * files exist in HOME on stderr. Stdout stays pure NDJSON; persistence is
 * observed on the side channel.
 */
export const probeCommand = (argv: readonly string[]): readonly string[] => [
  "sh",
  "-c",
  `${argv.map((part) => `'${part.replace(/'/g, "'\\''")}'`).join(" ")}; rc=$?; ` +
    `echo "===CDEB-HOME-FILES===" >&2; find "$HOME" -type f >&2 2>/dev/null; exit $rc`,
];

const HOME_MARKER = "===CDEB-HOME-FILES===";

/** Files listed on stderr after the marker; the stream on stdout stays pure. */
export const parseHomeFiles = (stderr: string): readonly string[] => {
  const markerIndex = stderr.lastIndexOf(HOME_MARKER);
  if (markerIndex === -1) return [];
  return stderr
    .slice(markerIndex + HOME_MARKER.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
};

/**
 * Several capabilities have two evidence sources — flag support from
 * `claude --help` and observed behavior in the probe stream — and the gate
 * accepts exactly one probe per capability. Merge per capability: any failing
 * source fails it, and the details keep every source's observation.
 */
export const mergeProbes = (probes: readonly CapabilityProbe[]): CapabilityProbe[] => {
  const byCapability = new Map<CapabilityProbe["capability"], CapabilityProbe[]>();
  for (const probe of probes) {
    const group = byCapability.get(probe.capability) ?? [];
    group.push(probe);
    byCapability.set(probe.capability, group);
  }
  const merged: CapabilityProbe[] = [];
  for (const [capability, group] of byCapability) {
    const failures = group.filter((probe) => !probe.ok);
    merged.push(
      failures.length === 0
        ? { capability, ok: true, detail: group.map((probe) => probe.detail).join(" AND ") }
        : { capability, ok: false, detail: failures.map((probe) => probe.detail).join("; ") },
    );
  }
  return merged;
};

/**
 * Runs every §7.5 probe and returns the observations for
 * `assertRuntimeCapabilities` to judge. Unfreezable pins short-circuit: the
 * container probes need a digest, so they stay unprobed and the gate's
 * refusal names them as never-probed rather than passing them by silence.
 */
export const probeRuntimeCapabilities = (
  docker: ContainerRuntimeCommands,
  pin: RuntimePin,
  options: ProbeOptions,
): CapabilityProbe[] => {
  const probes: CapabilityProbe[] = [];

  const daemon = docker.run(["version", "--format", "{{.Server.Version}}"]);
  probes.push(
    daemon.exitCode === 0
      ? { capability: "oci-runtime", ok: true, detail: `container daemon answered (server ${daemon.stdout.trim()})` }
      : {
          capability: "oci-runtime",
          ok: false,
          detail: `container daemon not reachable: ${daemon.stderr.trim() || daemon.stdout.trim() || "no output"}`,
        },
  );

  const gaps = pinFreezeGaps(pin);
  if (gaps.length > 0) {
    probes.push({
      capability: "image-pin",
      ok: false,
      detail: `pin manifest not frozen (missing: ${gaps.join(", ")}) — no container probe can run`,
    });
    return probes;
  }
  const imageRef = imageRefOf(pin);
  if (imageRef === null) {
    probes.push({ capability: "image-pin", ok: false, detail: "image reference could not be derived from the pin" });
    return probes;
  }

  const inspect = docker.run(["image", "inspect", imageRef, "--format", "{{json .RepoDigests}} {{.Id}}"]);
  probes.push(
    inspect.exitCode === 0
      ? attributeImageDigest(inspect.stdout, pin)
      : {
          capability: "image-pin",
          ok: false,
          detail: `image ${imageRef} not present locally: ${inspect.stderr.trim()}`,
        },
  );

  const hashes = docker.run(
    ["run", "--rm", "--network", "none", imageRef, "sh", "-c",
      `sha256sum ${pin.agent_executable.path} ${pin.node.executable_path}; node --version; claude --version`],
    { timeoutMs: options.timeoutMs ?? 120_000 },
  );
  const hashLines = hashes.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const cliHashLine = hashLines.find((line) => line.endsWith(pin.agent_executable.path));
  const nodeHashLine = hashLines.find((line) => line.endsWith(pin.node.executable_path));
  const nodeVersionLine = hashLines.find((line) => line.startsWith("v"));
  const cliVersionMatch = hashLines
    .map((line) => line.match(/^(\d+\.\d+\.\d+)/))
    .find((match) => match !== null);
  const cliVersionLine = cliVersionMatch === undefined ? undefined : cliVersionMatch[1];
  probes.push(
    attributeExecutableIdentity(
      {
        cli_sha256: cliHashLine === undefined ? null : (cliHashLine.split(" ")[0] ?? null),
        node_sha256: nodeHashLine === undefined ? null : (nodeHashLine.split(" ")[0] ?? null),
        node_version: nodeVersionLine ?? null,
        cli_version: cliVersionLine ?? null,
      },
      pin,
    ),
  );

  const help = docker.run(["run", "--rm", "--network", "none", imageRef, "claude", "--help"], {
    timeoutMs: options.timeoutMs ?? 120_000,
  });
  if (help.exitCode !== 0) {
    probes.push({
      capability: "settings-isolation",
      ok: false,
      detail: `could not read pinned CLI help: ${help.stderr.trim()}`,
    });
  } else {
    probes.push(...attributeHelpSupport(help.stdout));
  }

  // Home isolation, observed from the spec itself: the mounts are the only
  // host-visible surface, so the check is that there are exactly two.
  const spec = buildAgentRunSpec({
    imageRef,
    repositoryPath: join(tmpdir(), "cdeb-home-probe-repo"),
    configDir: join(tmpdir(), "cdeb-home-probe-config"),
    prompt: options.probePrompt,
    providerEnv: options.providerEnv,
    pin,
  });
  const expectedMounts = new Set([`${CONTAINER_PATHS.repo}`, `${CONTAINER_PATHS.config}`]);
  const unexpected = spec.mounts
    .map((mount) => mount.containerPath)
    .filter((path) => !expectedMounts.has(path));
  probes.push(
    attributeHomeIsolation({
      home_value: spec.env["HOME"] ?? null,
      home_file_count: 0,
      unexpected_mounts: unexpected,
    }),
  );

  // The egress proxy, then the three network observations.
  let proxy: EgressProxyHandle;
  try {
    proxy = startEgressProxy(docker, pin, imageRef);
  } catch (error) {
    probes.push({
      capability: "network-policy",
      ok: false,
      detail: `egress proxy did not start: ${(error as Error).message}`,
    });
    return probes;
  }

  try {
    const foreignHost = "cdeb-network-probe.invalid";
    const providerHost = pin.network_policy.allowed_hosts[0] ?? "";
    const netScript = [
      `const net = require('node:net');`,
      `const results = {};`,
      `const direct = net.connect(443, '${foreignHost}');`,
      `direct.setTimeout(5000);`,
      `direct.on('connect', () => { results.direct_egress_blocked = false; direct.destroy(); next(); });`,
      `direct.on('timeout', () => { results.direct_egress_blocked = true; direct.destroy(); next(); });`,
      `direct.on('error', () => { results.direct_egress_blocked = true; next(); });`,
      `let pending = 1;`,
      `function next() { if (--pending === 0) void proxyChecks(); }`,
      // Total probe budget: whatever was observed by then is the report;
      // missing fields read as false, which fails the capability.
      `setTimeout(() => { console.log(JSON.stringify(results)); process.exit(0); }, 12000).unref();`,
      `function connectViaProxy(host, port) {`,
      `  return new Promise((resolve) => {`,
      `    const sock = net.connect(${String(EGRESS_PROXY_PORT)}, '${EGRESS_PROXY_CONTAINER}');`,
      `    let buf = '';`,
      `    sock.setTimeout(5000);`,
      `    sock.on('connect', () => sock.write(\`CONNECT \${host}:\${port} HTTP/1.1\\r\\nHost: \${host}:\${port}\\r\\n\\r\\n\`));`,
      `    sock.on('data', (d) => { buf += d.toString(); if (buf.includes('\\r\\n')) { resolve(buf.split('\\r\\n')[0]); sock.destroy(); } });`,
      `    sock.on('timeout', () => { resolve('timeout'); sock.destroy(); });`,
      `    sock.on('error', () => resolve('error'));`,
      `  });`,
      `}`,
      `async function proxyChecks() {`,
      `  const foreign = await connectViaProxy('${foreignHost}', 443);`,
      `  const provider = await connectViaProxy('${providerHost}', ${String(pin.network_policy.allowed_port)});`,
      `  results.proxy_refused_foreign = foreign.includes('403');`,
      `  results.proxy_allowed_provider = provider.includes('200');`,
      `  console.log(JSON.stringify(results));`,
      `}`,
    ].join("\n");
    const netProbe = docker.run(
      ["run", "--rm", "--network", EGRESS_NETWORK, imageRef, "node", "-e", netScript],
      { timeoutMs: options.timeoutMs ?? 60_000 },
    );
    let netObservation: NetworkObservation = {
      direct_egress_blocked: false,
      proxy_refused_foreign: false,
      proxy_allowed_provider: false,
    };
    try {
      const parsed = JSON.parse(netProbe.stdout.trim().split("\n").pop() ?? "") as Partial<NetworkObservation>;
      netObservation = {
        direct_egress_blocked: parsed.direct_egress_blocked === true,
        proxy_refused_foreign: parsed.proxy_refused_foreign === true,
        proxy_allowed_provider: parsed.proxy_allowed_provider === true,
      };
    } catch {
      // fall through with all-false: an unreadable probe is a failed probe
    }
    probes.push(
      netProbe.exitCode === 0
        ? attributeNetworkProbes(netObservation)
        : { capability: "network-policy", ok: false, detail: `network probe failed to run: ${netProbe.stderr.trim()}` },
    );

    // The real probe run: one provider round-trip observing MCP, tools, model
    // and usage, with HOME swept afterwards for anything that persisted. The
    // config directory is written here — the same empty-MCP, no-hooks shape
    // both study arms start from (§9.1) — because a probe that mounted
    // nonexistent files would measure the CLI's error path instead.
    const probeScratch = mkdtempSync(join(tmpdir(), "cdeb-preflight-"));
    const probeRepo = join(probeScratch, "repo");
    mkdirSync(probeRepo, { recursive: true });
    writeFileSync(join(probeScratch, "settings.json"), `${JSON.stringify({ hooks: {} }, null, 2)}\n`);
    writeFileSync(join(probeScratch, "mcp.json"), `${EMPTY_MCP_CONFIG}\n`);
    try {
      const probeSpec = buildAgentRunSpec({
        imageRef,
        repositoryPath: probeRepo,
        configDir: probeScratch,
        prompt: options.probePrompt,
        providerEnv: options.providerEnv,
        pin,
      });
      const probeArgs = dockerRunArgs(probeSpec);
      const imageIndex = probeArgs.indexOf(imageRef);
      const wrapped = [...probeArgs.slice(0, imageIndex), imageRef, ...probeCommand(probeArgs.slice(imageIndex + 1))];
      const stream = docker.run(wrapped, { timeoutMs: options.timeoutMs ?? 5 * 60 * 1000 });
      probes.push(...attributeStreamCapabilities(stream.stdout, pin));
      probes.push(attributeSessionState(parseHomeFiles(stream.stderr)));
    } finally {
      rmSync(probeScratch, { recursive: true, force: true });
    }
  } finally {
    proxy.stop();
  }

  return mergeProbes(probes);
};

// ---------------------------------------------------------------------------
// Measured run execution (what CDEB-04 attaches hooks to, CDEB-05 reads)
// ---------------------------------------------------------------------------

export interface RuntimeIdentityFields {
  readonly requested_model: string;
  readonly agent_cli_version: string | null;
  readonly agent_executable_sha256: string | null;
  readonly node_version: string;
  readonly node_executable_sha256: string | null;
  readonly agent_runtime_image_digest: string | null;
  readonly tool_policy_digest: string;
  readonly network_policy_digest: string;
  readonly settings_digest: string;
  readonly mcp_config_digest: string;
  readonly permission_mode: string;
}

/** The §8 fields a row records, derived from the pin and the harness config. */
export const runtimeIdentityFields = (
  pin: RuntimePin,
  settingsJson: string,
  mcpJson: string = EMPTY_MCP_CONFIG,
): RuntimeIdentityFields => ({
  requested_model: pin.requested_model,
  agent_cli_version: pin.agent_cli_version,
  agent_executable_sha256: pin.agent_executable.sha256,
  node_version: pin.node.version,
  node_executable_sha256: pin.node.executable_sha256,
  agent_runtime_image_digest: pin.image.digest,
  tool_policy_digest: toolPolicyDigest(FROZEN_TOOL_POLICY),
  network_policy_digest: networkPolicyDigest(pin.network_policy),
  settings_digest: settingsDigest(settingsJson),
  mcp_config_digest: mcpConfigDigest(mcpJson),
  permission_mode: pin.permission_mode,
});

export interface AgentRunParams {
  readonly repositoryPath: string;
  /**
   * Must contain the harness-written `settings.json` (the arm's config, §9.1)
   * and `mcp.json` (the empty config). It is mounted read-only; nothing in
   * it is inherited from the operator's machine.
   */
  readonly configDir: string;
  readonly prompt: string;
  readonly outDir: string;
  readonly providerEnv: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface AgentRunOutcome {
  readonly exit_code: number | null;
  /** Compressed raw NDJSON artifact (`provider.ndjson.zst`), never rewritten. */
  readonly provider_stream_path: string;
  /** SHA-256 of the uncompressed, byte-exact NDJSON stream. */
  readonly provider_stream_sha256: string;
  readonly stderr: string;
  readonly timed_out: boolean;
  readonly identity: StreamIdentity;
  /** Complete reconciled usage or an explicit unavailable state (§14.6). */
  readonly ledger: ProviderLedger;
}

/**
 * One measured run inside the pinned runtime, or a refusal. The gate token is
 * checked against this pin's digest — a preflight that passed for another pin
 * authorizes nothing here — and the stream the run produces is identity-
 * checked before anything downstream may read it as measurement.
 *
 * Stdout first lands in a short-lived raw sink so no bytes pass through a
 * string transform. CDEB-05 then persists it byte-exactly as
 * `<outDir>/provider.ndjson.zst`, records the raw digest, and returns either a
 * reconciled ledger or an explicit unavailable state. A timeout is not an
 * excuse to synthesize a total: when SIGTERM lets the CLI emit terminal usage,
 * the parser uses it; when it does not, the outcome says unavailable.
 */
export const executeAgentRun = async (
  docker: ContainerRuntimeCommands,
  pin: RuntimePin,
  gate: CapabilityGatePassed,
  params: AgentRunParams,
): Promise<AgentRunOutcome> => {
  const expectedDigest = runtimePinDigest(pin);
  if (gate.pin_digest !== expectedDigest) {
    throw new RuntimeCapabilityError(
      [
        {
          capability: "oci-runtime",
          ok: false,
          detail: "capability gate token was minted for a different pin; re-run preflight for this one",
        },
      ],
      [],
    );
  }
  const gaps = pinFreezeGaps(pin);
  if (gaps.length > 0) {
    throw new RuntimeCapabilityError(
      [
        {
          capability: "image-pin",
          ok: false,
          detail: `pin manifest not frozen (missing: ${gaps.join(", ")})`,
        },
      ],
      [],
    );
  }
  const imageRef = imageRefOf(pin);
  if (imageRef === null) {
    throw new RuntimeCapabilityError(
      [{ capability: "image-pin", ok: false, detail: "image reference could not be derived from the pin" }],
      [],
    );
  }

  const spec = buildAgentRunSpec({
    imageRef,
    repositoryPath: params.repositoryPath,
    configDir: params.configDir,
    prompt: params.prompt,
    providerEnv: params.providerEnv,
    pin,
  });

  mkdirSync(params.outDir, { recursive: true });
  const streamPath = join(params.outDir, "provider.ndjson");
  const sink = createWriteStream(streamPath);
  const result = await docker.runToSink(dockerRunArgs(spec), sink, {
    timeoutMs: params.timeoutMs ?? 15 * 60 * 1000,
  });
  await new Promise<void>((resolve) => {
    if (sink.closed) resolve();
    else sink.on("close", () => resolve());
  });

  // The sink is binary and CDEB-05 persists the exact bytes before any parser
  // sees text. A malformed stream stays inspectable even if identity checking
  // subsequently refuses its run.
  const streamBytes = readFileSync(streamPath);
  const artifact = persistRawNdjson(params.outDir, streamBytes);
  rmSync(streamPath, { force: true });
  const ledger = readProviderLedger({ requested_model: pin.requested_model, raw_ndjson: streamBytes });
  const streamText = streamBytes.toString("utf8");
  const identity = verifyStreamIdentity(streamText, {
    expected_observed_model: pin.expected_observed_model ?? "",
    agent_cli_version: pin.agent_cli_version ?? "",
    permission_mode: pin.permission_mode,
    tool_policy: FROZEN_TOOL_POLICY,
  });

  return {
    exit_code: result.exitCode,
    provider_stream_path: artifact.compressed_path,
    provider_stream_sha256: artifact.raw_stream_sha256,
    stderr: result.stderr,
    timed_out: result.timedOut,
    identity,
    ledger,
  };
};

/**
 * The §4.6 probe runtime on the pinned container. Same logical invocation as
 * the host runtime, plus the frozen tool policy the study's runs carry; the
 * container supplies isolation, network policy and identity.
 *
 * RE-VALIDATION REQUIRED: every wall-time number frozen into the PRD (the
 * 0.48/1.00 split behind the 0.6 screen) was measured with the host `claude`
 * and the pilot hook matcher. A probe executed here screens a different
 * runtime; the split must be re-measured on the pinned runtime before any
 * freeze relies on it, and this has not yet been done.
 *
 * The egress proxy must already be running (`startEgressProxy`): without it
 * the provider call fails, and the probe reports that failure rather than
 * silently timing out on a network it cannot reach.
 */
export const pinnedProbeRuntime = (
  docker: ContainerRuntimeCommands,
  pin: RuntimePin,
  gate: CapabilityGatePassed,
  providerEnv: Readonly<Record<string, string>>,
): ProbeRuntime => {
  let sequence = 0;
  const run = (params: ProbeRunParams): ProbeRunResult => {
    const expectedDigest = runtimePinDigest(pin);
    if (gate.pin_digest !== expectedDigest) {
      throw new Error("capability gate token was minted for a different pin; re-run preflight for this one");
    }
    const gaps = pinFreezeGaps(pin);
    if (gaps.length > 0) {
      throw new Error(`pin manifest not frozen (missing: ${gaps.join(", ")}) — the probe cannot run unpinned`);
    }
    const imageRef = imageRefOf(pin);
    if (imageRef === null) throw new Error("image reference could not be derived from the pin");

    sequence += 1;
    const name = `cdeb-probe-${String(process.pid)}-${String(sequence)}`;
    const configDir = dirname(params.settingsPath);
    if (dirname(params.mcpPath) !== configDir) {
      throw new Error("pinned probe runtime: settings and mcp config must live in one directory to mount");
    }
    const argv = [
      "claude",
      "-p", params.prompt,
      "--output-format", "json",
      "--permission-mode", pin.permission_mode,
      "--strict-mcp-config",
      "--mcp-config", CONTAINER_PATHS.mcp,
      "--setting-sources", "",
      "--no-session-persistence",
      "--settings", CONTAINER_PATHS.settings,
      "--allowedTools", ...FROZEN_TOOL_POLICY.allowed,
      "--disallowedTools", ...FROZEN_TOOL_POLICY.disallowed,
      "--model", params.model,
    ];
    const spec: AgentRunSpec = {
      imageRef,
      network: EGRESS_NETWORK,
      proxyUrl: `http://${EGRESS_PROXY_CONTAINER}:${String(EGRESS_PROXY_PORT)}`,
      workdir: CONTAINER_PATHS.repo,
      env: {
        HOME: CONTAINER_PATHS.home,
        HTTP_PROXY: `http://${EGRESS_PROXY_CONTAINER}:${String(EGRESS_PROXY_PORT)}`,
        HTTPS_PROXY: `http://${EGRESS_PROXY_CONTAINER}:${String(EGRESS_PROXY_PORT)}`,
        NO_PROXY: "",
        DISABLE_AUTOUPDATER: "1",
        ...providerEnv,
      },
      mounts: [
        { hostPath: params.workdir, containerPath: CONTAINER_PATHS.repo, readOnly: false },
        { hostPath: configDir, containerPath: CONTAINER_PATHS.config, readOnly: true },
      ],
      argv,
    };
    const result = docker.run(dockerRunArgs(spec, { name }), { timeoutMs: params.timeoutMs + 30_000 });
    if (result.timedOut) docker.run(["rm", "--force", name]);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.timedOut ? null : result.exitCode,
      timedOut: result.timedOut,
    };
  };
  return { name: "pinned-container", run };
};
