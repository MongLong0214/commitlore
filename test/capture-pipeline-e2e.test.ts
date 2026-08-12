/**
 * End-to-end: a decision goes in through the MCP tools an agent actually calls,
 * and comes back out of git.
 *
 * Every other suite tests a part. This asserts the product's whole claim, with
 * the real built server running as a child process and a real repository with
 * real hooks underneath it: prepare → verify → stage → commit → read it back.
 *
 * **The one thing it cannot include** is the model's judgement — deciding that a
 * change is worth recording at all. That needs a live agent, an API key and
 * money per run, and is not reproducible. It is exercised by hand before a
 * release. Everything downstream of the decision is here, on every push.
 *
 * The split changes what a failure means: here it is a product defect; there it
 * is either that or a model that judged differently.
 *
 * A previous attempt at this suite drove the server with `spawnSync`, writing
 * all frames and closing stdin. The server read that EOF as the client hanging
 * up and exited before answering, and a missing response looks exactly like a
 * rejected draft — so the case asserting "a fabricated quote is refused" passed
 * without anything being refused. The client is persistent for that reason, and
 * the assertions below check what landed in git rather than what a tool said.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { startStub, type Stub } from './mcp-client.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The artifact a user installs, not a re-compiled copy of the sources. */
const CLI = join(REPO_ROOT, 'dist', 'commitlore.mjs');

const scratch: string[] = [];
const running: Stub[] = [];
afterAll(async () => {
  for (const stub of running) await stub.close();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: string[], stdin?: string): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    ...(stdin === undefined ? {} : { input: stdin }),
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'E2E',
      GIT_AUTHOR_EMAIL: 'e2e@example.invalid',
      GIT_COMMITTER_NAME: 'E2E',
      GIT_COMMITTER_EMAIL: 'e2e@example.invalid',
    },
  });

const cli = (cwd: string, args: string[]): { out: string; status: number } => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status ?? 1 };
};

/**
 * A repository as `commitlore init` leaves one. `realpathSync` because macOS
 * resolves /tmp through a symlink, and a path mismatch here produces failures
 * that read as product defects.
 */
const repo = (name: string): string => {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), `commitlore-e2e-${name}-`)));
  scratch.push(dir);
  git(dir, ['init', '-q', '.']);
  git(dir, ['config', 'user.email', 'e2e@example.invalid']);
  git(dir, ['config', 'user.name', 'E2E']);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.js'), 'export const run = (x) => x;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--no-verify', '-m', 'feat: initial']);
  // 1 means "ran, something needs you" — a fresh fixture has no remote, so the
  // notes-refspec check warns. 2 would mean a step could not run at all.
  expect(cli(dir, ['init', '--unattended']).status).toBeLessThanOrEqual(1);
  return dir;
};

const connect = async (cwd: string): Promise<Stub> => {
  const stub = startStub(cwd, CLI, ['mcp']);
  running.push(stub);
  const initialized = await stub.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1' },
  });
  expect(initialized.error, `initialize failed: ${JSON.stringify(initialized.error)}`).toBeUndefined();
  stub.notify('notifications/initialized');
  return stub;
};

const text = (response: { result?: Record<string, unknown> }): string => {
  const content = response.result?.['content'] as { text?: string }[] | undefined;
  return content?.map((c) => c.text ?? '').join('') ?? '';
};

const call = async (stub: Stub, name: string, args: Record<string, unknown>): Promise<string> => {
  const response = await stub.request('tools/call', { name, arguments: args });
  // An error here is a protocol failure and must not be read as "nothing was
  // captured" — the confusion that made the earlier attempt pass vacuously.
  expect(response.error, `${name} returned a protocol error: ${JSON.stringify(response.error)}`).toBeUndefined();
  return text(response);
};

const trailers = (dir: string, key: string): string[] =>
  git(dir, ['log', '--format=%B'])
    .split('\n')
    .filter((line) => line.startsWith(`${key}: `))
    .map((line) => line.slice(key.length + 2));

const TRANSCRIPT =
  'We decided to return null instead of throwing from run, because run is called in a hot loop ' +
  'and the exception cost showed up in profiling. We ruled out throwing for that reason.';

const draftFor = (quote: string): unknown[] => [
  {
    trailers: [
      {
        key: 'Ruled-out',
        value: 'throwing from run | run is called in a hot loop and the exception cost showed up in profiling',
      },
    ],
    evidence: [{ key: 'Ruled-out', source: 'transcript', quote, locator: 'L1' }],
  },
];

describe('a decision recorded through the MCP tools reaches the next agent', () => {
  it('carries it into the commit and back out of git', async () => {
    const dir = repo('happy');
    writeFileSync(join(dir, 'src', 'app.js'), 'export const run = (x) => (x == null ? null : x);\n');
    git(dir, ['add', '-A']);
    const staged = git(dir, ['diff', '--cached']);

    const stub = await connect(dir);
    const prepared = await call(stub, 'commitlore_prepare_capture', {
      transcript: TRANSCRIPT,
      unattended: true,
    });
    const nonce = /"nonce"\s*:\s*"([0-9a-f]{32})"/.exec(prepared)?.[1];
    expect(nonce, `prepare returned no nonce:\n${prepared}`).toBeDefined();

    const verified = await call(stub, 'commitlore_verify_capture', {
      nonce,
      draft: JSON.stringify(draftFor('run is called in a hot loop')),
      transcript: TRANSCRIPT,
      diff: staged,
    });
    expect(verified).toContain('"validation_result"');
    expect(verified, `verify rejected the draft:\n${verified}`).not.toMatch(/"validation_result":\s*"empty"/);

    await call(stub, 'commitlore_stage_capture', { nonce });

    git(dir, ['commit', '-q', '--no-verify', '-m', 'feat: return null instead of throwing']);

    // What landed in git, not what a tool reported.
    expect(trailers(dir, 'Provenance')).toContain('drafted');
    const ids = trailers(dir, 'Record-Id');
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^r-[a-z0-9]{6,}$/);

    // And it reaches whoever edits that path next.
    expect(cli(dir, ['context', 'src/app.js']).out).toContain('hot loop');
  }, 180_000);

  it('leaves no record when the evidence is not in the transcript', async () => {
    // The property the pipeline rests on. Asserted at the commit, because that
    // is where a fabricated citation would do its damage.
    const dir = repo('fabricated');
    writeFileSync(join(dir, 'src', 'app.js'), 'export const run = (x) => x + 1;\n');
    git(dir, ['add', '-A']);
    const staged = git(dir, ['diff', '--cached']);

    const stub = await connect(dir);
    const prepared = await call(stub, 'commitlore_prepare_capture', {
      transcript: TRANSCRIPT,
      unattended: true,
    });
    const nonce = /"nonce"\s*:\s*"([0-9a-f]{32})"/.exec(prepared)?.[1];
    expect(nonce).toBeDefined();

    const verified = await call(stub, 'commitlore_verify_capture', {
      nonce,
      draft: JSON.stringify(draftFor('the vendor rate-limits bursts, which nobody said')),
      transcript: TRANSCRIPT,
      diff: staged,
    });
    // Refused, and visibly so — not merely absent.
    expect(verified).toMatch(/"validation_result":\s*"empty"/);
    // Refused for the right reason: a quote nobody said, not a source mismatch.
    expect(verified, `rejected for the wrong reason:
${verified}`).toMatch(/evidence-not-found|not found in/);

    await call(stub, 'commitlore_stage_capture', { nonce });
    git(dir, ['commit', '-q', '--no-verify', '-m', 'feat: increment']);

    expect(trailers(dir, 'Record-Id')).toEqual([]);
  }, 180_000);

  it('tells every host both halves of the protocol on initialize', async () => {
    // The read half alone left four of the seven wired hosts holding the
    // capture tools with nothing saying what they were for.
    const dir = repo('instructions');
    const stub = startStub(dir, CLI, ['mcp']);
    running.push(stub);
    const initialized = await stub.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1' },
    });

    const instructions = String(initialized.result?.['instructions'] ?? '');
    expect(instructions).toContain('commitlore://context/');
    expect(instructions).toContain('commitlore_prepare_capture');
    expect(instructions).toContain('commitlore_verify_capture');
    expect(instructions).toContain('commitlore_stage_capture');
  }, 180_000);

  it('does not stage an earlier record when a replay cannot be stored', async () => {
    // The atomicity invariant: what stages is what was just verified. A replay
    // through an early exit must not leave the first call's record stageable.
    const dir = repo('replay');
    writeFileSync(join(dir, 'src', 'app.js'), 'export const run = (x) => (x == null ? null : x);\n');
    git(dir, ['add', '-A']);
    const staged = git(dir, ['diff', '--cached']);

    const stub = await connect(dir);
    const prepared = await call(stub, 'commitlore_prepare_capture', {
      transcript: TRANSCRIPT,
      unattended: true,
    });
    const nonce = /"nonce"\s*:\s*"([0-9a-f]{32})"/.exec(prepared)?.[1];

    await call(stub, 'commitlore_verify_capture', {
      nonce,
      draft: JSON.stringify(draftFor('run is called in a hot loop')),
      transcript: TRANSCRIPT,
      diff: staged,
    });

    // Same nonce, a transcript that no longer matches what prepare recorded.
    const replay = await call(stub, 'commitlore_verify_capture', {
      nonce,
      draft: JSON.stringify(draftFor('run is called in a hot loop')),
      transcript: `${TRANSCRIPT} And a sentence nobody said.`,
      diff: staged,
    });
    expect(replay).toMatch(/"validation_result":\s*"empty"/);
    expect(replay).toMatch(/"incomplete":\s*true/);
  }, 180_000);
});
