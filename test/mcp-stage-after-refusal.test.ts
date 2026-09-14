/**
 * A connection that verified a nonce without binding anything cannot stage it.
 *
 * `stage_capture` reads the transaction *stored* under the nonce, never what
 * the calling verification computed — deliberately, because the tool is handed
 * the nonce and nothing else, so a caller cannot smuggle a diff hash or a
 * policy identity past the server-side bindings.
 *
 * The consequence was not deliberate. There is no caller identity in the
 * protocol and no previous-call-success check, so a caller whose verification
 * was refused could stage anyway, and the prepare-commit-msg hook would append
 * the **first** caller's records — a record the second caller was never shown.
 * Knowing the nonce was enough.
 *
 * ## What closes it here, and what does not
 *
 * The server now remembers, per connection, which nonces its own verifications
 * failed to bind, and refuses to stage those. That closes the ordinary case:
 * one logical caller on one stdio connection, verifying and then staging.
 *
 * It is a mitigation and not the closure, and the limits are load-bearing
 * rather than caveats:
 *
 *  - a reconnection starts with an empty set and bypasses it;
 *  - a nonce this connection never verified keeps the legacy behaviour;
 *  - two logical callers sharing one connection cannot be told apart.
 *
 * Closing it properly needs a receipt issued by the verification that succeeded
 * and required at stage. That is a pending-format version bump, and existing
 * readers reject anything but version 1 — writing version 2 would strand the
 * running sessions a staged migration exists to protect. It is a release
 * sequence, planned on #989.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { startStub, type Stub } from './mcp-client.js';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(REPO_ROOT, 'dist', 'commitlore.mjs');

const scratch: string[] = [];
const running: Stub[] = [];
afterAll(async () => {
  for (const stub of running) await stub.close();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (dir: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });

const TRANSCRIPT =
  'We decided: Do not use shared mutable state for config because it causes race conditions. ' +
  'We also decided: Keep the retry ceiling at three attempts because more masks real failures.';
const QUOTE_A = 'Do not use shared mutable state for config because it causes race conditions';
const UNSAID = 'a sentence that appears nowhere in this transcript at all';

const draftFor = (quote: string, recordId: string): string =>
  JSON.stringify({
    records: [
      {
        trailers: [
          { key: 'Limit', value: quote },
          { key: 'Record-Id', value: recordId },
        ],
        evidence: [{ key: 'Limit', source: 'transcript', quote, locator: 'L1-L2' }],
      },
    ],
  });

const repo = (name: string): string => {
  const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), `commitlore-refuse-${name}-`)));
  scratch.push(dir);
  git(dir, ['init', '-q', '.']);
  git(dir, ['config', 'user.email', 'e2e@example.invalid']);
  git(dir, ['config', 'user.name', 'E2E']);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.js'), 'export const run = (x) => x;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--no-verify', '-m', 'feat: initial']);
  spawnSync(process.execPath, [CLI, 'init', '--unattended'], { cwd: dir, encoding: 'utf8' });
  // Something staged, so a capture has a diff to bind to.
  writeFileSync(join(dir, 'src', 'app.js'), 'export const run = (x) => (x == null ? null : x);\n');
  git(dir, ['add', '-A']);
  return dir;
};

const connect = async (cwd: string): Promise<Stub> => {
  const stub = startStub(cwd, CLI, ['mcp']);
  running.push(stub);
  const initialized = await stub.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'refusal', version: '1' },
  });
  expect(initialized.error, `initialize failed: ${JSON.stringify(initialized.error)}`).toBeUndefined();
  stub.notify('notifications/initialized');
  return stub;
};

const call = async (stub: Stub, name: string, args: Record<string, unknown>): Promise<string> => {
  const response = await stub.request('tools/call', { name, arguments: args });
  const content = (response.result as { content?: { text?: string }[] } | undefined)?.content;
  return content?.[0]?.text ?? JSON.stringify(response.error ?? {});
};

const prepared = async (stub: Stub): Promise<string> => {
  const text = await call(stub, 'commitlore_prepare_capture', {
    transcript: TRANSCRIPT,
    unattended: true,
  });
  const nonce = /"nonce"\s*:\s*"([0-9a-f]{32})"/.exec(text)?.[1];
  expect(nonce, `prepare did not return a nonce: ${text.slice(0, 300)}`).toBeTypeOf('string');
  return nonce as string;
};

const stagedDiff = (dir: string): string => git(dir, ['diff', '--cached']);

describe('#989 a refused connection cannot stage the nonce', () => {
  it('stages when its own verification bound a record', async () => {
    // The control. Without it, "it refused" below could mean the fixture never
    // had anything stageable.
    const dir = repo('ok');
    const stub = await connect(dir);
    const nonce = await prepared(stub);

    const verified = await call(stub, 'commitlore_verify_capture', {
      nonce,
      draft: draftFor(QUOTE_A, 'r-boundaaa001'),
      transcript: TRANSCRIPT,
      diff: stagedDiff(dir),
    });
    expect(verified).toMatch(/"validation_result":\s*"pass"/);

    const staged = await call(stub, 'commitlore_stage_capture', { nonce });
    expect(staged).toMatch(/"staged":\s*true/);
  }, 180_000);

  it('refuses to stage a nonce whose verification bound nothing', async () => {
    const dir = repo('refused');
    const stub = await connect(dir);
    const nonce = await prepared(stub);

    // A draft whose evidence is not in the transcript: the ordinary, correct
    // refusal. Nothing of this caller's is stored.
    const refused = await call(stub, 'commitlore_verify_capture', {
      nonce,
      draft: draftFor(UNSAID, 'r-unfoundaa01'),
      transcript: TRANSCRIPT,
      diff: stagedDiff(dir),
    });
    expect(refused).not.toMatch(/"validation_result":\s*"pass"/);

    const staged = await call(stub, 'commitlore_stage_capture', { nonce });
    expect(staged).toMatch(/"staged":\s*false/);
    // And it says why, rather than reusing the generic "nothing to stage".
    expect(staged).toMatch(/not yours to stage/);
  }, 180_000);

  it('refuses after a verification that threw before it could bind', async () => {
    // A malformed draft throws before `verifyCaptureRecords` runs at all. The
    // nonce is marked before the work starts precisely so this path counts:
    // nothing of this caller's was stored here either.
    //
    // Not a control for the guard, and saying so matters. A throw leaves the
    // transaction `prepared`, and `stageCaptureRecord` already refuses any
    // phase but `verified` — so this passes with the guard removed. It is here
    // because the marking-before-the-work choice is deliberate and would
    // otherwise be untested; the case above is the one that goes red without
    // the guard.
    const dir = repo('threw');
    const stub = await connect(dir);
    const nonce = await prepared(stub);

    const broke = await call(stub, 'commitlore_verify_capture', {
      nonce,
      draft: 'this is not JSON at all',
      transcript: TRANSCRIPT,
      diff: stagedDiff(dir),
    });
    expect(broke).toMatch(/malformed/i);

    const staged = await call(stub, 'commitlore_stage_capture', { nonce });
    expect(staged).toMatch(/"staged":\s*false/);
  }, 180_000);
});
