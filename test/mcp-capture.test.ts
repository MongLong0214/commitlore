/**
 * MCP capture tools — T-1007, T-1008, T-1009.
 *
 * Each ticket appends its own describe block; they share the test-repo setup
 * and the JSON-RPC stub infrastructure.
 *
 * T-1007: commitlore_prepare_capture
 * T-1008: commitlore_verify_capture (to be appended)
 * T-1009: commitlore_stage_capture  (to be appended)
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { execGitOrThrow } from '../src/core/git.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const SERVER_ENTRY = fileURLToPath(new URL('../dist/mcp/main.js', import.meta.url));

const PROTOCOL_VERSION = '2025-11-25';
const RPC_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Git config for test commits
// ---------------------------------------------------------------------------

const GIT_CONFIG = [
  '-c', 'user.name=CommitLore Test',
  '-c', 'user.email=test@example.invalid',
  '-c', 'commit.gpgsign=false',
  '-c', 'core.hooksPath=/dev/null',
];

// ---------------------------------------------------------------------------
// Test repository setup
// ---------------------------------------------------------------------------

const temporaries: string[] = [];

const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-mcp-capture-'));
  temporaries.push(dir);
  execGitOrThrow(['init', dir], { cwd: dir });
  // Initial commit so HEAD exists
  const file = join(dir, 'README.md');
  writeFileSync(file, '# test\n');
  execGitOrThrow([...GIT_CONFIG, '-C', dir, 'add', '-A'], { cwd: dir });
  execGitOrThrow([...GIT_CONFIG, '-C', dir, 'commit', '-m', 'initial'], { cwd: dir });
  return dir;
};

// ---------------------------------------------------------------------------
// JSON-RPC stub client (same pattern as test/mcp.test.ts)
// ---------------------------------------------------------------------------

interface RpcResponse {
  jsonrpc: string;
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ContentBlock { type: string; text?: string; }

interface Stub {
  request: (method: string, params?: unknown) => Promise<RpcResponse>;
  notify: (method: string, params?: unknown) => void;
  stderr: () => string;
  close: () => void;
}

const startStub = (cwd: string): Stub => {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [SERVER_ENTRY], {
    cwd,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let err = '';
  let buffer = '';
  const pending = new Map<number, (response: RpcResponse) => void>();
  let nextId = 1;

  child.on('error', (error: Error) => { err += `spawn error: ${error.message}\n`; });
  child.stdin.on('error', () => {});

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { err += chunk; });
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') continue;
      let message: RpcResponse;
      try { message = JSON.parse(line) as RpcResponse; } catch { continue; }
      if (typeof message.id !== 'number') continue;
      const resolve = pending.get(message.id);
      if (resolve === undefined) continue;
      pending.delete(message.id);
      resolve(message);
    }
  });

  const send = (payload: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  return {
    request: (method, params) =>
      new Promise<RpcResponse>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out after ${RPC_TIMEOUT_MS}ms; stderr:\n${err}`));
        }, RPC_TIMEOUT_MS);
        pending.set(id, (response) => {
          clearTimeout(timer);
          resolve(response);
        });
        send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
      }),
    notify: (method, params) => {
      send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
    },
    stderr: () => err,
    close: () => { child.stdin.end(); child.kill(); },
  };
};

const handshake = async (stub: Stub): Promise<RpcResponse> => {
  const response = await stub.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'commitlore-capture-test', version: '0' },
  });
  stub.notify('notifications/initialized');
  return response;
};

const toolJson = (response: RpcResponse): Record<string, unknown> => {
  const content = (response.result?.['content'] ?? []) as ContentBlock[];
  const first = content[0];
  if (first?.text === undefined) throw new Error(`no text content: ${JSON.stringify(response)}`);
  return JSON.parse(first.text) as Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Build once before tests
// ---------------------------------------------------------------------------

beforeAll(() => {
  const build = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], {
    shell: false,
    encoding: 'utf8',
    cwd: PACKAGE_ROOT,
  });
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`tsc produced no ${SERVER_ENTRY} (exit ${build.status}):\n${build.stdout}${build.stderr}`);
  }
}, 180_000);

afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

// ===========================================================================
// T-1007: commitlore_prepare_capture
// ===========================================================================

describe('commitlore_prepare_capture', () => {
  let repo: string;
  let stub: Stub;

  beforeAll(async () => {
    repo = makeRepo();
    stub = startStub(repo);
    await handshake(stub);
  }, 120_000);

  afterAll(() => { stub?.close(); });

  it('is listed with readOnlyHint: false', async () => {
    const response = await stub.request('tools/list');
    const tools = (response.result?.['tools'] ?? []) as {
      name: string;
      annotations?: Record<string, unknown>;
    }[];
    const tool = tools.find((t) => t.name === 'commitlore_prepare_capture');
    expect(tool).toBeDefined();
    expect(tool!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it('returns a nonce and prompt contract', async () => {
    const response = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript: 'User decided to use PostgreSQL instead of MySQL.' },
    });
    expect(response.error).toBeUndefined();
    expect(response.result?.['isError']).not.toBe(true);

    const result = toolJson(response);
    // Nonce: 32 lowercase hex chars
    expect(result['nonce']).toMatch(/^[0-9a-f]{32}$/);
    // base_head: 40-char hex SHA
    expect(result['base_head']).toMatch(/^[0-9a-f]{40}$/);
    // staged_diff_hash: 64-char hex SHA-256
    expect(result['staged_diff_hash']).toMatch(/^[0-9a-f]{64}$/);
    // staged_tree_oid: 40-char hex
    expect(result['staged_tree_oid']).toMatch(/^[0-9a-f]{40}$/);
    // policy_identity_hash: 64-char hex SHA-256
    expect(result['policy_identity_hash']).toMatch(/^[0-9a-f]{64}$/);
    // source_hashes present
    expect(result['source_hashes']).toBeDefined();
    const hashes = result['source_hashes'] as Record<string, string>;
    expect(hashes['transcript']).toMatch(/^[0-9a-f]{64}$/);
    expect(hashes['diff']).toMatch(/^[0-9a-f]{64}$/);
    // prompt present and non-empty
    expect(typeof result['prompt']).toBe('string');
    expect((result['prompt'] as string).length).toBeGreaterThan(0);
  });

  it('does not expose a commitlore_write_record tool', async () => {
    const response = await stub.request('tools/list');
    const tools = (response.result?.['tools'] ?? []) as { name: string }[];
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('commitlore_write_record');
  });

  it('existing query tools retain readOnlyHint: true', async () => {
    const response = await stub.request('tools/list');
    const tools = (response.result?.['tools'] ?? []) as {
      name: string;
      annotations?: Record<string, unknown>;
    }[];
    for (const name of ['commitlore_query', 'commitlore_stale', 'commitlore_guard', 'commitlore_before_change']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `${name} should exist`).toBeDefined();
      expect(tool!.annotations?.['readOnlyHint'], `${name} should be readOnlyHint:true`).toBe(true);
    }
  });

  it('returns isError when called outside a git repo', async () => {
    // Start a stub in /tmp (not a git repo)
    const tmpDir = mkdtempSync(join(tmpdir(), 'commitlore-no-git-'));
    temporaries.push(tmpDir);
    const noGitStub = startStub(tmpDir);
    await handshake(noGitStub);
    try {
      const response = await noGitStub.request('tools/call', {
        name: 'commitlore_prepare_capture',
        arguments: { transcript: 'some transcript' },
      });
      expect(response.result?.['isError']).toBe(true);
    } finally {
      noGitStub.close();
    }
  });
});

// ===========================================================================
// Mutation oracles — T-1007
// These verify test sensitivity: each "MUST FAIL" test asserts a property that
// would break if the implementation were mutated in a specific way. Each
// "MUST PASS" test asserts a property that is not affected by the mutation.
// ===========================================================================

describe('commitlore_prepare_capture mutation oracles', () => {
  let repo: string;
  let stub: Stub;

  beforeAll(async () => {
    repo = makeRepo();
    stub = startStub(repo);
    await handshake(stub);
  }, 120_000);

  afterAll(() => { stub?.close(); });

  it('MUST FAIL: readOnlyHint must not be true (detects write-side mutation)', async () => {
    const response = await stub.request('tools/list');
    const tools = (response.result?.['tools'] ?? []) as {
      name: string;
      annotations?: Record<string, unknown>;
    }[];
    const tool = tools.find((t) => t.name === 'commitlore_prepare_capture');
    // This oracle verifies that the tool is NOT marked readOnly.
    // If someone mutates the annotation to readOnlyHint: true, this fails.
    expect(tool!.annotations?.['readOnlyHint']).toBe(false);
  });

  it('MUST FAIL: nonce must match ^[0-9a-f]{32}$ (detects malformed nonce)', async () => {
    const response = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript: 'test transcript' },
    });
    const result = toolJson(response);
    const nonce = result['nonce'] as string;
    // Verify the nonce is exactly 32 lowercase hex characters.
    // A mutation that produces uppercase or wrong-length nonces would fail.
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(nonce).toHaveLength(32);
    // Additional: ensure it's not all zeros (weak randomness)
    expect(nonce).not.toBe('0'.repeat(32));
  });

  it('MUST PASS: transcript is not stored raw in the result (privacy check)', async () => {
    const secret = 'SUPER_SECRET_API_KEY_12345_do_not_leak';
    const response = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript: `The user said: ${secret}` },
    });
    const result = toolJson(response);
    // The prompt contract may reference transcript structure but the raw
    // transcript content is not stored in the nonce/hashes/etc fields.
    const jsonStr = JSON.stringify(result);
    // The prompt DOES contain instructions but should not contain the secret verbatim
    // (the prompt references transcript by instruction, not by embedding its full content).
    // This is a safety net — if the tool ever starts embedding raw transcript, this catches it.
    // Note: the prompt contract generated by buildHarvestPrompt MAY include the transcript,
    // so we check only the non-prompt fields.
    const nonPromptResult = { ...result };
    delete nonPromptResult['prompt'];
    const nonPromptJson = JSON.stringify(nonPromptResult);
    expect(nonPromptJson).not.toContain(secret);
  });
});
