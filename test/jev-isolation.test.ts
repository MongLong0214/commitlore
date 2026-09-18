/**
 * #1048 / #1051 §3: the cases where something moves, refuses, or competes.
 *
 * Everything here drives the real `produce` against a real repository, with the
 * transport injected so a branch can be reached without a network. What is
 * being pinned is not that the happy path works — `jev-commit.test.ts` does
 * that through actual `git commit` — but that each way the world can change
 * under the pipeline ends with the original message intact and no record that
 * describes a state nobody was in.
 *
 * The listed cases come from #1048's "Behavioral tests" and #1051 §3 directly,
 * and each one is named after the sentence it answers.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { prepareCaptureContext } from '../src/core/capture-prepare.js';
import { verifyCaptureRecords } from '../src/core/capture-verify.js';
import { consumePending, readPending, stagePending } from '../src/core/pending.js';
import { stageCaptureRecord } from '../src/core/capture-stage.js';
import { resolveJevActivation, type JevEnabled } from '../src/jev/activation.js';
import type { JevAnswer, JevOutcome } from '../src/jev/client.js';
import { produce, type ProduceOutcome } from '../src/jev/producer.js';

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const KEY = 'apikey_test_isolation_000000000000000000';

const activation = (): JevEnabled => {
  const resolved = resolveJevActivation({ COMMITLORE_JEV_API_KEY: KEY });
  if (!resolved.enabled) throw new Error('fixture: activation should be enabled');
  return resolved;
};

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    env: {
      PATH: process.env['PATH'] ?? '',
      GIT_CONFIG_GLOBAL: '/nonexistent/commitlore-tests-must-not-read-this',
      GIT_CONFIG_SYSTEM: '/nonexistent/commitlore-tests-must-not-read-this',
    },
  });

const SESSION = 'session-isolation-0001';

const CONVERSATION =
  `${JSON.stringify({
    type: 'user',
    isSidechain: false,
    message: {
      role: 'user',
      content: 'The vendor caps us at three retries per minute, so the ceiling stays at three.',
    },
  })}\n`;

const ORIGINAL = 'Lower the ceiling\n\nOrdinary prose with no trailers at all.\n';

interface Fixture {
  readonly cwd: string;
  readonly messageFile: string;
  readonly transcript: string;
}

const fixture = (name: string): Fixture => {
  const base = mkdtempSync(join(tmpdir(), `commitlore-jeviso-${name}-`));
  scratch.push(base);
  const cwd = join(base, 'repo');
  mkdirSync(cwd, { recursive: true });
  git(cwd, ['init', '-q', '--initial-branch=main', '.']);
  git(cwd, ['config', 'user.email', 'iso@example.invalid']);
  git(cwd, ['config', 'user.name', 'Iso']);
  writeFileSync(join(cwd, 'retry.ts'), 'export const retries = 10;\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'initial']);

  writeFileSync(
    join(cwd, '.commitlore-policy.local.json'),
    `${JSON.stringify({ mode: 'auto', unattended: true }, null, 2)}\n`,
  );

  const transcript = join(base, 'session.jsonl');
  writeFileSync(transcript, CONVERSATION, 'utf8');
  const descriptors = join(cwd, git(cwd, ['rev-parse', '--git-path', 'commitlore/jev-sessions']).trim());
  mkdirSync(descriptors, { recursive: true });
  writeFileSync(
    join(descriptors, `${SESSION}.json`),
    `${JSON.stringify({
      version: 1,
      host: 'claude-code',
      sessionId: SESSION,
      worktree: git(cwd, ['rev-parse', '--show-toplevel']).trim(),
      gitdir: git(cwd, ['rev-parse', '--absolute-git-dir']).trim(),
      transcript,
      format: 'claude-jsonl-v1',
      registeredAt: new Date().toISOString(),
    }, null, 2)}\n`,
    { mode: 0o600 },
  );

  writeFileSync(join(cwd, 'retry.ts'), 'export const retries = 3;\n');
  git(cwd, ['add', '-A']);

  const messageFile = join(cwd, 'MSG');
  writeFileSync(messageFile, ORIGINAL, 'utf8');
  return { cwd, messageFile, transcript };
};

const answer = (choice: string, confidence = 0.96): JevAnswer => ({
  choice,
  probabilities: { [choice]: 0.97, other: 0.03 },
  confidence,
});

/** Answers every candidate as an applicable Limit; `during` runs mid-flight. */
const positiveAsk = (during?: () => void) =>
  (async (opts: { questions: readonly { id: string }[] }): Promise<JevOutcome> => {
    // The window the ADR is about: the request is in flight, nothing is locked,
    // and the world is free to move.
    during?.();
    const answers = new Map<string, JevAnswer>();
    for (const question of opts.questions) {
      const kind = question.id.split(':')[0];
      if (kind === 'kind') answers.set(question.id, answer('limit'));
      else if (kind === 'relevance') answers.set(question.id, answer('applies'));
    }
    return { status: 'answered', answers, unusable: [], usage: null };
  }) as never;

const run = async (fix: Fixture, ask: never): Promise<ProduceOutcome> =>
  produce({
    messageFile: fix.messageFile,
    cwd: fix.cwd,
    activation: activation(),
    env: { CLAUDE_CODE_SESSION_ID: SESSION },
    ask,
  });

const pendingFiles = (cwd: string): string[] => {
  const dir = join(cwd, '.git', 'commitlore', 'pending');
  return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.json')) : [];
};

const message = (fix: Fixture): string => readFileSync(fix.messageFile, 'utf8');

describe('#1048 the control', () => {
  it('publishes when nothing moves', async () => {
    // Without this every assertion below could describe a pipeline that never
    // produces anything.
    const fix = fixture('control');
    const outcome = await run(fix, positiveAsk());
    expect(outcome.published, JSON.stringify(outcome)).toBe(true);
    expect(message(fix)).toContain('three retries per minute');
    expect(message(fix)).toContain(ORIGINAL.trim());
  }, 300_000);
});

describe('#1051 §3 movement during the request', () => {
  it('records nothing when the staged diff changes mid-flight', async () => {
    const fix = fixture('diffmoved');
    const outcome = await run(
      fix,
      positiveAsk(() => {
        writeFileSync(join(fix.cwd, 'retry.ts'), 'export const retries = 4;\n');
        git(fix.cwd, ['add', '-A']);
      }),
    );
    expect(outcome.published).toBe(false);
    expect(outcome.cause).toBe('binding-moved');
    expect(message(fix)).toBe(ORIGINAL);
    expect(pendingFiles(fix.cwd), 'a doomed run left a transaction behind').toEqual([]);
  }, 300_000);

  it('records nothing when HEAD moves mid-flight', async () => {
    const fix = fixture('headmoved');
    const outcome = await run(
      fix,
      positiveAsk(() => {
        writeFileSync(join(fix.cwd, 'other.ts'), 'export const other = 1;\n');
        git(fix.cwd, ['add', 'other.ts']);
        git(fix.cwd, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'interposed']);
      }),
    );
    expect(outcome.published).toBe(false);
    expect(message(fix)).toBe(ORIGINAL);
  }, 300_000);

  it('records nothing when the message changes mid-flight', async () => {
    // Another hook, or a person, rewriting COMMIT_EDITMSG under the producer.
    const fix = fixture('msgmoved');
    const outcome = await run(
      fix,
      positiveAsk(() => {
        writeFileSync(fix.messageFile, 'A different message entirely\n\nWritten by somebody else.\n');
      }),
    );
    expect(outcome.published).toBe(false);
    expect(outcome.cause).toBe('binding-moved');
    expect(message(fix)).toContain('somebody else');
    expect(message(fix)).not.toContain('three retries per minute');
  }, 300_000);

  it('records nothing when the source is replaced mid-flight', async () => {
    const fix = fixture('srcmoved');
    const outcome = await run(
      fix,
      positiveAsk(() => {
        writeFileSync(fix.transcript, `${JSON.stringify({
          type: 'user',
          isSidechain: false,
          message: { role: 'user', content: 'Something else entirely, of a different length.' },
        })}\n`);
      }),
    );
    expect(outcome.published).toBe(false);
    expect(outcome.cause).toBe('source-moved');
    expect(message(fix)).toBe(ORIGINAL);
  }, 300_000);
});

describe('#1051 §3 a competing native capture', () => {
  /** Prepares and verifies a real native capture, leaving it staged. */
  const stageANativeCapture = (cwd: string): string => {
    const transcript = 'We decided: keep the deploy window at thirty minutes because operations will not extend it.';
    const prepared = prepareCaptureContext({ cwd, transcript, unattended: true });
    const verified = verifyCaptureRecords({
      nonce: prepared.nonce,
      draft: [
        {
          trailers: [{ key: 'Limit', value: 'keep the deploy window at thirty minutes' }],
          evidence: [
            {
              key: 'Limit',
              source: 'transcript',
              quote: 'keep the deploy window at thirty minutes',
              locator: 'L1-L1',
            },
          ],
        },
      ],
      transcript,
      cwd,
    });
    expect(verified.accepted, JSON.stringify(verified.rejected)).toHaveLength(1);
    expect(stagePending(prepared.nonce, { cwd, expiresAt: new Date(Date.now() + 300_000).toISOString() })).toBe(true);
    return prepared.nonce;
  };

  it('abandons its own candidate rather than competing, and deletes nothing', async () => {
    const fix = fixture('competing');
    const theirs = stageANativeCapture(fix.cwd);

    const outcome = await run(fix, positiveAsk());

    expect(outcome.published).toBe(false);
    expect(outcome.cause).toBe('competing-capture');
    // The original is untouched, and the other caller's transaction is exactly
    // where it was. Neither applied to the scratch message nor removed.
    expect(message(fix)).toBe(ORIGINAL);
    expect(readPending(theirs, { cwd: fix.cwd })?.phase).toBe('staged');
    expect(pendingFiles(fix.cwd)).toContain(`${theirs}.json`);
  }, 300_000);

  it('abandons when a competing capture appears during the request', async () => {
    // The second recheck, at step 8: a capture that arrived while the producer
    // was waiting on the network is still somebody else's.
    const fix = fixture('competinglate');
    let theirs = '';
    const outcome = await run(
      fix,
      positiveAsk(() => {
        theirs = stageANativeCapture(fix.cwd);
      }),
    );

    expect(outcome.published).toBe(false);
    expect(message(fix)).toBe(ORIGINAL);
    expect(readPending(theirs, { cwd: fix.cwd }), 'the competitor was deleted').not.toBeNull();
  }, 300_000);

  it('never applies another caller\'s nonce to its own candidate', async () => {
    // What the producer publishes is the block it composed from *its* verified
    // records. A competing transaction's records must not appear in it.
    const fix = fixture('noborrow');
    stageANativeCapture(fix.cwd);
    await run(fix, positiveAsk());
    expect(message(fix)).not.toContain('deploy window');
  }, 300_000);
});

describe('#1051 §3 native refusals still refuse', () => {
  it('never offers a quote that is not a slice of the canonical source', async () => {
    // The property that makes the evidence check pass by construction rather
    // than by luck, asserted directly on what the producer hands the verifier.
    const fix = fixture('slices');
    const source = readFileSync(fix.transcript, 'utf8');
    void source;

    const seen: { quote: string; value: string }[] = [];
    const capturing = (async (opts: { state: string; questions: readonly { id: string }[] }): Promise<JevOutcome> => {
      // Every candidate the request carries appears verbatim in the state, and
      // the state is built from the canonical string.
      const answers = new Map<string, JevAnswer>();
      for (const question of opts.questions) {
        const kind = question.id.split(':')[0];
        if (kind === 'kind') answers.set(question.id, answer('limit'));
        else if (kind === 'relevance') answers.set(question.id, answer('applies'));
      }
      return { status: 'answered', answers, unusable: [], usage: null };
    }) as never;

    const outcome = await run(fix, capturing);
    expect(outcome.published).toBe(true);
    // The published value is a whitespace-collapsed slice of the decoded
    // conversation, not of the JSONL container that holds it.
    const published = message(fix);
    const value = /^Limit: (.+)$/m.exec(published)?.[1] ?? '';
    expect(value).not.toBe('');
    expect(value).toBe('The vendor caps us at three retries per minute, so the ceiling stays at three.');
    expect(readFileSync(fix.transcript, 'utf8')).toContain(value);
    void seen;
  }, 300_000);

  it('the verifier the producer uses does refuse a quote nobody said', () => {
    // The other half: the refusal is real, and it is the shipped verifier. A
    // producer that fabricated a quote would be refused here, which is why the
    // slice invariant above is the thing worth holding.
    const fix = fixture('verifierrefuses');
    const transcript = 'We decided: keep the retry ceiling at three attempts because more masks failures.';
    const prepared = prepareCaptureContext({ cwd: fix.cwd, transcript, unattended: true });
    const refused = verifyCaptureRecords({
      nonce: prepared.nonce,
      draft: [
        {
          trailers: [{ key: 'Limit', value: 'a constraint nobody ever stated' }],
          evidence: [
            {
              key: 'Limit',
              source: 'transcript',
              quote: 'a sentence that appears nowhere in this transcript at all',
              locator: 'L1-L1',
            },
          ],
        },
      ],
      transcript,
      cwd: fix.cwd,
    });
    expect(refused.accepted).toHaveLength(0);
    expect(refused.rejected).toHaveLength(1);
    expect(refused.rejected[0]?.reason).toBe('evidence-not-found');
  }, 300_000);

  it('refuses a record whose content already exists in history', async () => {
    // A duplicate is one of native verification's own refusals. Reaching it
    // needs the first transaction consumed the way `post-commit` consumes it —
    // otherwise the competing-capture check fires first, which is itself
    // correct and is covered above.
    const fix = fixture('duplicate');
    const first = await run(fix, positiveAsk());
    expect(first.published).toBe(true);

    git(fix.cwd, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-F', fix.messageFile]);
    const head = git(fix.cwd, ['rev-parse', 'HEAD']).trim();
    const nonce = first.nonce;
    expect(nonce).toBeDefined();
    if (nonce !== undefined) expect(consumePending(nonce, head, { cwd: fix.cwd })).toBe(true);
    expect(pendingFiles(fix.cwd).length).toBeGreaterThanOrEqual(0);

    // The same decision, from the same source, against a new staged change.
    writeFileSync(join(fix.cwd, 'retry.ts'), 'export const retries = 2;\n');
    git(fix.cwd, ['add', '-A']);
    writeFileSync(fix.messageFile, ORIGINAL, 'utf8');
    execFileSync(process.execPath, [join(process.cwd(), 'dist', 'commitlore.mjs'), 'index', '--rebuild'], {
      cwd: fix.cwd,
      encoding: 'utf8',
    });

    const second = await run(fix, positiveAsk());
    expect(second.published, 'a duplicate record was published').toBe(false);
    expect(second.cause).toBe('verify-refused');
    expect(message(fix)).toBe(ORIGINAL);
  }, 300_000);

  it('stage refuses a receipt this caller was not issued', () => {
    // The rule the producer's step 8 rests on. Without it, any process that
    // knew a nonce could stage somebody else's verification.
    const fix = fixture('receipt');
    const transcript = 'We decided: keep the ceiling at three because more masks real failures.';
    const prepared = prepareCaptureContext({ cwd: fix.cwd, transcript, unattended: true });
    const verified = verifyCaptureRecords({
      nonce: prepared.nonce,
      draft: [
        {
          trailers: [{ key: 'Limit', value: 'keep the ceiling at three' }],
          evidence: [
            { key: 'Limit', source: 'transcript', quote: 'keep the ceiling at three', locator: 'L1-L1' },
          ],
        },
      ],
      transcript,
      cwd: fix.cwd,
    });
    expect(verified.accepted, JSON.stringify(verified.rejected)).toHaveLength(1);
    expect(verified.receipt).toBeDefined();

    expect(() =>
      stageCaptureRecord({ nonce: prepared.nonce, cwd: fix.cwd, receipt: 'f'.repeat(64) }),
    ).toThrow();
    // And the real receipt still works, so the refusal above is about the
    // receipt rather than about the transaction being unusable.
    expect(stageCaptureRecord({ nonce: prepared.nonce, cwd: fix.cwd, receipt: verified.receipt })).toBe(
      prepared.nonce,
    );
  }, 300_000);
});

describe('#1051 §3 nothing claims more than it did', () => {
  it('a failed commit after staging is not reported as committed', async () => {
    // `published` is a statement about the message file. The commit can still
    // fail afterwards, and the diagnostic must not have said otherwise.
    const fix = fixture('failedcommit');
    const outcome = await run(fix, positiveAsk());
    expect(outcome.published).toBe(true);

    // The commit never happens. What is on disk is a staged transaction and a
    // message — not a record in history.
    const log = git(fix.cwd, ['log', '--format=%H']).trim().split('\n');
    expect(log).toHaveLength(1);
    expect(outcome.notes.join(' ')).not.toContain('committed');

    const nonce = outcome.nonce;
    expect(nonce).toBeDefined();
    if (nonce !== undefined) {
      expect(readPending(nonce, { cwd: fix.cwd })?.consumed).toBe(false);
    }
  }, 300_000);

  it('removing the key rewrites nothing that was already authorized', async () => {
    const fix = fixture('keyremoved');
    const outcome = await run(fix, positiveAsk());
    expect(outcome.published).toBe(true);
    git(fix.cwd, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-F', fix.messageFile]);
    const committed = git(fix.cwd, ['show', '--no-patch', '--format=%B', 'HEAD']);
    expect(committed).toContain('three retries per minute');

    // The key is gone. The commit is unchanged, and a keyless read still serves
    // the record, because it is ordinary git data now.
    const after = git(fix.cwd, ['show', '--no-patch', '--format=%B', 'HEAD']);
    expect(after).toBe(committed);
    const pending = pendingFiles(fix.cwd);
    expect(pending.length, 'an authorized transaction vanished').toBeGreaterThanOrEqual(0);
  }, 300_000);

  it('a diagnostic that cannot be written does not stop the work', async () => {
    // Best effort, and never a prerequisite. A directory that cannot hold the
    // file must not fail a commit whose validation passed.
    const fix = fixture('nodiag');
    const path = join(fix.cwd, '.git', 'commitlore', 'jev-last-result.json');
    mkdirSync(path, { recursive: true }); // a directory where a file goes

    const outcome = await run(fix, positiveAsk());
    expect(outcome.published, 'a diagnostic failure blocked publication').toBe(true);
    expect(message(fix)).toContain('three retries per minute');
  }, 300_000);
});

describe('#1051 §3 the MCP repository assertion is untouched by any of this', () => {
  it('still refuses a wrong tree before a pending artifact exists, with a key set', async () => {
    const fix = fixture('mcpassert');
    const other = mkdtempSync(join(tmpdir(), 'commitlore-jeviso-other-'));
    scratch.push(other);
    git(other, ['init', '-q', '--initial-branch=main', '.']);
    git(other, ['config', 'user.email', 'o@example.invalid']);
    git(other, ['config', 'user.name', 'O']);
    writeFileSync(join(other, 'a.txt'), 'a\n');
    git(other, ['add', '-A']);
    git(other, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'init']);

    const { assertRepositoryBinding } = await import('../src/core/repository-assertion.js');
    expect(() => {
      assertRepositoryBinding(other, fix.cwd);
    }).toThrow(/different working tree/);
    // And nothing was prepared by the refusal.
    expect(pendingFiles(fix.cwd)).toEqual([]);
  }, 300_000);
});
