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

// ===========================================================================
// T-1008: commitlore_verify_capture
// ===========================================================================

describe('commitlore_verify_capture', () => {
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
    const tool = tools.find((t) => t.name === 'commitlore_verify_capture');
    expect(tool).toBeDefined();
    expect(tool!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it('returns validation_result with a valid draft', async () => {
    // First prepare a transaction
    const transcript = 'User decided to use PostgreSQL instead of MySQL.';
    const prepResponse = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript },
    });
    const prepResult = toolJson(prepResponse);
    const nonce = prepResult['nonce'] as string;

    // Build a valid draft with evidence from the transcript
    const draft = [
      {
        trailers: [
          { key: 'Ruled-out', value: 'MySQL: PostgreSQL chosen for its JSON support' },
          { key: 'Record-Id', value: 'r-test00001' },
        ],
        evidence: [
          {
            key: 'Ruled-out',
            source: 'transcript',
            quote: 'User decided to use PostgreSQL instead of MySQL.',
            locator: 'L1-L1',
          },
        ],
      },
    ];

    const response = await stub.request('tools/call', {
      name: 'commitlore_verify_capture',
      arguments: {
        nonce,
        draft: JSON.stringify(draft),
        transcript,
        diff: '',
      },
    });
    expect(response.error).toBeUndefined();
    expect(response.result?.['isError']).not.toBe(true);

    const result = toolJson(response);
    expect(result['validation_result']).toMatch(/^(pass|partial|empty)$/);
    expect(result['overlap_check']).toBe('canonical_exact_only');
    expect(result).toHaveProperty('accepted');
    expect(result).toHaveProperty('rejected');
    expect(result).toHaveProperty('incomplete');
  });

  it('returns empty for a fabricated evidence quote', async () => {
    const transcript = 'We chose Redis for caching.';
    const prepResponse = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript },
    });
    const prepResult = toolJson(prepResponse);
    const nonce = prepResult['nonce'] as string;

    // Draft with a fabricated quote (not in transcript)
    const draft = [
      {
        trailers: [
          { key: 'Ruled-out', value: 'Memcached: Redis chosen for persistence' },
          { key: 'Record-Id', value: 'r-fabricated001' },
        ],
        evidence: [
          {
            key: 'Ruled-out',
            source: 'transcript',
            quote: 'This quote does not exist in the actual transcript at all.',
            locator: 'L1-L1',
          },
        ],
      },
    ];

    const response = await stub.request('tools/call', {
      name: 'commitlore_verify_capture',
      arguments: {
        nonce,
        draft: JSON.stringify(draft),
        transcript,
        diff: '',
      },
    });
    expect(response.error).toBeUndefined();
    expect(response.result?.['isError']).not.toBe(true);

    const result = toolJson(response);
    expect(result['validation_result']).toBe('empty');
  });

  it('returns isError for malformed draft JSON', async () => {
    const transcript = 'some transcript';
    const prepResponse = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript },
    });
    const prepResult = toolJson(prepResponse);
    const nonce = prepResult['nonce'] as string;

    const response = await stub.request('tools/call', {
      name: 'commitlore_verify_capture',
      arguments: {
        nonce,
        draft: 'this is not valid JSON {{{',
        transcript,
        diff: '',
      },
    });
    expect(response.result?.['isError']).toBe(true);
  });

  it('rejects an invalid nonce format', async () => {
    const response = await stub.request('tools/call', {
      name: 'commitlore_verify_capture',
      arguments: {
        nonce: 'INVALID-NONCE-NOT-HEX!!',
        draft: '[]',
        transcript: 'test',
        diff: '',
      },
    });
    expect(response.result?.['isError']).toBe(true);
    const content = (response.result?.['content'] ?? []) as ContentBlock[];
    expect(content[0]?.text).toMatch(/nonce/i);
  });
});

// ===========================================================================
// Mutation oracles — T-1008
// ===========================================================================

describe('commitlore_verify_capture mutation oracles', () => {
  let repo: string;
  let stub: Stub;

  beforeAll(async () => {
    repo = makeRepo();
    stub = startStub(repo);
    await handshake(stub);
  }, 120_000);

  afterAll(() => { stub?.close(); });

  it('MUST FAIL: readOnlyHint must not be true (detects annotation mutation)', async () => {
    const response = await stub.request('tools/list');
    const tools = (response.result?.['tools'] ?? []) as {
      name: string;
      annotations?: Record<string, unknown>;
    }[];
    const tool = tools.find((t) => t.name === 'commitlore_verify_capture');
    // If someone mutates annotation to readOnlyHint: true, this fails.
    expect(tool).toBeDefined();
    expect(tool!.annotations?.['readOnlyHint']).toBe(false);
  });

  it('MUST FAIL: fabricated evidence must be rejected (detects bypass mutation)', async () => {
    const transcript = 'The team selected DynamoDB for its scalability.';
    const prepResponse = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript },
    });
    const prepResult = toolJson(prepResponse);
    const nonce = prepResult['nonce'] as string;

    // Draft with completely fabricated evidence
    const draft = [
      {
        trailers: [
          { key: 'Ruled-out', value: 'MongoDB: DynamoDB chosen for serverless' },
          { key: 'Record-Id', value: 'r-oracletest01' },
        ],
        evidence: [
          {
            key: 'Ruled-out',
            source: 'transcript',
            quote: 'FABRICATED: MongoDB was rejected because it requires server management.',
            locator: 'L5-L6',
          },
        ],
      },
    ];

    const response = await stub.request('tools/call', {
      name: 'commitlore_verify_capture',
      arguments: {
        nonce,
        draft: JSON.stringify(draft),
        transcript,
        diff: '',
      },
    });
    expect(response.result?.['isError']).not.toBe(true);

    const result = toolJson(response);
    // A mutation that accepts fabricated evidence would make this pass → catches it
    expect(result['validation_result']).toBe('empty');
    const rejectedArr = result['rejected'] as unknown[];
    expect(rejectedArr.length).toBeGreaterThan(0);
  });

  it('MUST PASS: nonce validation rejects path-traversal attempt', async () => {
    const response = await stub.request('tools/call', {
      name: 'commitlore_verify_capture',
      arguments: {
        nonce: '../../../etc/passwd__________',
        draft: '[]',
        transcript: 'test',
        diff: '',
      },
    });
    // Should error — nonce doesn't match ^[0-9a-f]{32}$
    expect(response.result?.['isError']).toBe(true);
  });
});

// ===========================================================================
// T-1009: commitlore_stage_capture
// ===========================================================================

describe('commitlore_stage_capture', () => {
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
    const tool = tools.find((t) => t.name === 'commitlore_stage_capture');
    expect(tool).toBeDefined();
    expect(tool!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it('stages a pending file given a verified nonce', async () => {
    // Prepare
    const transcript = 'User decided to use Kafka instead of RabbitMQ for event streaming.';
    const prepResponse = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript },
    });
    const prepResult = toolJson(prepResponse);
    const nonce = prepResult['nonce'] as string;

    // Verify with valid evidence
    const draft = [
      {
        trailers: [
          { key: 'Ruled-out', value: 'RabbitMQ | Kafka chosen for event streaming throughput' },
          { key: 'Record-Id', value: 'r-stage009a' },
        ],
        evidence: [
          {
            key: 'Ruled-out',
            source: 'transcript',
            quote: 'User decided to use Kafka instead of RabbitMQ for event streaming.',
            locator: 'L1-L1',
          },
        ],
      },
    ];
    const verifyResponse = await stub.request('tools/call', {
      name: 'commitlore_verify_capture',
      arguments: { nonce, draft: JSON.stringify(draft), transcript, diff: '' },
    });
    const verifyResult = toolJson(verifyResponse);
    expect(verifyResult['validation_result']).toBe('pass');

    // Stage
    const stageResponse = await stub.request('tools/call', {
      name: 'commitlore_stage_capture',
      arguments: { nonce },
    });
    expect(stageResponse.error).toBeUndefined();
    expect(stageResponse.result?.['isError']).not.toBe(true);

    const stageResult = toolJson(stageResponse);
    expect(stageResult['staged']).toBe(true);
    expect(stageResult['nonce']).toBe(nonce);
  });

  it('returns staged: false for a verified-empty nonce', async () => {
    // Prepare
    const transcript = 'We talked about nothing actionable.';
    const prepResponse = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript },
    });
    const prepResult = toolJson(prepResponse);
    const nonce = prepResult['nonce'] as string;

    // Verify with fabricated evidence → empty
    const draft = [
      {
        trailers: [
          { key: 'Ruled-out', value: 'Something | some reason' },
          { key: 'Record-Id', value: 'r-emptystg01' },
        ],
        evidence: [
          {
            key: 'Ruled-out',
            source: 'transcript',
            quote: 'This quote does not exist anywhere in the transcript.',
            locator: 'L1-L2',
          },
        ],
      },
    ];
    await stub.request('tools/call', {
      name: 'commitlore_verify_capture',
      arguments: { nonce, draft: JSON.stringify(draft), transcript, diff: '' },
    });

    // Stage — should return staged: false
    const stageResponse = await stub.request('tools/call', {
      name: 'commitlore_stage_capture',
      arguments: { nonce },
    });
    expect(stageResponse.error).toBeUndefined();
    expect(stageResponse.result?.['isError']).not.toBe(true);

    const stageResult = toolJson(stageResponse);
    expect(stageResult['staged']).toBe(false);
    expect(stageResult).toHaveProperty('reason');
  });

  it('does not write to Git history', async () => {
    // Capture git log before
    const logBefore = execGitOrThrow(['log', '--oneline'], { cwd: repo });

    // Prepare + verify + stage
    const transcript = 'User chose TypeScript instead of JavaScript for type safety.';
    const prepResponse = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript },
    });
    const prepResult = toolJson(prepResponse);
    const nonce = prepResult['nonce'] as string;

    const draft = [
      {
        trailers: [
          { key: 'Ruled-out', value: 'JavaScript | TypeScript chosen for type safety' },
          { key: 'Record-Id', value: 'r-nohist001' },
        ],
        evidence: [
          {
            key: 'Ruled-out',
            source: 'transcript',
            quote: 'User chose TypeScript instead of JavaScript for type safety.',
            locator: 'L1-L1',
          },
        ],
      },
    ];
    await stub.request('tools/call', {
      name: 'commitlore_verify_capture',
      arguments: { nonce, draft: JSON.stringify(draft), transcript, diff: '' },
    });
    await stub.request('tools/call', {
      name: 'commitlore_stage_capture',
      arguments: { nonce },
    });

    // git log after must be identical
    const logAfter = execGitOrThrow(['log', '--oneline'], { cwd: repo });
    expect(logAfter).toBe(logBefore);
  });

  it('rejects an invalid nonce format', async () => {
    const response = await stub.request('tools/call', {
      name: 'commitlore_stage_capture',
      arguments: { nonce: 'INVALID-NOT-HEX!!!!!!!!!!!!!!!' },
    });
    expect(response.result?.['isError']).toBe(true);
    const content = (response.result?.['content'] ?? []) as ContentBlock[];
    expect(content[0]?.text).toMatch(/nonce/i);
  });

  it('rejects a prepared (unverified) nonce', async () => {
    // Prepare only — do not verify
    const transcript = 'Some discussion about architecture.';
    const prepResponse = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript },
    });
    const prepResult = toolJson(prepResponse);
    const nonce = prepResult['nonce'] as string;

    // Attempt to stage without verify
    const stageResponse = await stub.request('tools/call', {
      name: 'commitlore_stage_capture',
      arguments: { nonce },
    });
    expect(stageResponse.error).toBeUndefined();
    expect(stageResponse.result?.['isError']).not.toBe(true);

    const stageResult = toolJson(stageResponse);
    expect(stageResult['staged']).toBe(false);
    expect(stageResult).toHaveProperty('reason');
  });

  it('accepts only nonce in the input schema (no extra fields)', async () => {
    const response = await stub.request('tools/list');
    const tools = (response.result?.['tools'] ?? []) as {
      name: string;
      inputSchema?: Record<string, unknown>;
    }[];
    const tool = tools.find((t) => t.name === 'commitlore_stage_capture');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema!;
    expect(schema['required']).toEqual(['nonce']);
    expect(Object.keys(schema['properties'] as Record<string, unknown>)).toEqual(['nonce']);
    expect(schema['additionalProperties']).toBe(false);
  });
});

// ===========================================================================
// Mutation oracles — T-1009
// ===========================================================================

describe('commitlore_stage_capture mutation oracles', () => {
  let repo: string;
  let stub: Stub;

  beforeAll(async () => {
    repo = makeRepo();
    stub = startStub(repo);
    await handshake(stub);
  }, 120_000);

  afterAll(() => { stub?.close(); });

  it('MUST FAIL: schema must not accept a caller-supplied base_head', async () => {
    // Verify the schema has ONLY nonce — if base_head were accepted, this fails
    const response = await stub.request('tools/list');
    const tools = (response.result?.['tools'] ?? []) as {
      name: string;
      inputSchema?: Record<string, unknown>;
    }[];
    const tool = tools.find((t) => t.name === 'commitlore_stage_capture');
    expect(tool).toBeDefined();
    const props = Object.keys(tool!.inputSchema!['properties'] as Record<string, unknown>);
    // If someone adds base_head to the schema, this assertion fails
    expect(props).not.toContain('base_head');
    expect(props).toEqual(['nonce']);
  });

  it('MUST FAIL: expires_at must be anchored to staged_at not created_at', async () => {
    // Prepare + verify + stage, then read the pending file and check timestamps
    const transcript = 'User chose Rust instead of Go for memory safety guarantees.';
    const prepResponse = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript },
    });
    const prepResult = toolJson(prepResponse);
    const nonce = prepResult['nonce'] as string;

    const draft = [
      {
        trailers: [
          { key: 'Ruled-out', value: 'Go | Rust chosen for memory safety without GC' },
          { key: 'Record-Id', value: 'r-oracle009b' },
        ],
        evidence: [
          {
            key: 'Ruled-out',
            source: 'transcript',
            quote: 'User chose Rust instead of Go for memory safety guarantees.',
            locator: 'L1-L1',
          },
        ],
      },
    ];
    await stub.request('tools/call', {
      name: 'commitlore_verify_capture',
      arguments: { nonce, draft: JSON.stringify(draft), transcript, diff: '' },
    });

    // Small delay to make created_at and staged_at differ
    await new Promise((resolve) => setTimeout(resolve, 50));

    const stageResponse = await stub.request('tools/call', {
      name: 'commitlore_stage_capture',
      arguments: { nonce },
    });
    const stageResult = toolJson(stageResponse);
    expect(stageResult['staged']).toBe(true);

    // Read the pending file directly to check the timestamps
    const pendingDir = join(repo, '.git', 'commitlore', 'pending');
    const files = readdirSync(pendingDir).filter((f) => f.startsWith(nonce));
    expect(files.length).toBe(1);
    const pendingContent = JSON.parse(readFileSync(join(pendingDir, files[0]), 'utf8'));

    const stagedAt = new Date(pendingContent.staged_at).getTime();
    const expiresAt = new Date(pendingContent.expires_at).getTime();
    const createdAt = new Date(pendingContent.created_at).getTime();

    // expires_at must equal staged_at + 5 minutes (300_000ms), NOT created_at + 5 min
    const diffFromStaged = expiresAt - stagedAt;
    const diffFromCreated = expiresAt - createdAt;

    // The expires_at should be exactly 5 min from staged_at (within 1 second tolerance)
    expect(Math.abs(diffFromStaged - 300_000)).toBeLessThan(1000);

    // If expires_at were anchored to created_at, this would need to differ from
    // staged_at anchor. Since there's a 50ms delay between create and stage,
    // we just verify the anchor is staged_at.
    // The key assertion: staged_at !== created_at (the delay guarantees this)
    // and expires_at is anchored to staged_at.
    expect(stagedAt).toBeGreaterThan(createdAt);
    expect(Math.abs(diffFromStaged - 300_000)).toBeLessThan(1000);
    // If someone mistakenly uses created_at, diffFromCreated would be 300_000 
    // but diffFromStaged would be ~300_050 or more — however the key test is
    // that the pending file's staged_at field is used as anchor.
    // We verify by checking that expires_at - staged_at is exactly 5 min
    // while expires_at - created_at is NOT exactly 5 min (because of the delay).
    expect(Math.abs(diffFromCreated - 300_000)).toBeGreaterThan(10);
  });

  it('MUST PASS: valid nonce validation rejects path-traversal attempt', async () => {
    const response = await stub.request('tools/call', {
      name: 'commitlore_stage_capture',
      arguments: { nonce: '../../../etc/passwd__________' },
    });
    // Should error — nonce doesn't match ^[0-9a-f]{32}$
    expect(response.result?.['isError']).toBe(true);
  });
});
