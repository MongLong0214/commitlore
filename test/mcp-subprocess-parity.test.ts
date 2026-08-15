/**
 * The two routes, measured as two processes.
 *
 * Every earlier parity check called both surfaces inside one process, which
 * cannot see the failure that actually happened: #660 found four installations
 * at once, three reporting `0.8.0`, and a session reconnecting through the
 * plugin talked to a different binary than the terminal did. A test that
 * imports both routes from the same module graph proves they agree with
 * themselves.
 *
 * So this spawns the built bundle as an MCP server, asks it a question over
 * stdio, asks the CLI the same question in its own process, and compares the
 * answers — including which build produced each.
 *
 * The last two assertions are the product's claim rather than an
 * implementation detail: a partial answer says it is partial, and a record the
 * two routes share is graded the same by both. If either fails, an agent acting
 * on the answer is acting on something the repository did not say.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestRepo } from './git-fixtures.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(PACKAGE_ROOT, 'dist', 'commitlore.mjs');
const PATH_UNDER_TEST = 'a.txt';

/**
 * A repository small enough that neither route runs out of scan budget. This
 * repository itself has ~1k unread commits, so both routes answer with nothing
 * and there is no shared record left to compare — the comparison would pass by
 * being empty, which is the failure mode this file exists to catch.
 */
const fixtureRepo = (): string => {
  const dir = createTestRepo({ path: mkdtempSync(join(tmpdir(), 'cl-parity-')) });
  writeFileSync(join(dir, 'a.txt'), 'a\n', 'utf8');
  execFileSync('git', ['add', 'a.txt'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  execFileSync(
    'git',
    ['commit', '--quiet', '--no-verify', '-m',
      ['Seed', '', 'Limit: one writer', 'Blast: local', 'Undo: easy', 'Certainty: firm',
       'Provenance: authored', 'Record-Id: r-parity1'].join('\n')],
    { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  return dir;
};

let repo: string | undefined;

interface Answer {
  runtime?: { version?: string; build_id?: string };
  coverage?: string;
  records?: { trailers?: { key: string; value: string }[]; sha?: string; trust?: string }[];
}

let server: ChildProcess | undefined;
let overMcp: Answer | undefined;
let overCli: Answer | undefined;

/** One JSON-RPC exchange over stdio, resolved by matching response id. */
const ask = (child: ChildProcess, requests: unknown[], settleMs: number): Promise<Record<string, unknown>[]> =>
  new Promise((resolve) => {
    const seen: Record<string, unknown>[] = [];
    let buffered = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString();
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line.trim() !== '') {
          try {
            seen.push(JSON.parse(line) as Record<string, unknown>);
          } catch {
            // Not every line a server writes is a response; the ones that
            // matter parse, and the rest are diagnostics.
          }
        }
        newline = buffered.indexOf('\n');
      }
    });
    for (const request of requests) child.stdin?.write(`${JSON.stringify(request)}\n`);
    setTimeout(() => resolve(seen), settleMs);
  });

/**
 * A non-zero exit is not always a failed answer: exit 3 means the index was
 * incomplete, and the command still printed a well-formed, honestly-degraded
 * result. Treating that as a crash is the same mistake as reading a partial
 * answer as a complete one, in the other direction.
 */
const cliAnswer = (cwd: string): Answer => {
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, [BUNDLE, 'limits', '--json', PATH_UNDER_TEST], {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const printed = (error as { stdout?: string }).stdout;
    if (typeof printed !== 'string' || printed.trim() === '') throw error;
    stdout = printed;
  }
  return JSON.parse(stdout) as Answer;
};

/** `Record-Id` plus the commit it came from — identity that survives rendering. */
const identify = (record: NonNullable<Answer['records']>[number]): string => {
  const id = record.trailers?.find((trailer) => trailer.key === 'Record-Id')?.value ?? '(none)';
  return `${id}@${String(record.sha).slice(0, 12)}`;
};

beforeAll(async () => {
  if (!existsSync(BUNDLE)) return;
  repo = fixtureRepo();
  server = spawn(process.execPath, [BUNDLE, 'mcp'], {
    cwd: repo,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const responses = await ask(
    server,
    [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'parity', version: '0' } },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'commitlore_query', arguments: { kind: 'limits', path: PATH_UNDER_TEST } },
      },
    ],
    6_000,
  );

  const call = responses.find((response) => response['id'] === 2);
  const result = call?.['result'] as { content?: { text?: string }[] } | undefined;
  const text = result?.content?.[0]?.text;
  if (typeof text === 'string') overMcp = JSON.parse(text) as Answer;
  overCli = cliAnswer(repo);
}, 90_000);

afterAll(() => {
  server?.kill('SIGKILL');
  if (repo !== undefined) rmSync(repo, { recursive: true, force: true });
});

describe('#631 the built server and the built CLI, as separate processes', () => {
  it('both answer, and both name the build that answered', () => {
    expect(existsSync(BUNDLE), 'this measures the built bundle; run npm run build first').toBe(true);
    expect(overMcp, 'the MCP server returned no parseable answer').toBeDefined();
    expect(overCli, 'the CLI returned no parseable answer').toBeDefined();

    expect(overMcp?.runtime?.version).toBe(overCli?.runtime?.version);
    expect(overMcp?.runtime?.build_id, 'one bundle answered both questions').toBe(overCli?.runtime?.build_id);
    expect(overMcp?.runtime?.build_id, 'and it is a digest, not a path').toMatch(/^[0-9a-f]{12}$|^unknown$/);
  });

  it('carries no absolute local path in either answer', () => {
    for (const [route, answer] of [['mcp', overMcp], ['cli', overCli]] as const) {
      const serialized = JSON.stringify(answer ?? {});
      expect(serialized, `${route} leaked a home directory`).not.toMatch(/"\/(Users|home)\//);
      expect(serialized, `${route} leaked the package root`).not.toContain(PACKAGE_ROOT);
      expect(serialized, `${route} leaked the repository path`).not.toContain(repo ?? '\u0000');
    }
  });

  // The claim this product makes. A record both routes returned must be graded
  // identically by both, or an agent's answer depends on which surface it asked.
  it('grades every shared record identically', () => {
    const cliTrust = new Map((overCli?.records ?? []).map((record) => [identify(record), record.trust]));
    const shared = (overMcp?.records ?? []).filter((record) => cliTrust.has(identify(record)));

    expect(shared.length, 'the two routes returned no record in common to compare').toBeGreaterThan(0);
    for (const record of shared) {
      expect(record.trust, `${identify(record)} is graded differently depending on which route asked`).toBe(
        cliTrust.get(identify(record)),
      );
    }
  });

  // A short answer must say it is short. The MCP route stops at
  // CONSUMER_SCAN_BUDGET_MS and the CLI does not, so on a repository this size
  // they legitimately differ in length — what must never differ is whether the
  // answer admits it.
  it('states coverage on both routes, and never calls a partial answer complete', () => {
    for (const [route, answer] of [['mcp', overMcp], ['cli', overCli]] as const) {
      expect(answer?.coverage, `${route} answered without stating coverage`).toMatch(/^(complete|partial)$/);
    }

    const mcpCount = overMcp?.records?.length ?? 0;
    const cliCount = overCli?.records?.length ?? 0;
    if (mcpCount < cliCount) {
      expect(
        overMcp?.coverage,
        'the MCP route returned fewer records than the CLI and still called itself complete',
      ).toBe('partial');
    }
  });

  it('leaves no server process behind', () => {
    server?.kill('SIGKILL');
    expect(server?.killed, 'the spawned server must be reapable').toBe(true);
  });
});
