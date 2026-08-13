/**
 * CDEB-03 acceptance (PRD §7.5, §8, §25.4): the three properties that decide
 * whether the pinned runtime is done, each tested through its FAILURE path —
 * a test that isolation works when everything is present proves nothing about
 * the degradation the gate exists to refuse.
 *
 *   1. A missing isolation capability hard fails, and the message names what
 *      is missing — including the capability that was never probed at all.
 *   2. A run that would inherit settings or memory from the host fails closed.
 *   3. A pinned model that does not match the model that answered stops the
 *      study (and so does a drifting CLI, or a subagent turn).
 *
 * Everything here runs without a container runtime: the gate judges data —
 * probe observations, streams, manifests — and the docker side of
 * `agent-container.ts` is an injected seam. What these tests therefore do NOT
 * prove is that a real docker daemon enforces what the spec builder asks of
 * it; that needs the pinned image and a machine the study may use, and it is
 * recorded as unverified rather than simulated.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

import { afterAll, describe, expect, it } from 'vitest';

import { hasZstd, zstdUnavailableMessage } from './cdeb-zstd.ts';

import {
  CAPABILITY_IDS,
  FROZEN_TOOL_POLICY,
  ModelDriftError,
  CliDriftError,
  ToolPolicyViolationError,
  RuntimeCapabilityError,
  assertRuntimeCapabilities,
  canonicalJson,
  mcpConfigDigest,
  networkPolicyDigest,
  readInitEvent,
  settingsDigest,
  streamHasAuthoritativeUsage,
  toolPolicyDigest,
  verifyStreamIdentity,
  type CapabilityId,
  type CapabilityProbe,
} from '../bench/cdeb/runtime/isolation.ts';
import { runProbe } from '../bench/cdeb/freeze/runtime-probe.ts';
import { readPersistedRawNdjson } from '../bench/cdeb/runtime/provider-ledger.ts';
// @ts-expect-error -- plain ESM module without type declarations
import { decideEgress, parseConnectTarget } from '../bench/cdeb/runtime/egress-proxy.mjs';
import {
  CONTAINER_PATHS,
  EGRESS_NETWORK,
  agentCliArgv,
  attributeExecutableIdentity,
  attributeHelpSupport,
  attributeHomeIsolation,
  attributeImageDigest,
  attributeNetworkProbes,
  attributeSessionState,
  attributeStreamCapabilities,
  buildAgentRunSpec,
  probeRuntimeCapabilities,
  probeCommand,
  dockerRunArgs,
  executeAgentRun,
  loadRuntimePin,
  parseHomeFiles,
  pinFreezeGaps,
  pinIsFrozen,
  runtimeIdentityFields,
  runtimePinDigest,
  type ContainerRuntimeCommands,
  type RuntimePin,
} from '../bench/cdeb/runtime/agent-container.ts';

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
const temp = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `cdeb-iso-${label}-`));
  scratch.push(dir);
  return dir;
};

// ---------------------------------------------------------------------------
// Synthetic streams in the committed fixture shape (claude-stream/*.jsonl)
// ---------------------------------------------------------------------------

const PIN_MODEL = 'claude-test-1-20260101';
const CLI_VERSION = '2.1.227';

const initEvent = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'system',
    subtype: 'init',
    tools: [...FROZEN_TOOL_POLICY.allowed],
    mcp_servers: [],
    model: PIN_MODEL,
    permissionMode: 'acceptEdits',
    claude_code_version: CLI_VERSION,
    ...overrides,
  });

let messageSequence = 0;
const turnEvents = (model: string, parentToolUseId: string | null = null): string => {
  messageSequence += 1;
  const start = JSON.stringify({
    type: 'stream_event',
    parent_tool_use_id: parentToolUseId,
    event: { type: 'message_start', message: { id: `msg-${String(messageSequence)}`, model } },
  });
  const delta = JSON.stringify({
    type: 'stream_event',
    parent_tool_use_id: parentToolUseId,
    event: {
      type: 'message_delta',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens_details: { thinking_tokens: 0 },
      },
      delta: { stop_reason: 'end_turn' },
    },
  });
  return `${start}\n${delta}`;
};

const resultEvent = (): string =>
  JSON.stringify({
    type: 'result',
    num_turns: 1,
    is_error: false,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });

const validStream = (): string =>
  [initEvent(), turnEvents(PIN_MODEL), resultEvent()].join('\n');

const STREAM_PIN = {
  expected_observed_model: PIN_MODEL,
  agent_cli_version: CLI_VERSION,
  permission_mode: 'acceptEdits',
  tool_policy: FROZEN_TOOL_POLICY,
};

const greenProbe = (capability: CapabilityId): CapabilityProbe => ({
  capability,
  ok: true,
  detail: `synthetic pass: ${capability}`,
});
const greenReport = (): CapabilityProbe[] => CAPABILITY_IDS.map(greenProbe);

const UNFROZEN_PIN: RuntimePin = {
  schema_version: 1,
  frozen: false,
  image: { reference: 'commitlore/cdeb-agent', digest: null },
  agent_cli_version: null,
  agent_executable: { path: '/usr/local/bin/claude', sha256: null },
  node: { version: 'v22.23.2', executable_path: '/usr/local/bin/node', executable_sha256: null },
  requested_model: 'sonnet',
  expected_observed_model: null,
  permission_mode: 'acceptEdits',
  network_policy: {
    egress: 'provider-only',
    enforcement: 'internal-network+allowlist-proxy',
    allowed_hosts: ['api.provider.example'],
    allowed_port: 443,
  },
};

const FROZEN_PIN: RuntimePin = {
  ...UNFROZEN_PIN,
  frozen: true,
  image: { reference: 'commitlore/cdeb-agent', digest: 'sha256:' + 'ab'.repeat(32) },
  agent_cli_version: CLI_VERSION,
  agent_executable: { path: '/usr/local/bin/claude', sha256: 'cd'.repeat(32) },
  node: { version: 'v22.23.2', executable_path: '/usr/local/bin/node', executable_sha256: 'ef'.repeat(32) },
  expected_observed_model: PIN_MODEL,
};

// ---------------------------------------------------------------------------
// 1. Missing isolation capability hard fails, naming what is missing
// ---------------------------------------------------------------------------

describe('§7.5 capability gate: missing capability hard fails', () => {
  it('passes only when every capability is probed and green', () => {
    const token = assertRuntimeCapabilities(greenReport(), 'pin-digest');
    expect(token.gate).toBe('cdeb-runtime-capabilities');
    expect(token.pin_digest).toBe('pin-digest');
    expect([...token.verified].sort()).toEqual([...CAPABILITY_IDS].sort());
  });

  it('refuses a failed probe and names the capability and what is missing', () => {
    const probes = greenReport().map((probe) =>
      probe.capability === 'mcp-isolation'
        ? {
            capability: probe.capability,
            ok: false,
            detail: 'pinned CLI does not support --strict-mcp-config — isolation would degrade to inherited host state',
          }
        : probe,
    );
    expect(() => assertRuntimeCapabilities(probes, 'pin-digest')).toThrowError(RuntimeCapabilityError);
    try {
      assertRuntimeCapabilities(probes, 'pin-digest');
    } catch (error) {
      const capabilityError = error as RuntimeCapabilityError;
      expect(capabilityError.failed).toEqual(['mcp-isolation']);
      expect(capabilityError.message).toContain('mcp-isolation');
      expect(capabilityError.message).toContain('--strict-mcp-config');
    }
  });

  it('refuses a capability that was never probed — absence of evidence is not a pass', () => {
    const probes = greenReport().filter((probe) => probe.capability !== 'network-policy');
    try {
      assertRuntimeCapabilities(probes, 'pin-digest');
      expect.unreachable('the gate must refuse an incomplete report');
    } catch (error) {
      const capabilityError = error as RuntimeCapabilityError;
      expect(capabilityError.untested).toEqual(['network-policy']);
      expect(capabilityError.message).toContain('network-policy');
      expect(capabilityError.message).toContain('never probed');
    }
  });

  it('refuses a malformed report that probes one capability twice', () => {
    const probes = [...greenReport(), greenProbe('tool-policy')];
    expect(() => assertRuntimeCapabilities(probes, 'pin-digest')).toThrowError(/more than once/);
  });

  it('has no warning state: the only outcomes are a token or a throw', () => {
    // Compile-time shape check: a "degraded pass" has no representation.
    const token: ReturnType<typeof assertRuntimeCapabilities> = assertRuntimeCapabilities(
      greenReport(),
      'digest',
    );
    expect(Object.keys(token).sort()).toEqual(['gate', 'pin_digest', 'verified']);
  });
});

describe('§7.5 capability attribution names the missing piece', () => {
  it('help without isolation flags fails the capabilities those flags protect', () => {
    const probes = attributeHelpSupport('--model <model>  --output-format <format>');
    const settings = probes.find((probe) => probe.capability === 'settings-isolation');
    const session = probes.find((probe) => probe.capability === 'session-isolation');
    const mcp = probes.find((probe) => probe.capability === 'mcp-isolation');
    expect(settings?.ok).toBe(false);
    expect(settings?.detail).toContain('--setting-sources');
    expect(session?.ok).toBe(false);
    expect(session?.detail).toContain('--no-session-persistence');
    expect(mcp?.ok).toBe(false);
    expect(mcp?.detail).toContain('--strict-mcp-config');
  });

  it('help carrying every required flag passes every flag-backed capability', () => {
    const help = [
      '--strict-mcp-config',
      '--mcp-config <configs...>',
      '--setting-sources <sources>',
      '--no-session-persistence',
      '--allowedTools, --allowed-tools <tools...>',
      '--disallowedTools, --disallowed-tools <tools...>',
      '--include-partial-messages',
    ].join('\n');
    const probes = attributeHelpSupport(help);
    expect(probes.every((probe) => probe.ok)).toBe(true);
  });

  it('an image whose digest does not match the pin is refused, never retagged', () => {
    const probe = attributeImageDigest('["repo@sha256:deadbeef"]', FROZEN_PIN);
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain(FROZEN_PIN.image.digest ?? '');
    expect(probe.detail).toContain('never retag');
  });

  it('executable drift against the pin is refused naming each drifted field', () => {
    const probe = attributeExecutableIdentity(
      {
        cli_sha256: 'different'.repeat(4),
        node_sha256: FROZEN_PIN.node.executable_sha256,
        node_version: FROZEN_PIN.node.version,
        cli_version: '9.9.9',
      },
      FROZEN_PIN,
    );
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain('agent CLI sha256');
    expect(probe.detail).toContain('agent CLI version');
  });

  it('an unfrozen pin cannot pass the image-pin capability', () => {
    const probe = attributeImageDigest('anything', UNFROZEN_PIN);
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain('not frozen');
  });
});

// ---------------------------------------------------------------------------
// 2. Inherited settings or memory fails closed
// ---------------------------------------------------------------------------

describe('§7.2 inheritance fails closed', () => {
  it('a run spec mounts exactly the repository and the harness config — never a host HOME', () => {
    const spec = buildAgentRunSpec({
      imageRef: 'commitlore/cdeb-agent@sha256:ab',
      repositoryPath: '/host/repo',
      configDir: '/host/cdeb-config',
      prompt: 'a task',
      providerEnv: { ANTHROPIC_API_KEY: 'test-key' },
      pin: FROZEN_PIN,
    });
    expect(spec.env['HOME']).toBe(CONTAINER_PATHS.home);
    expect(spec.mounts).toEqual([
      { hostPath: '/host/repo', containerPath: '/repo', readOnly: false },
      { hostPath: '/host/cdeb-config', containerPath: '/cdeb', readOnly: true },
    ]);
    const args = dockerRunArgs(spec);
    const volumes = args.filter((arg, index) => args[index - 1] === '--volume');
    expect(volumes).toHaveLength(2);
    expect(volumes.some((volume) => volume.includes(':ro'))).toBe(true);
    // Every isolation flag is unconditional in the argv.
    expect(spec.argv).toContain('--strict-mcp-config');
    expect(spec.argv).toContain('--no-session-persistence');
    expect(spec.argv).toContain('--setting-sources');
    expect(spec.argv[spec.argv.indexOf('--setting-sources') + 1]).toBe('');
    // The only egress is the allowlist proxy.
    expect(spec.env['HTTPS_PROXY']).toContain('cdeb-egress-proxy');
    expect(spec.network).toBe(EGRESS_NETWORK);
  });

  it('refuses provider env keys outside the allowlist — a host environment leak path', () => {
    expect(() =>
      buildAgentRunSpec({
        imageRef: 'commitlore/cdeb-agent@sha256:ab',
        repositoryPath: '/host/repo',
        configDir: '/host/cdeb-config',
        prompt: 'a task',
        providerEnv: { ANTHROPIC_API_KEY: 'k', PATH: '/usr/bin' },
        pin: FROZEN_PIN,
      }),
    ).toThrowError(/PATH.*not in the allowlist/);
  });

  it('a HOME that starts non-empty is inheritance, and the gate names it', () => {
    const probe = attributeHomeIsolation({
      home_value: CONTAINER_PATHS.home,
      home_file_count: 3,
      unexpected_mounts: [],
    });
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain('inheritance');
  });

  it('a mount outside the expected pair is refused naming the mount', () => {
    const probe = attributeHomeIsolation({
      home_value: CONTAINER_PATHS.home,
      home_file_count: 0,
      unexpected_mounts: ['/root/.claude'],
    });
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain('/root/.claude');
  });

  it('a wrong HOME value is refused', () => {
    const probe = attributeHomeIsolation({
      home_value: '/root',
      home_file_count: 0,
      unexpected_mounts: [],
    });
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain('/root');
  });

  it('session or memory state that survives the run fails session-isolation', () => {
    const probe = attributeSessionState(['/home/agent/.claude/projects/session.jsonl']);
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain('session.jsonl');
    expect(attributeSessionState([]).ok).toBe(true);
  });

  it('parses the HOME sweep marker from probe stderr', () => {
    const stderr = `noise\n===CDEB-HOME-FILES===\n/home/agent/.claude/memory.md\n\n`;
    expect(parseHomeFiles(stderr)).toEqual(['/home/agent/.claude/memory.md']);
    expect(parseHomeFiles('no marker here')).toEqual([]);
  });

  it('a stream whose init shows MCP servers under strict config fails closed', () => {
    const stream = [
      initEvent({ mcp_servers: [{ name: 'memory-server' }] }),
      turnEvents(PIN_MODEL),
      resultEvent(),
    ].join('\n');
    const probes = attributeStreamCapabilities(stream, FROZEN_PIN);
    const mcp = probes.find((probe) => probe.capability === 'mcp-isolation');
    expect(mcp?.ok).toBe(false);
    expect(mcp?.detail).toContain('memory-server');
  });
});

// ---------------------------------------------------------------------------
// 3. Model or CLI drift stops the study
// ---------------------------------------------------------------------------

describe('§8 model and CLI drift are hard stops', () => {
  it('accepts a stream where every main-session turn carries the pinned model', () => {
    const identity = verifyStreamIdentity(validStream(), STREAM_PIN);
    expect(identity.observed_model_ids).toEqual([PIN_MODEL]);
    expect(identity.agent_cli_version).toBe(CLI_VERSION);
    expect(identity.turn_count).toBe(1);
  });

  it('stops the study when a turn is answered by another model, naming both', () => {
    const drifted = [
      initEvent(),
      turnEvents(PIN_MODEL),
      turnEvents('claude-other-9-20290101'),
      resultEvent(),
    ].join('\n');
    try {
      verifyStreamIdentity(drifted, STREAM_PIN);
      expect.unreachable('drift must stop the study');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelDriftError);
      expect((error as Error).message).toContain('claude-other-9-20290101');
      expect((error as Error).message).toContain(PIN_MODEL);
    }
  });

  it('stops the study on an empty model id', () => {
    const empty = [initEvent(), turnEvents(''), resultEvent()].join('\n');
    expect(() => verifyStreamIdentity(empty, STREAM_PIN)).toThrowError(/empty model id/);
  });

  it('rejects a subagent turn — delegation is forbidden, not averaged in', () => {
    const delegated = [
      initEvent(),
      turnEvents(PIN_MODEL),
      turnEvents(PIN_MODEL, 'toolu_subagent_parent'),
      resultEvent(),
    ].join('\n');
    expect(() => verifyStreamIdentity(delegated, STREAM_PIN)).toThrowError(/subagent/);
  });

  it('stops the study when the CLI that ran is not the CLI that was pinned', () => {
    const drifted = [initEvent({ claude_code_version: '9.9.9' }), turnEvents(PIN_MODEL), resultEvent()].join('\n');
    expect(() => verifyStreamIdentity(drifted, STREAM_PIN)).toThrowError(CliDriftError);
  });

  it('stops the study when the init model is not the pinned model', () => {
    const drifted = [initEvent({ model: 'claude-other-9-20290101' }), turnEvents(PIN_MODEL), resultEvent()].join('\n');
    expect(() => verifyStreamIdentity(drifted, STREAM_PIN)).toThrowError(ModelDriftError);
  });

  it('refuses a session whose tool set diverges from the frozen policy', () => {
    const drifted = [
      initEvent({ tools: [...FROZEN_TOOL_POLICY.allowed, 'WebSearch'] }),
      turnEvents(PIN_MODEL),
      resultEvent(),
    ].join('\n');
    try {
      verifyStreamIdentity(drifted, STREAM_PIN);
      expect.unreachable('tool divergence must be a hard stop');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolPolicyViolationError);
      expect((error as Error).message).toContain('WebSearch');
    }
  });

  it('refuses a stream with no init event — the session cannot be identified', () => {
    const noInit = [turnEvents(PIN_MODEL), resultEvent()].join('\n');
    expect(() => verifyStreamIdentity(noInit, STREAM_PIN)).toThrowError(/no init event/);
  });

  it('preflight attribution turns model drift into a failed capability probe', () => {
    const drifted = [
      initEvent({ model: 'claude-other-9-20290101' }),
      turnEvents(PIN_MODEL),
      resultEvent(),
    ].join('\n');
    const probes = attributeStreamCapabilities(drifted, FROZEN_PIN);
    const model = probes.find((probe) => probe.capability === 'model-observation');
    expect(model?.ok).toBe(false);
    expect(model?.detail).toContain('claude-other-9-20290101');
  });

  it('an unfrozen expected model fails the capability rather than passing silently', () => {
    const probes = attributeStreamCapabilities(validStream(), UNFROZEN_PIN);
    const model = probes.find((probe) => probe.capability === 'model-observation');
    expect(model?.ok).toBe(false);
    expect(model?.detail).toContain('not frozen');
  });

  it('reads the committed fixture streams: partial messages carry authoritative usage, assistant-only does not', () => {
    const partial = readFileSync('test/fixtures/claude-stream/partial-messages.jsonl', 'utf8');
    const assistantOnly = readFileSync('test/fixtures/claude-stream/assistant-only.jsonl', 'utf8');
    expect(streamHasAuthoritativeUsage(partial)).toBe(true);
    expect(streamHasAuthoritativeUsage(assistantOnly)).toBe(false);
    expect(readInitEvent(partial)?.model).toBe('claude-haiku-4-5-20251001');
  });
});

// ---------------------------------------------------------------------------
// Pin manifest, digests, and the gate token
// ---------------------------------------------------------------------------

describe('pin manifest and gate token', () => {
  it('loads the committed manifest and reports it unfrozen with named gaps', () => {
    const raw = readFileSync('bench/cdeb/runtime/runtime-pin.json', 'utf8');
    const pin = loadRuntimePin(raw);
    expect(pinIsFrozen(pin)).toBe(false);
    expect(pinFreezeGaps(pin).sort()).toEqual([
      'agent_cli_version',
      'agent_executable.sha256',
      'expected_observed_model',
      'image.digest',
      'node.executable_sha256',
    ]);
  });

  it('refuses a manifest whose enforcement is not the frozen one', () => {
    const raw = readFileSync('bench/cdeb/runtime/runtime-pin.json', 'utf8');
    const mutated = raw.replace('internal-network+allowlist-proxy', 'vibes');
    expect(() => loadRuntimePin(mutated)).toThrowError(/enforcement/);
  });

  it('refuses a manifest with a malformed allowed_hosts', () => {
    const raw = readFileSync('bench/cdeb/runtime/runtime-pin.json', 'utf8');
    const mutated = raw.replace('"api.anthropic.com", "console.anthropic.com"', '"api.anthropic.com", ""');
    expect(() => loadRuntimePin(mutated)).toThrowError(/allowed_hosts/);
  });

  it('digests are deterministic and sensitive to the policy content', () => {
    expect(toolPolicyDigest(FROZEN_TOOL_POLICY)).toBe(toolPolicyDigest(FROZEN_TOOL_POLICY));
    expect(toolPolicyDigest({ allowed: ['Bash'], disallowed: [] })).not.toBe(toolPolicyDigest(FROZEN_TOOL_POLICY));
    expect(settingsDigest('{"hooks":{}}')).toBe(settingsDigest('{"hooks":{}}'));
    expect(settingsDigest('{"hooks":{}}')).not.toBe(settingsDigest('{"hooks":{"evil":true}}'));
    expect(mcpConfigDigest('{"mcpServers":{}}')).not.toBe(mcpConfigDigest('{"mcpServers":{"x":{}}}'));
    const policy = FROZEN_PIN.network_policy;
    expect(networkPolicyDigest(policy)).toBe(networkPolicyDigest({ ...policy }));
    expect(networkPolicyDigest(policy)).not.toBe(
      networkPolicyDigest({ ...policy, allowed_hosts: ['other.example'] }),
    );
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(runtimePinDigest(FROZEN_PIN)).toBe(runtimePinDigest(FROZEN_PIN));
    expect(runtimePinDigest(FROZEN_PIN)).not.toBe(runtimePinDigest(UNFROZEN_PIN));
  });

  it('the frozen tool policy keeps web, delegation and memory surfaces out', () => {
    for (const forbidden of ['WebSearch', 'WebFetch', 'Task', 'Skill', 'Monitor']) {
      expect(FROZEN_TOOL_POLICY.allowed).not.toContain(forbidden);
      expect(FROZEN_TOOL_POLICY.disallowed).toContain(forbidden);
    }
  });

  it('identity fields for the row come from the pin and the harness config', () => {
    const fields = runtimeIdentityFields(FROZEN_PIN, '{"hooks":{}}');
    expect(fields.agent_runtime_image_digest).toBe(FROZEN_PIN.image.digest);
    expect(fields.agent_executable_sha256).toBe(FROZEN_PIN.agent_executable.sha256);
    expect(fields.tool_policy_digest).toBe(toolPolicyDigest(FROZEN_TOOL_POLICY));
    expect(fields.network_policy_digest).toBe(networkPolicyDigest(FROZEN_PIN.network_policy));
    expect(fields.settings_digest).toBe(settingsDigest('{"hooks":{}}'));
    expect(fields.requested_model).toBe('sonnet');
  });

  const refusingDocker: ContainerRuntimeCommands = {
    run: () => {
      throw new Error('docker must not be reached once the gate refuses');
    },
    runToSink: async () => {
      throw new Error('docker must not be reached once the gate refuses');
    },
  };

  it('executeAgentRun refuses a gate token minted for a different pin, before any container work', async () => {
    const token = assertRuntimeCapabilities(greenReport(), 'some-other-pin-digest');
    await expect(
      executeAgentRun(refusingDocker, FROZEN_PIN, token, {
        repositoryPath: '/host/repo',
        configDir: '/host/config',
        prompt: 'task',
        outDir: temp('run'),
        providerEnv: {},
      }),
    ).rejects.toThrowError(/different pin/);
  });

  it('executeAgentRun refuses an unfrozen pin even with a matching token', async () => {
    const token = assertRuntimeCapabilities(greenReport(), runtimePinDigest(UNFROZEN_PIN));
    await expect(
      executeAgentRun(refusingDocker, UNFROZEN_PIN, token, {
        repositoryPath: '/host/repo',
        configDir: '/host/config',
        prompt: 'task',
        outDir: temp('run'),
        providerEnv: {},
      }),
    ).rejects.toThrowError(/not frozen/);
  });

  it.skipIf(!hasZstd)(
    hasZstd
      ? 'executeAgentRun captures the raw stream byte-for-byte, persists it, and identity-checks it'
      : `executeAgentRun captures the raw stream byte-for-byte, persists it, and identity-checks it — ${zstdUnavailableMessage}`,
    async () => {
    const stream = validStream();
    const firstTurns: string[] = [];
    const streamingDocker: ContainerRuntimeCommands = {
      run: () => ({ stdout: '', stderr: '', exitCode: 0, timedOut: false }),
      runToSink: async (_args, sink) => {
        // Deliberately split a NDJSON event across chunks: CDEB-07's durable
        // non-rerun marker must observe lines, not assume chunk boundaries.
        sink.write(stream.slice(0, 37));
        sink.write(stream.slice(37));
        sink.end();
        return { exitCode: 0, stderr: '', timedOut: false };
      },
    };
    const outDir = temp('run-ok');
    const token = assertRuntimeCapabilities(greenReport(), runtimePinDigest(FROZEN_PIN));
    const outcome = await executeAgentRun(streamingDocker, FROZEN_PIN, token, {
      repositoryPath: '/host/repo',
      configDir: '/host/config',
      prompt: 'task',
      outDir,
      providerEnv: {},
      onFirstModelTurn: () => firstTurns.push('observed-before-stream-completes'),
    });
    const captured = readPersistedRawNdjson(outDir).toString('utf8');
    expect(captured).toBe(stream);
    expect(outcome.identity.observed_model_ids).toEqual([PIN_MODEL]);
    expect(outcome.ledger.usage.availability).toBe('measured');
    expect(outcome.exit_code).toBe(0);
    expect(outcome.provider_stream_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(firstTurns).toEqual(['observed-before-stream-completes']);
  });

  it.skipIf(!hasZstd)(
    hasZstd
      ? 'executeAgentRun turns mid-run model drift into a hard stop after capture'
      : `executeAgentRun turns mid-run model drift into a hard stop after capture — ${zstdUnavailableMessage}`,
    async () => {
    const drifted = [initEvent(), turnEvents('claude-other-9-20290101'), resultEvent()].join('\n');
    const streamingDocker: ContainerRuntimeCommands = {
      run: () => ({ stdout: '', stderr: '', exitCode: 0, timedOut: false }),
      runToSink: async (_args, sink) => {
        sink.write(drifted);
        sink.end();
        return { exitCode: 0, stderr: '', timedOut: false };
      },
    };
    const token = assertRuntimeCapabilities(greenReport(), runtimePinDigest(FROZEN_PIN));
    await expect(
      executeAgentRun(streamingDocker, FROZEN_PIN, token, {
        repositoryPath: '/host/repo',
        configDir: '/host/config',
        prompt: 'task',
        outDir: temp('run-drift'),
        providerEnv: {},
      }),
    ).rejects.toThrowError(ModelDriftError);
  });

  it('the agent argv carries the frozen tool policy, verbatim', () => {
    const argv = agentCliArgv(FROZEN_PIN, 'do the task');
    const allowed = argv.slice(argv.indexOf('--allowedTools') + 1, argv.indexOf('--disallowedTools'));
    expect(allowed).toEqual([...FROZEN_TOOL_POLICY.allowed]);
    const disallowedStart = argv.indexOf('--disallowedTools') + 1;
    const disallowedEnd = argv.indexOf('--model');
    expect(argv.slice(disallowedStart, disallowedEnd)).toEqual([...FROZEN_TOOL_POLICY.disallowed]);
  });
});

// ---------------------------------------------------------------------------
// Probe orchestration against a fake container runtime: the docker side is
// scripted, the attribution and wiring are real.
// ---------------------------------------------------------------------------

describe('probe orchestration on a scripted container runtime', () => {
  const cliSha = FROZEN_PIN.agent_executable.sha256 ?? '';
  const nodeSha = FROZEN_PIN.node.executable_sha256 ?? '';

  const scriptedDocker = (netResult: string, probeStdout: string, probeStderr: string) => {
    const calls: string[][] = [];
    const runtime: ContainerRuntimeCommands = {
      run: (args) => {
        calls.push([...args]);
        const first = args.slice(0, 2).join(' ');
        if (first === 'version --format') return { stdout: '27.0.0\n', stderr: '', exitCode: 0, timedOut: false };
        if (args[0] === 'image' && args[1] === 'inspect') {
          return { stdout: `["x@${FROZEN_PIN.image.digest}"] sha256:abc`, stderr: '', exitCode: 0, timedOut: false };
        }
        if (args.some((arg) => arg.includes('sha256sum'))) {
          return {
            stdout: `${cliSha}  /usr/local/bin/claude\n${nodeSha}  /usr/local/bin/node\nv22.23.2\n2.1.227 (Claude Code)\n`,
            stderr: '',
            exitCode: 0,
            timedOut: false,
          };
        }
        if (args.some((arg) => arg === '--help')) {
          return {
            stdout: '--strict-mcp-config\n--mcp-config <c>\n--setting-sources <s>\n--no-session-persistence\n--allowedTools <t>\n--disallowedTools <t>\n--include-partial-messages\n',
            stderr: '',
            exitCode: 0,
            timedOut: false,
          };
        }
        if (first === 'network create') return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
        if (args[0] === 'rm') return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
        if (args.includes('--detach')) return { stdout: 'container-id', stderr: '', exitCode: 0, timedOut: false };
        if (args[0] === 'logs') return { stdout: '{"decision":"listening"}\n', stderr: '', exitCode: 0, timedOut: false };
        if (args.includes('node') && args.includes('-e')) return { stdout: netResult, stderr: '', exitCode: 0, timedOut: false };
        // The final probe run.
        return { stdout: probeStdout, stderr: probeStderr, exitCode: 0, timedOut: false };
      },
      runToSink: async () => ({ exitCode: 0, stderr: '', timedOut: false }),
    };
    return { runtime, calls };
  };

  it('all-green scripted runtime yields a complete passing report for every capability', () => {
    const netResult = JSON.stringify({
      direct_egress_blocked: true,
      proxy_refused_foreign: true,
      proxy_allowed_provider: true,
    });
    const { runtime } = scriptedDocker(netResult, validStream(), '===CDEB-HOME-FILES===\n');
    const probes = probeRuntimeCapabilities(runtime, FROZEN_PIN, {
      probePrompt: 'Reply with the single word: ready.',
      providerEnv: { ANTHROPIC_API_KEY: 'test' },
    });
    const byId = new Map(probes.map((probe) => [probe.capability, probe]));
    for (const capability of CAPABILITY_IDS) {
      const probe = byId.get(capability);
      expect(probe, `capability ${capability} probed`).toBeDefined();
      expect(probe?.ok, `${capability}: ${probe?.detail ?? ''}`).toBe(true);
    }
    const token = assertRuntimeCapabilities(probes, runtimePinDigest(FROZEN_PIN));
    expect(token.verified).toHaveLength(CAPABILITY_IDS.length);
  });

  it('a scripted runtime whose proxy leaks fails the network-policy capability by name', () => {
    const netResult = JSON.stringify({
      direct_egress_blocked: false,
      proxy_refused_foreign: true,
      proxy_allowed_provider: true,
    });
    const { runtime } = scriptedDocker(netResult, validStream(), '===CDEB-HOME-FILES===\n');
    const probes = probeRuntimeCapabilities(runtime, FROZEN_PIN, {
      probePrompt: 'ping',
      providerEnv: {},
    });
    const network = probes.find((probe) => probe.capability === 'network-policy');
    expect(network?.ok).toBe(false);
    expect(network?.detail).toContain('direct egress');
    expect(() => assertRuntimeCapabilities(probes, 'digest')).toThrowError(RuntimeCapabilityError);
  });

  it('an unfrozen pin short-circuits: image-pin fails and the rest stay never-probed', () => {
    const { runtime } = scriptedDocker('{}', '', '');
    const probes = probeRuntimeCapabilities(runtime, UNFROZEN_PIN, {
      probePrompt: 'ping',
      providerEnv: {},
    });
    expect(probes.map((probe) => probe.capability)).toContain('oci-runtime');
    const imagePin = probes.find((probe) => probe.capability === 'image-pin');
    expect(imagePin?.ok).toBe(false);
    expect(imagePin?.detail).toContain('not frozen');
    try {
      assertRuntimeCapabilities(probes, 'digest');
      expect.unreachable('must refuse');
    } catch (error) {
      const capabilityError = error as RuntimeCapabilityError;
      // Everything the image-pin gate could not reach is named as never probed.
      expect(capabilityError.untested).toContain('network-policy');
      expect(capabilityError.untested).toContain('model-observation');
    }
  });

  it('the generated network probe script is valid JavaScript', async () => {
    const { runtime, calls } = scriptedDocker('{}', '', '');
    probeRuntimeCapabilities(runtime, FROZEN_PIN, { probePrompt: 'ping', providerEnv: {} });
    const netCall = calls.find((args) => args.includes('-e'));
    expect(netCall).toBeDefined();
    const script = netCall?.[netCall.length - 1] ?? '';
    expect(script).toContain('CONNECT');
    const scriptPath = join(temp('netscript'), 'net-script.js');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(scriptPath, script);
    const { spawnSync } = await import('node:child_process');
    const check = spawnSync(process.execPath, ['--check', scriptPath], { encoding: 'utf8' });
    expect(check.status, check.stderr).toBe(0);
  });

  it('probeCommand quoting survives hostile arguments and reports HOME files on stderr', () => {
    const wrapped = probeCommand(['echo', "it's", 'a test']);
    expect(wrapped[0]).toBe('sh');
    const result = spawnSync(wrapped[0] ?? 'sh', [...wrapped.slice(1)], {
      encoding: 'utf8',
      env: { ...process.env, HOME: temp('homecheck') },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("it's a test");
    expect(result.stderr).toContain('===CDEB-HOME-FILES===');
  });
});

// ---------------------------------------------------------------------------
// The egress proxy: the allowlist decision is pure and always tested; the
// socket layer is exercised when this environment lets a process listen, and
// reported SKIPPED — not simulated — when the sandbox denies it.
// ---------------------------------------------------------------------------

const listenProbe = async (): Promise<boolean> => {
  const probeServer = net.createServer();
  return new Promise((resolve) => {
    probeServer.once('error', () => resolve(false));
    probeServer.listen(0, '127.0.0.1', () => {
      probeServer.close(() => resolve(true));
    });
  });
};

describe('§7.4 egress proxy decision logic', () => {
  const allowlist = new Set(['api.provider.example', 'console.provider.example']);

  it('allows CONNECT to an allowlisted host on the frozen port', () => {
    expect(decideEgress('CONNECT', 'api.provider.example:443', allowlist, 443)).toBe('allowed');
  });

  it('refuses a host outside the allowlist', () => {
    expect(decideEgress('CONNECT', 'evil.example:443', allowlist, 443)).toBe('refused-target');
  });

  it('refuses an allowlisted host on another port', () => {
    expect(decideEgress('CONNECT', 'api.provider.example:8080', allowlist, 443)).toBe('refused-target');
  });

  it('refuses anything that is not CONNECT', () => {
    expect(decideEgress('GET', 'api.provider.example:443', allowlist, 443)).toBe('refused-method');
  });

  it('refuses malformed targets', () => {
    expect(decideEgress('CONNECT', 'no-port-or-colon', allowlist, 443)).toBe('refused-target');
    expect(parseConnectTarget('host:notaport')).toBeNull();
    expect(parseConnectTarget('')).toBeNull();
    expect(parseConnectTarget('HOST.example:443')).toEqual({ host: 'host.example', port: 443 });
    expect(parseConnectTarget('bare.host')).toEqual({ host: 'bare.host', port: 443 });
  });

  it('an empty allowlist allows nothing', () => {
    expect(decideEgress('CONNECT', 'api.provider.example:443', new Set(), 443)).toBe('refused-target');
  });
});

describe('§7.4 egress proxy socket layer', () => {
  const proxyScript = 'bench/cdeb/runtime/egress-proxy.mjs';

  const startProxy = async (
    allowedHosts: string,
    port: number,
  ): Promise<{ child: ReturnType<typeof spawn>; stop: () => void }> => {
    const child = spawn(process.execPath, [proxyScript], {
      env: {
        ...process.env,
        CDEB_ALLOWED_HOSTS: allowedHosts,
        CDEB_ALLOWED_PORT: String(port),
        CDEB_LISTEN_PORT: String(port + 1000),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('proxy did not start')), 5_000);
      child.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('"listening"')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('exit', () => reject(new Error('proxy exited before listening')));
    });
    return {
      child,
      stop: () => {
        child.kill('SIGKILL');
      },
    };
  };

  const connectRequest = (proxyPort: number, target: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const socket = net.connect(proxyPort, '127.0.0.1', () => {
        socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
      });
      let buffer = '';
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('no proxy response'));
      }, 5_000);
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        if (buffer.includes('\r\n')) {
          clearTimeout(timer);
          socket.destroy();
          resolve(buffer.split('\r\n')[0] ?? '');
        }
      });
      socket.on('error', reject);
    });

  it('refuses CONNECT to a host outside the allowlist with a 403', async (ctx) => {
    if (!(await listenProbe())) return ctx.skip();
    const { stop } = await startProxy('127.0.0.1', 9501);
    try {
      const statusLine = await connectRequest(10501, 'evil.example:443');
      expect(statusLine).toContain('403');
    } finally {
      stop();
    }
  });

  it('establishes an allowlisted CONNECT and pipes bytes untouched', async (ctx) => {
    if (!(await listenProbe())) return ctx.skip();
    // A local echo server stands in for the provider endpoint.
    const echo = net.createServer((socket) => {
      socket.pipe(socket);
    });
    await new Promise<void>((resolve) => echo.listen(9503, '127.0.0.1', () => resolve()));

    const { stop } = await startProxy('127.0.0.1', 9503);
    try {
      const echoed = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(10503, '127.0.0.1', () => {
          socket.write('CONNECT 127.0.0.1:9503 HTTP/1.1\r\nHost: 127.0.0.1:9503\r\n\r\n');
        });
        let sawEstablished = false;
        const timer = setTimeout(() => reject(new Error('no echo')), 5_000);
        socket.on('data', (chunk) => {
          const text = chunk.toString();
          if (!sawEstablished) {
            if (!text.includes('200')) {
              clearTimeout(timer);
              reject(new Error(`expected 200, got: ${text.slice(0, 80)}`));
              return;
            }
            sawEstablished = true;
            socket.write('cdeb-bytes');
            return;
          }
          clearTimeout(timer);
          resolve(text);
          socket.destroy();
        });
        socket.on('error', reject);
      });
      expect(echoed).toBe('cdeb-bytes');
    } finally {
      stop();
      echo.close();
    }
  });

  it('refuses to start with an empty allowlist', async () => {
    const child = spawn(process.execPath, [proxyScript], {
      env: { ...process.env, CDEB_ALLOWED_HOSTS: '', CDEB_LISTEN_PORT: '10504' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, 5_000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The §4.6 probe seam
// ---------------------------------------------------------------------------

describe('§4.6 probe runtime seam', () => {
  it('keeps the probe contract through the seam: completed run', () => {
    const fakeRuntime = {
      name: 'fake',
      run: () => ({ stdout: '{"ok":true}', stderr: '', status: 0, timedOut: false }),
    };
    const { probe, artifact } = runProbe('/tmp', 'prompt', 'commitlore-on', 1000, 'sonnet', fakeRuntime);
    expect(probe.stop_reason).toBe('completed');
    expect(probe.condition).toBe('commitlore-on');
    expect(probe.model).toBe('sonnet');
    expect(artifact).toContain('{"ok":true}');
    expect(probe.artifact_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('maps a runtime timeout to the timeout stop reason', () => {
    const fakeRuntime = {
      name: 'fake',
      run: () => ({ stdout: '', stderr: '', status: null, timedOut: true }),
    };
    const { probe } = runProbe('/tmp', 'prompt', 'commitlore-off', 1000, 'sonnet', fakeRuntime);
    expect(probe.stop_reason).toBe('timeout');
  });

  it('maps a nonzero exit to agent_error', () => {
    const fakeRuntime = {
      name: 'fake',
      run: () => ({ stdout: '', stderr: 'boom', status: 1, timedOut: false }),
    };
    const { probe } = runProbe('/tmp', 'prompt', 'commitlore-off', 1000, 'sonnet', fakeRuntime);
    expect(probe.stop_reason).toBe('agent_error');
  });
});
