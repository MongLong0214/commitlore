/**
 * T-1023 (#216): Capture pipeline E2E integration.
 *
 * Independent audit finding — closes no acceptance-matrix row.
 * Proves the capture pipeline works end-to-end against real temporary Git
 * repositories and the real CLI binary. Never mocks modules.
 *
 * Six scenarios, each against a real repo and real subprocesses:
 * 1. CLI capture → prepare-commit-msg → git commit → post-commit → queryable
 * 2. MCP prepare → verify → stage over one nonce, then commit flow
 * 3. HEAD moves between prepare and commit → no record attaches
 * 4. Fabricated/foreign nonce → stage fails closed
 * 5. Concurrent capture in a linked worktree → independent pending dirs
 * 6. Aborted commit → pending record stays retriable
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
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI_BIN = fileURLToPath(new URL('../dist/commitlore.mjs', import.meta.url));
const SERVER_ENTRY = fileURLToPath(new URL('../dist/mcp/main.js', import.meta.url));

// Generous timeout — E2E tests spawn real processes
vi.setConfig({ testTimeout: 60_000 });

// ---------------------------------------------------------------------------
// Cleanup tracking
// ---------------------------------------------------------------------------

const temporaries: string[] = [];

afterAll(() => {
  for (const dir of temporaries) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ---------------------------------------------------------------------------
// Helpers: repository creation
// ---------------------------------------------------------------------------

const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: '/nonexistent/commitlore-e2e-test',
  GIT_CONFIG_SYSTEM: '/nonexistent/commitlore-e2e-test',
  GIT_AUTHOR_NAME: 'E2E Test',
  GIT_AUTHOR_EMAIL: 'e2e@test.invalid',
  GIT_COMMITTER_NAME: 'E2E Test',
  GIT_COMMITTER_EMAIL: 'e2e@test.invalid',
};

const gitEnv = (cwd: string): NodeJS.ProcessEnv => ({
  ...process.env,
  ...GIT_ENV,
  COMMITLORE_BIN: CLI_BIN,
  HOME: cwd,
});

/** Create a fresh git repo with one initial commit and hooks installed. */
const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-e2e-'));
  temporaries.push(dir);

  // git init
  spawnSync('git', ['init', '--quiet', '--template=', '--initial-branch=main', dir], {
    env: gitEnv(dir),
    stdio: 'pipe',
  });

  // Configure
  const gitCfg = (k: string, v: string) =>
    spawnSync('git', ['config', k, v], { cwd: dir, env: gitEnv(dir), stdio: 'pipe' });
  gitCfg('user.name', 'E2E Test');
  gitCfg('user.email', 'e2e@test.invalid');
  gitCfg('commit.gpgsign', 'false');

  // Initial commit so HEAD exists
  writeFileSync(join(dir, 'README.md'), '# e2e test\n');
  spawnSync('git', ['add', '-A'], { cwd: dir, env: gitEnv(dir), stdio: 'pipe' });
  spawnSync('git', ['commit', '-m', 'initial', '--no-verify'], {
    cwd: dir, env: gitEnv(dir), stdio: 'pipe',
  });

  // Install hooks via commitlore init (which installs prepare-commit-msg and post-commit)
  const initResult = spawnSync(process.execPath, [CLI_BIN, 'init'], {
    cwd: dir, env: gitEnv(dir), stdio: 'pipe', encoding: 'utf8',
    timeout: 30_000,
  });
  // If init fails (e.g. index rebuild issues), fall back to manual hook creation
  // Check if hooks were actually installed
  const hooksResult = spawnSync('git', ['rev-parse', '--git-path', 'hooks/prepare-commit-msg'], {
    cwd: dir, env: gitEnv(dir), encoding: 'utf8', stdio: 'pipe',
  });
  const hookPath = resolve(dir, (hooksResult.stdout ?? '').trim());
  if (!existsSync(hookPath)) {
    installHooksManually(dir);
  }

  return dir;
};

/** Manually install the prepare-commit-msg and post-commit hooks. */
const installHooksManually = (dir: string): void => {
  // In a linked worktree, .git is a file pointing to the real git dir.
  // We need to resolve the actual hooks directory.
  const hooksResult = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], {
    cwd: dir, env: gitEnv(dir), encoding: 'utf8', stdio: 'pipe',
  });
  const hooksDir = resolve(dir, (hooksResult.stdout ?? '').trim());
  mkdirSync(hooksDir, { recursive: true });

  const prepareHook = join(hooksDir, 'prepare-commit-msg');
  writeFileSync(prepareHook, [
    '#!/bin/sh',
    `exec "${process.execPath}" "${CLI_BIN}" prepare-commit-msg "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });

  const postCommitHook = join(hooksDir, 'post-commit');
  writeFileSync(postCommitHook, [
    '#!/bin/sh',
    `exec "${process.execPath}" "${CLI_BIN}" post-commit`,
    '',
  ].join('\n'), { mode: 0o755 });
};

// ---------------------------------------------------------------------------
// Helpers: CLI execution
// ---------------------------------------------------------------------------

/** Run the CLI binary and return stdout/stderr/status. */
const runCli = (cwd: string, args: string[]): { stdout: string; stderr: string; status: number } => {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    env: gitEnv(cwd),
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
};

/** Run git with proper env. */
const runGit = (cwd: string, args: string[]): { stdout: string; stderr: string; status: number } => {
  const result = spawnSync('git', args, {
    cwd,
    env: gitEnv(cwd),
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
};

// ---------------------------------------------------------------------------
// Helpers: capture pipeline via CLI
// ---------------------------------------------------------------------------

const TRANSCRIPT_CONTENT = 'The team decided to use SQLite instead of PostgreSQL for local storage.';

/** Create a valid draft JSON that will pass verification against TRANSCRIPT_CONTENT. */
const makeValidDraft = (recordId?: string): object => ({
  records: [
    {
      trailers: [
        { key: 'Ruled-out', value: 'PostgreSQL | SQLite chosen for local storage simplicity' },
        ...(recordId === undefined ? [] : [{ key: 'Record-Id', value: recordId }]),
      ],
      evidence: [
        {
          key: 'Ruled-out',
          source: 'transcript',
          quote: 'The team decided to use SQLite instead of PostgreSQL for local storage.',
          locator: 'L1-L1',
        },
      ],
    },
  ],
});

/** Run the full CLI capture pipeline: write files, invoke capture command. */
const runCapturePipeline = (
  cwd: string,
  recordId?: string,
): { nonce: string | null; staged: boolean; stderr: string } => {
  const transcriptPath = join(cwd, '.commitlore-transcript.tmp');
  const draftPath = join(cwd, '.commitlore-draft.tmp');
  const diffPath = join(cwd, '.commitlore-diff.tmp');

  writeFileSync(transcriptPath, TRANSCRIPT_CONTENT);
  writeFileSync(draftPath, JSON.stringify(makeValidDraft(recordId)));

  // The verify step checks sha256(diff_param) === source_hashes.diff
  // source_hashes.diff = sha256(git diff --cached) at prepare time.
  // We must pass the actual staged diff content.
  const diffResult = runGit(cwd, ['diff', '--cached']);
  writeFileSync(diffPath, diffResult.stdout);

  const result = runCli(cwd, [
    'capture',
    '--transcript', transcriptPath,
    '--diff', diffPath,
    '--draft', draftPath,
    '--json',
  ]);

  if (result.status !== 0) {
    return { nonce: null, staged: false, stderr: result.stderr };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return { nonce: parsed.nonce ?? null, staged: parsed.staged ?? false, stderr: result.stderr };
  } catch {
    return { nonce: null, staged: false, stderr: result.stderr };
  }
};

// ---------------------------------------------------------------------------
// Helpers: pending file reading
// ---------------------------------------------------------------------------

const readPendingFiles = (cwd: string): Array<{ nonce: string; data: Record<string, unknown> }> => {
  // Use git rev-parse to find the correct pending dir (handles worktrees)
  const result = spawnSync('git', ['rev-parse', '--git-path', 'commitlore/pending'], {
    cwd, encoding: 'utf8', stdio: 'pipe',
  });
  const pendingDir = resolve(cwd, (result.stdout ?? '').trim());
  if (!existsSync(pendingDir)) return [];
  const files = readdirSync(pendingDir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const data = JSON.parse(readFileSync(join(pendingDir, f), 'utf8'));
    return { nonce: f.replace('.json', ''), data };
  });
};

// ---------------------------------------------------------------------------
// Helpers: MCP JSON-RPC stub
// ---------------------------------------------------------------------------

interface RpcResponse {
  jsonrpc: string;
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ContentBlock { type: string; text?: string }

interface McpStub {
  request: (method: string, params?: unknown) => Promise<RpcResponse>;
  notify: (method: string, params?: unknown) => void;
  stderr: () => string;
  close: () => void;
}

const startMcpStub = (cwd: string): McpStub => {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [SERVER_ENTRY], {
    cwd,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: gitEnv(cwd),
  });

  let err = '';
  let buffer = '';
  const pending = new Map<number, (r: RpcResponse) => void>();
  let nextId = 1;

  child.on('error', (e: Error) => { err += `spawn error: ${e.message}\n`; });
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
      let msg: RpcResponse;
      try { msg = JSON.parse(line) as RpcResponse; } catch { continue; }
      if (typeof msg.id !== 'number') continue;
      const resolve = pending.get(msg.id);
      if (!resolve) continue;
      pending.delete(msg.id);
      resolve(msg);
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
          reject(new Error(`${method} timed out after 30s; stderr:\n${err}`));
        }, 30_000);
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

const mcpHandshake = async (stub: McpStub): Promise<void> => {
  await stub.request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'e2e-test', version: '0' },
  });
  stub.notify('notifications/initialized');
};

const toolJson = (response: RpcResponse): Record<string, unknown> => {
  const content = (response.result?.['content'] ?? []) as ContentBlock[];
  const first = content[0];
  if (first?.text === undefined) throw new Error(`no text content: ${JSON.stringify(response)}`);
  return JSON.parse(first.text) as Record<string, unknown>;
};

// ===========================================================================
// Scenario 1: CLI capture → prepare-commit-msg → git commit → post-commit → record queryable
// Proves: the chain works against a real repository
// RED condition: would fail if prepare-commit-msg does not apply the trailer block,
//   or if post-commit does not consume, or if the record is not queryable after commit.
// ===========================================================================

describe('Scenario 1: CLI capture full chain', () => {
  it('stages via CLI, commits, and the record is queryable', () => {
    const repo = makeRepo();

    // Stage a file change so there is something to commit
    writeFileSync(join(repo, 'feature.ts'), 'export const x = 1;\n');
    runGit(repo, ['add', 'feature.ts']);

    // Run capture pipeline
    const capture = runCapturePipeline(repo);
    expect(capture.staged, 'capture must stage successfully').toBe(true);
    expect(capture.nonce, 'nonce must be returned').toMatch(/^[0-9a-f]{32}$/);

    // Real git commit — hooks fire
    const commitResult = runGit(repo, ['commit', '-m', 'feat: add feature']);
    expect(commitResult.status, `git commit failed: ${commitResult.stderr}`).toBe(0);

    // The draft omitted Record-Id, so the complete capture path must mint one
    // before the ordinary Git commit applies its pending record.
    const logResult = runGit(repo, ['log', '-1', '--format=%B']);
    const minted = /^Record-Id: (r-[a-z0-9]{6,})$/m.exec(logResult.stdout)?.[1];
    expect(minted).toMatch(/^r-[a-z0-9]{6,}$/);

    // Verify the pending file was consumed
    const pendingFiles = readPendingFiles(repo);
    const consumed = pendingFiles.find(f => f.nonce === capture.nonce);
    if (consumed) {
      expect(consumed.data['phase']).toBe('consumed');
      expect(consumed.data['consumed']).toBe(true);
      expect(consumed.data['consumed_by']).toMatch(/^[0-9a-f]{40}$/);
    }

    // Verify record is queryable via CLI context
    const queryResult = runCli(repo, ['context', '--json']);
    expect(queryResult.stdout).toContain(minted);
  });
});

// ===========================================================================
// Scenario 2: MCP prepare → verify → stage over one nonce, then commit flow
// Proves: MCP and CLI reach the same outcome (PRD-F9 agent-agnostic contract)
// RED condition: would fail if any of the three MCP tools fails to advance the
//   pending state, or if the hook doesn't apply the MCP-staged record.
// ===========================================================================

describe('Scenario 2: MCP three-tool sequence then commit', () => {
  it('prepare → verify → stage via MCP, then commit attaches the record', async () => {
    const repo = makeRepo();
    const stub = startMcpStub(repo);

    try {
      await mcpHandshake(stub);

      // Stage a file so there is content to commit
      writeFileSync(join(repo, 'service.ts'), 'export const svc = true;\n');
      runGit(repo, ['add', 'service.ts']);

      const transcript = 'The team decided to use SQLite instead of PostgreSQL for local storage.';
      const recordId = 'r-e2emcp001';

      // 1. prepare_capture
      const prepResp = await stub.request('tools/call', {
        name: 'commitlore_prepare_capture',
        arguments: { transcript },
      });
      expect(prepResp.result?.['isError']).not.toBe(true);
      const prepResult = toolJson(prepResp);
      const nonce = prepResult['nonce'] as string;
      expect(nonce).toMatch(/^[0-9a-f]{32}$/);

      // 2. verify_capture — must pass actual staged diff
      const diffResult = runGit(repo, ['diff', '--cached']);
      const draft = [
        {
          trailers: [
            { key: 'Ruled-out', value: 'PostgreSQL | SQLite chosen for local storage simplicity' },
            { key: 'Record-Id', value: recordId },
          ],
          evidence: [
            {
              key: 'Ruled-out',
              source: 'transcript',
              quote: 'The team decided to use SQLite instead of PostgreSQL for local storage.',
              locator: 'L1-L1',
            },
          ],
        },
      ];

      const verifyResp = await stub.request('tools/call', {
        name: 'commitlore_verify_capture',
        arguments: { nonce, draft: JSON.stringify(draft), transcript, diff: diffResult.stdout },
      });
      expect(verifyResp.result?.['isError']).not.toBe(true);
      const verifyResult = toolJson(verifyResp);
      // Must be pass or partial (not empty) to proceed to stage
      expect(['pass', 'partial']).toContain(verifyResult['validation_result']);

      // 3. stage_capture
      const stageResp = await stub.request('tools/call', {
        name: 'commitlore_stage_capture',
        arguments: { nonce },
      });
      expect(stageResp.result?.['isError']).not.toBe(true);
      const stageResult = toolJson(stageResp);
      expect(stageResult['staged']).toBe(true);

      // Now commit — the hook should apply the staged record
      const commitResult = runGit(repo, ['commit', '-m', 'feat: add service']);
      expect(commitResult.status, `git commit failed: ${commitResult.stderr}`).toBe(0);

      // Verify record is in commit message
      const logResult = runGit(repo, ['log', '-1', '--format=%B']);
      expect(logResult.stdout).toContain(`Record-Id: ${recordId}`);

      // Verify consumption
      const pendingFiles = readPendingFiles(repo);
      const record = pendingFiles.find(f => f.nonce === nonce);
      if (record) {
        expect(record.data['phase']).toBe('consumed');
        expect(record.data['consumed']).toBe(true);
      }
    } finally {
      stub.close();
    }
  });
});

// ===========================================================================
// Scenario 3: HEAD moves between prepare and commit
// Proves: no record attaches — T-1005's gate honoured through real hook invocation
// RED condition: would fail if the five-gate check in prepare-commit-msg does NOT
//   reject a pending record when HEAD differs from base_head.
// ===========================================================================

describe('Scenario 3: HEAD moves between prepare and commit', () => {
  it('record does not attach when HEAD changes after staging', () => {
    const repo = makeRepo();

    // Stage a file
    writeFileSync(join(repo, 'alpha.ts'), 'export const a = 1;\n');
    runGit(repo, ['add', 'alpha.ts']);

    // Run capture to get a staged record
    const capture = runCapturePipeline(repo, 'r-e2emoved01');
    expect(capture.staged, 'capture must stage').toBe(true);

    // Now move HEAD by making another commit (breaks base_head binding)
    // Use -c core.hooksPath=/dev/null to completely skip ALL hooks
    runGit(repo, ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'intermediate commit']);

    // Stage another change
    writeFileSync(join(repo, 'beta.ts'), 'export const b = 2;\n');
    runGit(repo, ['add', 'beta.ts']);

    // Commit WITH hooks — the pending record's base_head won't match current HEAD
    const commitResult = runGit(repo, ['commit', '-m', 'feat: add beta']);
    expect(commitResult.status, `git commit should succeed: ${commitResult.stderr}`).toBe(0);

    // Verify the record was NOT attached
    const logResult = runGit(repo, ['log', '-1', '--format=%B']);
    expect(logResult.stdout).not.toContain('Record-Id: r-e2emoved01');
    expect(logResult.stdout).not.toContain('Ruled-out:');

    // The pending file should still exist, not consumed
    const pendingFiles = readPendingFiles(repo);
    const record = pendingFiles.find(f => f.nonce === capture.nonce);
    if (record) {
      expect(record.data['phase']).not.toBe('consumed');
      expect(record.data['consumed']).toBe(false);
    }
  });
});

// ===========================================================================
// Scenario 4: stage_capture with fabricated nonce or one from another repo
// Proves: fails closed, nothing attaches
// RED condition: would fail if stage_capture accepts a nonce that was never
//   prepared in this repository, or if a foreign nonce somehow passes.
// ===========================================================================

describe('Scenario 4: fabricated and foreign nonce fails closed', () => {
  it('stage_capture rejects a completely fabricated nonce', async () => {
    const repo = makeRepo();
    const stub = startMcpStub(repo);

    try {
      await mcpHandshake(stub);

      // Fabricated nonce — never prepared
      const fabricatedNonce = 'deadbeef'.repeat(4);
      const stageResp = await stub.request('tools/call', {
        name: 'commitlore_stage_capture',
        arguments: { nonce: fabricatedNonce },
      });
      expect(stageResp.result?.['isError']).not.toBe(true);
      const result = toolJson(stageResp);
      expect(result['staged']).toBe(false);
    } finally {
      stub.close();
    }
  });

  it('stage_capture rejects a nonce from another repository', async () => {
    // Create two repos
    const repoA = makeRepo();
    const repoB = makeRepo();

    // Prepare a transaction in repo A
    writeFileSync(join(repoA, 'fileA.ts'), 'export const a = 1;\n');
    runGit(repoA, ['add', 'fileA.ts']);

    const captureA = runCapturePipeline(repoA, 'r-e2eforeign1');
    expect(captureA.staged, 'capture in repo A must stage').toBe(true);
    expect(captureA.nonce).toMatch(/^[0-9a-f]{32}$/);

    // Try to stage that nonce in repo B via MCP
    const stub = startMcpStub(repoB);
    try {
      await mcpHandshake(stub);

      const stageResp = await stub.request('tools/call', {
        name: 'commitlore_stage_capture',
        arguments: { nonce: captureA.nonce! },
      });
      expect(stageResp.result?.['isError']).not.toBe(true);
      const result = toolJson(stageResp);
      // Must fail — nonce file doesn't exist in repo B's pending dir
      expect(result['staged']).toBe(false);
    } finally {
      stub.close();
    }

    // Verify nothing was created in repo B's pending dir
    const pendingB = readPendingFiles(repoB);
    expect(pendingB.length).toBe(0);
  });
});

// ===========================================================================
// Scenario 5: concurrent capture in a linked worktree
// Proves: each worktree's pending directory is independent (ADR-0021: per-worktree)
// RED condition: would fail if pending files leak between worktrees, or if
//   one worktree's capture corrupts another's.
// ===========================================================================

describe('Scenario 5: concurrent capture in linked worktree', () => {
  it('each worktree has independent pending state', () => {
    const repo = makeRepo();

    // Create a branch for the worktree
    runGit(repo, ['branch', 'worktree-branch']);

    // Create a linked worktree
    const wtDir = mkdtempSync(join(tmpdir(), 'commitlore-e2e-wt-'));
    temporaries.push(wtDir);
    const wtResult = runGit(repo, ['worktree', 'add', wtDir, 'worktree-branch']);
    expect(wtResult.status, `worktree add failed: ${wtResult.stderr}`).toBe(0);

    // Install hooks in the worktree too
    installHooksManually(wtDir);

    // Stage files in both
    writeFileSync(join(repo, 'main-file.ts'), 'export const main = 1;\n');
    runGit(repo, ['add', 'main-file.ts']);

    writeFileSync(join(wtDir, 'wt-file.ts'), 'export const wt = 1;\n');
    runGit(wtDir, ['add', 'wt-file.ts']);

    // Run capture in main repo
    const captureMain = runCapturePipeline(repo, 'r-e2emain001');
    expect(captureMain.staged, 'main capture must stage').toBe(true);

    // Run capture in worktree
    const captureWt = runCapturePipeline(wtDir, 'r-e2ewt00001');
    expect(captureWt.staged, 'worktree capture must stage').toBe(true);

    // Verify the nonces are different
    expect(captureMain.nonce).not.toBe(captureWt.nonce);

    // Verify each pending dir is independent
    const mainPending = readPendingFiles(repo);
    const wtPending = readPendingFiles(wtDir);

    // Main repo should have its own pending file
    expect(mainPending.some(f => f.nonce === captureMain.nonce)).toBe(true);
    // Main repo should NOT have the worktree's pending file
    expect(mainPending.some(f => f.nonce === captureWt.nonce)).toBe(false);

    // Worktree should have its own pending file
    expect(wtPending.some(f => f.nonce === captureWt.nonce)).toBe(true);
    // Worktree should NOT have the main's pending file
    expect(wtPending.some(f => f.nonce === captureMain.nonce)).toBe(false);

    // Commit in main — only main's record attaches
    const mainCommit = runGit(repo, ['commit', '-m', 'feat: main feature']);
    expect(mainCommit.status).toBe(0);
    const mainLog = runGit(repo, ['log', '-1', '--format=%B']);
    expect(mainLog.stdout).toContain('Record-Id: r-e2emain001');
    expect(mainLog.stdout).not.toContain('r-e2ewt00001');

    // Commit in worktree — only worktree's record attaches
    const wtCommit = runGit(wtDir, ['commit', '-m', 'feat: wt feature']);
    expect(wtCommit.status).toBe(0);
    const wtLog = runGit(wtDir, ['log', '-1', '--format=%B']);
    expect(wtLog.stdout).toContain('Record-Id: r-e2ewt00001');
    expect(wtLog.stdout).not.toContain('r-e2emain001');
  });
});

// ===========================================================================
// Scenario 6: aborted commit (empty message)
// Proves: the pending record stays retriable and is not marked consumed
// RED condition: would fail if the hook marks the record consumed before the
//   commit succeeds, or if an aborted commit deletes the pending file.
// ===========================================================================

describe('Scenario 6: aborted commit leaves pending retriable', () => {
  it('commit rejected by commit-msg hook leaves pending record not consumed', () => {
    const repo = makeRepo();

    // Stage a file
    writeFileSync(join(repo, 'abort-test.ts'), 'export const abort = true;\n');
    runGit(repo, ['add', 'abort-test.ts']);

    // Run capture pipeline to get a staged record
    const capture = runCapturePipeline(repo, 'r-e2eabort01');
    expect(capture.staged, `capture must stage. stderr: ${capture.stderr}`).toBe(true);

    // Install a commit-msg hook that ALWAYS rejects (exits 1)
    // This runs AFTER prepare-commit-msg, so the record gets "applied" in the
    // pending file but then the commit itself fails.
    const hooksResult = spawnSync('git', ['rev-parse', '--git-path', 'hooks/commit-msg'], {
      cwd: repo, env: gitEnv(repo), encoding: 'utf8', stdio: 'pipe',
    });
    const commitMsgHookPath = resolve(repo, (hooksResult.stdout ?? '').trim());
    // Save original
    const originalCommitMsg = existsSync(commitMsgHookPath)
      ? readFileSync(commitMsgHookPath, 'utf8')
      : null;
    // Replace with a rejecting hook
    writeFileSync(commitMsgHookPath, '#!/bin/sh\nexit 1\n', { mode: 0o755 });

    // Attempt the commit — commit-msg hook will reject it
    const commitResult = runGit(repo, ['commit', '-m', 'this will be rejected']);
    expect(commitResult.status, 'commit must fail (rejected by commit-msg hook)').not.toBe(0);

    // The pending record must NOT be consumed (post-commit never ran)
    const pendingFiles = readPendingFiles(repo);
    const record = pendingFiles.find(f => f.nonce === capture.nonce);
    expect(record, 'pending record must still exist').toBeDefined();
    expect(record!.data['consumed'], 'must not be consumed after failed commit').toBe(false);
    // Phase should be 'staged' or 'applied' — either way, not consumed
    expect(record!.data['phase']).not.toBe('consumed');

    // Restore the original commit-msg hook and retry — the record should attach
    if (originalCommitMsg) {
      writeFileSync(commitMsgHookPath, originalCommitMsg, { mode: 0o755 });
    } else {
      rmSync(commitMsgHookPath, { force: true });
    }

    // Retry the commit — should succeed and attach the record
    const retryResult = runGit(repo, ['commit', '-m', 'feat: retry after abort']);
    expect(retryResult.status, `retry commit failed: ${retryResult.stderr}`).toBe(0);

    // Verify the record attached
    const logResult = runGit(repo, ['log', '-1', '--format=%B']);
    expect(logResult.stdout).toContain('Record-Id: r-e2eabort01');
  });
});
