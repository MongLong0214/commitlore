/**
 * F-002 — an MCP capture tool is a promise that the runtime can load every
 * asset its capture pipeline needs.  These tests run a compiled server from a
 * package root deliberately missing `spec/`, which is the state left behind
 * when an old installed runtime outlives its installation directory.
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const PROTOCOL_VERSION = '2025-11-25';
const temporaries: string[] = [];

interface RpcResponse {
  result?: Record<string, unknown>;
  error?: { message: string };
}

interface Stub {
  request: (method: string, params?: unknown) => Promise<RpcResponse>;
  notify: (method: string, params?: unknown) => void;
  stderr: () => string;
  close: () => Promise<void>;
}

let entry = '';
let repo = '';
let initialized: RpcResponse;
let stub: Stub;

const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-mcp-preflight-repo-'));
  temporaries.push(dir);
  spawnSync('git', ['init', '-q', dir], { shell: false });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  const commit = spawnSync(
    'git',
    ['-C', dir, '-c', 'user.name=CommitLore Test', '-c', 'user.email=test@example.invalid', 'add', '-A'],
    { shell: false },
  );
  if (commit.status !== 0) throw new Error('could not stage test repository');
  const made = spawnSync(
    'git',
    ['-C', dir, '-c', 'user.name=CommitLore Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial'],
    { shell: false },
  );
  if (made.status !== 0) throw new Error('could not commit test repository');
  return dir;
};

const startStub = (cwd: string): Stub => {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [entry], {
    cwd,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map<number, (response: RpcResponse) => void>();

  child.stdin.on('error', () => {});
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') continue;
      const response = JSON.parse(line) as RpcResponse & { id?: number };
      if (response.id === undefined) continue;
      const resolve = pending.get(response.id);
      if (resolve !== undefined) {
        pending.delete(response.id);
        resolve(response);
      }
    }
  });

  const send = (payload: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };
  return {
    request: (method, params) => new Promise<RpcResponse>((resolve, reject) => {
      const id = nextId++;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 30_000);
      pending.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    }),
    notify: (method, params) => send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }),
    stderr: () => stderr,
    close: async () => {
      if (child.exitCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.stdin.end();
      child.kill();
      await exited;
    },
  };
};

const handshake = async (client: Stub): Promise<RpcResponse> => {
  const response = await client.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'preflight-test', version: '0' },
  });
  client.notify('notifications/initialized');
  return response;
};

const toolText = (response: RpcResponse): string => {
  const content = (response.result?.['content'] ?? []) as Array<{ text?: string }>;
  return content.map((block) => block.text ?? '').join('\n');
};

beforeAll(async () => {
  const harness = mkdtempSync(join(tmpdir(), 'commitlore-mcp-preflight-dist-'));
  temporaries.push(harness);
  entry = join(harness, 'dist', 'mcp', 'main.js');
  // This is intentionally a package root without `spec/`.
  symlinkSync(join(PACKAGE_ROOT, 'node_modules'), join(harness, 'node_modules'), 'dir');
  symlinkSync(join(PACKAGE_ROOT, 'package.json'), join(harness, 'package.json'));
  const build = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json', '--outDir', join(harness, 'dist')], {
    cwd: PACKAGE_ROOT,
    shell: false,
    encoding: 'utf8',
  });
  if (!existsSync(entry)) throw new Error(`tsc did not produce the server:\n${build.stderr}`);
  repo = makeRepo();
  stub = startStub(repo);
  initialized = await handshake(stub);
}, 120_000);

afterAll(async () => {
  await stub?.close();
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

describe('F-002 capture preflight', () => {
  it('does not advertise capture tools when SPEC assets are absent', async () => {
    const listed = await stub.request('tools/list');
    const names = ((listed.result?.['tools'] ?? []) as Array<{ name: string }>).map((tool) => tool.name);
    expect(names).not.toContain('commitlore_prepare_capture');
    expect(names).not.toContain('commitlore_verify_capture');
    expect(names).not.toContain('commitlore_stage_capture');
  });

  it('turns a stale prepare_capture call into a runtime-specific repair', async () => {
    const response = await stub.request('tools/call', {
      name: 'commitlore_prepare_capture',
      arguments: { transcript: 'A decision was made.' },
    });
    expect(response.result?.['isError']).toBe(true);
    expect(toolText(response)).toContain('capture is unavailable');
    expect(toolText(response)).toContain('runtime entrypoint');
    expect(toolText(response)).toContain('restart');
    expect(toolText(response)).not.toContain('ENOENT');
  });

  it('identifies itself as degraded read-only during initialize', () => {
    const info = initialized.result?.['serverInfo'] as Record<string, unknown> | undefined;
    expect(info?.['description']).toContain('degraded read-only');
    expect(stub.stderr()).toContain('degraded read-only');
  });
});
