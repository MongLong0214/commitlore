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
const QUOTE_B = 'Keep the retry ceiling at three attempts because more masks real failures';
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

  /**
   * The whole sequence this issue names, through to the commit.
   *
   * prepare → verify A (binds) → verify B (refused) → stage → commit, asserting
   * what the commit carries and what B was told. The earlier cases stop at the
   * stage call; this is the only place the actual hazard — "the commit carries A
   * while B was told it got nothing" — is observed rather than argued.
   *
   * It also pins where the guard reaches, which a first draft of this test had
   * wrong. The guard is keyed on *the connection that verified*, so B verifying
   * and then staging on its own connection is refused even though B reconnected
   * after A. The bypass needs a connection that never verified the nonce at all
   * — a third one here — and that is the case the naming is for: the stage
   * succeeds, and the answer says whose record is waiting.
   */
  it('refuses B on its own connection, and names A when a third connection stages', async () => {
    const dir = repo('sequence');
    const first = await connect(dir);
    const nonce = await prepared(first);

    // A binds.
    const boundA = await call(first, 'commitlore_verify_capture', {
      nonce,
      draft: draftFor(QUOTE_A, 'r-calleraaa01'),
      transcript: TRANSCRIPT,
      diff: stagedDiff(dir),
    });
    expect(boundA, `A did not bind: ${boundA.slice(0, 300)}`).toMatch(/"validation_result":\s*"pass"/);

    // B arrives on its own connection and is refused: the nonce already holds a
    // verification, and this one binds nothing.
    const second = await connect(dir);
    const refusedB = await call(second, 'commitlore_verify_capture', {
      nonce,
      draft: draftFor(QUOTE_B, 'r-callerbbb01'),
      transcript: TRANSCRIPT,
      diff: stagedDiff(dir),
    });
    expect(refusedB).not.toMatch(/"validation_result":\s*"pass"/);
    expect(refusedB, 'B must be told nothing of its own was accepted').toMatch(/"accepted":\s*\[\]/);

    // B stages on the connection it was refused on: the guard applies.
    const refusedStage = await call(second, 'commitlore_stage_capture', { nonce });
    expect(refusedStage).toMatch(/"staged":\s*false/);
    expect(refusedStage).toMatch(/not yours to stage/);

    // A third connection has never verified this nonce, so the guard has nothing
    // to go on and the legacy path stands. This is the documented bypass.
    const third = await connect(dir);
    const staged = await call(third, 'commitlore_stage_capture', { nonce });
    expect(staged).toMatch(/"staged":\s*true/);
    expect(
      staged,
      'a stage that succeeded must name what it staged, or nobody can tell whose it is',
    ).toMatch(/r-calleraaa01/);
    expect(staged, "and it must not claim B's record").not.toMatch(/r-callerbbb01/);

    // The commit. This is the part the earlier cases never reached.
    // The fixture set user.name/user.email in the repository itself, so the
    // commit needs no identity flags -- and must run the hooks, because the
    // hook is what attaches the staged record.
    git(dir, ['commit', '-q', '-m', 'feat: the change B thought it was recording']);
    const message = git(dir, ['log', '-1', '--format=%B']);

    expect(message, "the commit carries A's record").toContain('r-calleraaa01');
    expect(message, "and never B's, which was refused").not.toContain('r-callerbbb01');
  }, 180_000);
});

/**
 * #1005 step 1, on the surface a host actually sees.
 *
 * The unit test beside this (`test/verify-receipt.test.ts`) pins that a binding
 * verification is issued a receipt and a refused one is not. What it cannot pin
 * is that the receipt reaches the caller: that crosses the MCP boundary, and a
 * field computed correctly and then dropped from the response would satisfy the
 * unit test exactly.
 *
 * Steps 2 and 3 both rest on the caller *having* this value, so the moment it
 * stops arriving the migration has nothing to build on.
 */
describe('#1005 verify_capture hands the receipt to the caller that earned it', () => {
  it('returns a receipt when the verification bound records', async () => {
    const dir = repo('receipt-ok');
    const stub = await connect(dir);
    const nonce = await prepared(stub);

    const verified = await call(stub, 'commitlore_verify_capture', {
      nonce,
      draft: draftFor(QUOTE_A, 'r-receiptaa01'),
      transcript: TRANSCRIPT,
      diff: stagedDiff(dir),
    });
    expect(verified).toMatch(/"validation_result":\s*"pass"/);

    const receipt = /"receipt"\s*:\s*"([0-9a-f]{32})"/.exec(verified)?.[1];
    expect(receipt, `no receipt in the response: ${verified.slice(0, 400)}`).toBeTypeOf('string');
    // Not the nonce. A receipt equal to it would be no identity at all, since
    // every caller that can stage already holds the nonce.
    expect(receipt).not.toBe(nonce);
  }, 180_000);

  it('returns none to a second caller, which bound nothing', async () => {
    // The half that makes the field worth anything, and the case #989 is about.
    //
    // Written the obvious way first and it was wrong: a draft whose evidence is
    // not in the transcript still *binds* the transaction, to an empty result,
    // and is correctly issued a receipt. A receipt says "you bound this
    // transaction", not "your records were accepted" -- which is why #989's own
    // guard is keyed on `accepted.length > 0`, not on whether the store
    // succeeded. The caller that must come away empty-handed is the **second**
    // one, whose verification finds the transaction already bound.
    const dir = repo('receipt-second');
    const stub = await connect(dir);
    const nonce = await prepared(stub);

    const first = await call(stub, 'commitlore_verify_capture', {
      nonce,
      draft: draftFor(QUOTE_A, 'r-firstbind01'),
      transcript: TRANSCRIPT,
      diff: stagedDiff(dir),
    });
    expect(first).toMatch(/"receipt"/);

    const second = await call(stub, 'commitlore_verify_capture', {
      nonce,
      draft: draftFor(QUOTE_B, 'r-secondbind1'),
      transcript: TRANSCRIPT,
      diff: stagedDiff(dir),
    });
    expect(second, 'the second verification replaced the first').not.toMatch(/"validation_result":\s*"pass"/);
    expect(second, 'a caller that bound nothing was handed a receipt').not.toMatch(/"receipt"/);
  }, 180_000);
});

/**
 * #1005 step 2, across the protocol boundary.
 *
 * The unit tests reach `stageCaptureRecord` directly, so they cannot see the
 * argument being dropped between the tool schema and the call — a `receipt`
 * declared in the schema and never read would satisfy every one of them while
 * checking nothing. Step 3 turns this argument into the gate, so it has to
 * actually arrive.
 */
describe('#1005 stage_capture checks a receipt sent over the protocol', () => {
  it('stages when the receipt is the one verify_capture returned', async () => {
    // The control: the same sequence with the right value must still work, or
    // the refusal below proves nothing.
    const dir = repo('stage-receipt-ok');
    const stub = await connect(dir);
    const nonce = await prepared(stub);

    const verified = await call(stub, 'commitlore_verify_capture', {
      nonce,
      draft: draftFor(QUOTE_A, 'r-stagegood01'),
      transcript: TRANSCRIPT,
      diff: stagedDiff(dir),
    });
    const receipt = /"receipt"\s*:\s*"([0-9a-f]{32})"/.exec(verified)?.[1];
    expect(receipt, `no receipt to present: ${verified.slice(0, 300)}`).toBeTypeOf('string');

    const staged = await call(stub, 'commitlore_stage_capture', { nonce, receipt });
    expect(staged).toMatch(/"staged":\s*true/);
  }, 180_000);

  it('refuses a receipt it never issued', async () => {
    const dir = repo('stage-receipt-bad');
    const stub = await connect(dir);
    const nonce = await prepared(stub);

    const verified = await call(stub, 'commitlore_verify_capture', {
      nonce,
      draft: draftFor(QUOTE_A, 'r-stagebad001'),
      transcript: TRANSCRIPT,
      diff: stagedDiff(dir),
    });
    const receipt = /"receipt"\s*:\s*"([0-9a-f]{32})"/.exec(verified)?.[1];
    expect(receipt).toBeTypeOf('string');

    // Shaped like one and never issued.
    const refused = await call(stub, 'commitlore_stage_capture', {
      nonce,
      receipt: '0'.repeat(32),
    });
    expect(refused).toMatch(/receipt presented was not issued/);
    expect(refused).not.toMatch(/"staged":\s*true/);
    // And it does not echo what the caller failed to prove it held.
    expect(refused).not.toContain(receipt as string);

    // The transaction survived the refusal, so the caller that does hold the
    // receipt can still stage. A refusal that consumed it would be a denial of
    // service dressed as a check.
    const staged = await call(stub, 'commitlore_stage_capture', { nonce, receipt });
    expect(staged).toMatch(/"staged":\s*true/);
  }, 180_000);
});
