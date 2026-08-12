/**
 * #511 — unattended capture: an opt-in, `auto` mode only.
 *
 * Two properties decide whether this shipped correctly:
 *
 * - **Nothing changes for a repository that did not ask for it.** A capture
 *   that makes no unattended declaration must leave byte-identical bytes
 *   everywhere it reaches — the pending transaction on disk, the policy
 *   identity that transaction carries, and the record block that lands in the
 *   commit. The pinned values below were measured against the build before the
 *   switch existed; if adding the switch moved them, a repository upgraded
 *   without opting in and its capture behaviour moved with it.
 *
 * - **A record staged unattended can never direct an agent.** The cap already
 *   exists in grading; what did not exist is anything exercising the whole
 *   path. The opted-in test drives prepare → verify → stage → the
 *   prepare-commit-msg hook → a real commit, then reads the record back
 *   through the consumer route and asserts the grade.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { POLICY_FILE_NAME } from '../src/core/capture-policy.js';
import { prepareCaptureContext } from '../src/core/capture-prepare.js';
import { stageCaptureRecord } from '../src/core/capture-stage.js';
import { verifyCaptureRecords } from '../src/core/capture-verify.js';
import { execGit } from '../src/core/git.js';
import { gradeRecord } from '../src/core/grade.js';
import { buildInjection } from '../src/core/inject.js';
import { parseRecordBlocks } from '../src/core/trailers.js';
import type { DraftRecord } from '../src/core/harvest.js';
import { createTestRepo } from './git-fixtures.js';

// ---------------------------------------------------------------------------
// Pins measured against the build before the switch existed
// ---------------------------------------------------------------------------

/**
 * The default policy identity, pinned in `test/capture-policy.test.ts` as
 * `PINNED_DEFAULT_DIGEST`. `unattended` is deliberately not part of this
 * input: a repository that never opted in keeps its digest across the
 * upgrade, so no capture prepared before the switch is refused after it.
 */
const PRE_SWITCH_DEFAULT_DIGEST =
  '02bd63fd270db510791fafbd80f4b735f228d8f26b635c4c5312c04b40780b31';

const TRANSCRIPT =
  'We chose sha256 because it is the standard hash function for integrity checking.';

const RECORD_ID = 'r-unatt0511';

/** The record block a capture of the draft below commits, byte for byte. */
const EXPECTED_BLOCK = [
  'Limit: use sha256 for integrity checking',
  `Record-Id: ${RECORD_ID}`,
  'Provenance: drafted',
  '',
].join('\n');

const draftRecords = (provenance?: string): DraftRecord[] => [
  {
    trailers: [
      { key: 'Limit', value: 'use sha256 for integrity checking' },
      { key: 'Record-Id', value: RECORD_ID },
      ...(provenance !== undefined ? [{ key: 'Provenance', value: provenance }] : []),
    ],
    evidence: [
      {
        key: 'Limit',
        source: 'transcript' as const,
        quote: 'chose sha256 because it is the standard hash function for integrity checking',
        locator: 'L1-L1',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): string => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout;
};

/** Fresh repository: one commit, one staged change, no policy file. */
const makeRepo = (): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-unattended-'));
  scratch.push(dir);
  createTestRepo({ path: dir });
  writeFileSync(join(dir, 'file.txt'), 'before\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'initial']);
  writeFileSync(join(dir, 'file.txt'), 'after\n');
  git(dir, ['add', '-A']);
  return dir;
};

const pendingDirOf = (cwd: string): string => {
  const reported = git(cwd, ['rev-parse', '--git-path', 'commitlore/pending']).trim();
  return resolve(cwd, reported);
};

const readPendingJson = (cwd: string, nonce: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(pendingDirOf(cwd), `${nonce}.json`), 'utf8')) as Record<
    string,
    unknown
  >;

/** Run the prepare-commit-msg hook action exactly as the installed hook would. */
const runPrepareCommitMsgHook = async (cwd: string, messageFile: string): Promise<void> => {
  const mod = await import('../src/hooks/prepare-commit-msg.js');
  const { Command } = await import('commander');
  const program = new Command();
  program.exitOverride();
  mod.register(program);
  const previous = process.cwd();
  try {
    process.chdir(cwd);
    await program.parseAsync(['node', 'commitlore', 'prepare-commit-msg', messageFile]);
  } finally {
    process.chdir(previous);
  }
};

/** prepare → verify → stage → hook → commit. Returns the committed message. */
const runWholePipeline = async (
  cwd: string,
  opts: { unattended?: boolean; provenance?: string } = {},
): Promise<string> => {
  const prepared = prepareCaptureContext({
    cwd,
    transcript: TRANSCRIPT,
    ...(opts.unattended === true ? { unattended: true } : {}),
  });
  const diff = git(cwd, ['diff', '--cached']);
  const verified = verifyCaptureRecords({
    nonce: prepared.nonce,
    draft: draftRecords(opts.provenance),
    transcript: TRANSCRIPT,
    diff,
    cwd,
  });
  expect(verified.validation_result).toBe('pass');
  expect(stageCaptureRecord({ nonce: prepared.nonce, cwd })).toBe(prepared.nonce);

  const messageFile = join(cwd, 'COMMIT_EDITMSG');
  writeFileSync(messageFile, 'test commit\n');
  await runPrepareCommitMsgHook(cwd, messageFile);
  const message = readFileSync(messageFile, 'utf8');
  execFileSync('git', ['commit', '--quiet', '-F', messageFile], { cwd });
  return message;
};

const TRUSTED = 'CommitLore Test <test@example.invalid>';

// ---------------------------------------------------------------------------
// Default off — nothing changes for a repository that did not ask for it
// ---------------------------------------------------------------------------

describe('#511 default off: a repository with no setting captures as it did before', () => {
  it('leaves byte-identical bytes: no declaration field, the pre-switch digest, the same record block', async () => {
    const repo = makeRepo();

    const prepared = prepareCaptureContext({ cwd: repo, transcript: TRANSCRIPT });
    expect(prepared.policy_identity_hash).toBe(PRE_SWITCH_DEFAULT_DIGEST);

    // The stored transaction is exactly the pre-switch shape: no `unattended`
    // key at all, and the identity of the policy that ran is unchanged.
    const pending = readPendingJson(repo, prepared.nonce);
    expect(pending).not.toHaveProperty('unattended');
    expect(pending['policy_identity_hash']).toBe(PRE_SWITCH_DEFAULT_DIGEST);

    const message = await runWholePipeline(repo);

    // `auto` stamped `drafted` before the switch existed; the block that
    // reaches the commit must be byte-identical to what that build wrote.
    expect(message).toBe(`test commit\n\n${EXPECTED_BLOCK}`);
  });

  it('reads back through the consumer route as a claim', async () => {
    const repo = makeRepo();
    await runWholePipeline(repo);
    const injection = buildInjection({
      cwd: repo,
      path: 'file.txt',
      at: new Date('2100-01-01T00:00:00Z'),
      trustedAuthors: [TRUSTED],
    });
    const line = injection.text
      .split('\n')
      .find((candidate) => candidate.includes('use sha256 for integrity checking'));
    expect(line, 'the record should still be delivered').toBeDefined();
    expect(line).toContain('[claim]');
    expect(line).not.toContain('[directive]');
  });

  it('refuses the unattended declaration and writes nothing', () => {
    const repo = makeRepo();
    expect(() =>
      prepareCaptureContext({ cwd: repo, transcript: TRANSCRIPT, unattended: true }),
    ).toThrow(/unattended capture is off for this repository/);

    // Refused at prepare, so no transcript is hashed and no pending file
    // exists — the same shape as `off`'s refusal, for the same reason.
    const dir = pendingDirOf(repo);
    expect(!existsSync(dir) || readdirSync(dir).length === 0).toBe(true);
  });

  it('refuses the declaration in suggest mode, where a host may ask', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, POLICY_FILE_NAME), '{ "mode": "suggest" }\n');
    expect(() =>
      prepareCaptureContext({ cwd: repo, transcript: TRANSCRIPT, unattended: true }),
    ).toThrow(/unattended capture is off for this repository/);
  });
});

// ---------------------------------------------------------------------------
// Opted in — the whole path, and the cap that decides whether it is safe
// ---------------------------------------------------------------------------

describe('#511 opted in: unattended capture in auto mode', () => {
  it('records the declaration in the transaction', () => {
    const repo = makeRepo();
    writeFileSync(join(repo, POLICY_FILE_NAME), '{ "unattended": true }\n');
    const prepared = prepareCaptureContext({
      cwd: repo,
      transcript: TRANSCRIPT,
      unattended: true,
    });
    expect(readPendingJson(repo, prepared.nonce)['unattended']).toBe(true);
  });

  it('stages without a prompt, carries Provenance: drafted, and reads back as claim — never directive', async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, POLICY_FILE_NAME), '{ "unattended": true }\n');

    // The draft claims `authored`; nobody read it, so the pipeline must say
    // `drafted` whatever the model wrote.
    const message = await runWholePipeline(repo, { unattended: true, provenance: 'authored' });
    expect(message).toBe(`test commit\n\n${EXPECTED_BLOCK}`);

    // The consumer route: what the next agent receives before editing a path.
    const injection = buildInjection({
      cwd: repo,
      path: 'file.txt',
      at: new Date('2100-01-01T00:00:00Z'),
      trustedAuthors: [TRUSTED],
    });
    const line = injection.text
      .split('\n')
      .find((candidate) => candidate.includes('use sha256 for integrity checking'));
    expect(line, 'the unattended record should still be delivered').toBeDefined();
    expect(line).toContain('[claim]');
    expect(line).not.toContain('[directive]');

    // The grade itself, from the committed trailers.
    const committed = git(repo, ['log', '-1', '--format=%B']);
    const blocks = parseRecordBlocks(committed);
    expect(blocks.length).toBe(1);
    const grade = gradeRecord({ trailers: blocks[0]! }, {
      at: new Date(),
      author: TRUSTED,
      trustedAuthors: [TRUSTED],
    });
    expect(grade.trust).toBe('claim');
    expect(grade.provenance).toBe('drafted');
  });

  it('detects the opt-in being withdrawn between stage and commit', () => {
    const repo = makeRepo();
    const policyPath = join(repo, POLICY_FILE_NAME);
    writeFileSync(policyPath, '{ "unattended": true }\n');

    const prepared = prepareCaptureContext({
      cwd: repo,
      transcript: TRANSCRIPT,
      unattended: true,
    });
    const diff = git(repo, ['diff', '--cached']);
    verifyCaptureRecords({
      nonce: prepared.nonce,
      draft: draftRecords(),
      transcript: TRANSCRIPT,
      diff,
      cwd: repo,
    });

    // The consent is part of the policy the identity hash covers (ADR-0021
    // §7): withdrawing it between stage and commit is a policy change.
    writeFileSync(policyPath, '{ "unattended": false }\n');
    expect(() => stageCaptureRecord({ nonce: prepared.nonce, cwd: repo })).toThrow(
      /policy identity changed since prepare/,
    );
  });
});
