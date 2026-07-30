import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { stageCaptureRecord } from '../src/core/capture-stage.js';
import { prepareCaptureContext } from '../src/core/capture-prepare.js';
import { verifyCaptureRecords } from '../src/core/capture-verify.js';
import { readPending } from '../src/core/pending.js';
import { createTestRepo } from './git-fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

/** Create a temp repo with one commit and a staged change. */
const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-stage-'));
  temporaries.push(dir);
  createTestRepo({ path: dir });
  writeFileSync(join(dir, 'init.txt'), 'initial content\n');
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "init" --no-verify --quiet', { cwd: dir });
  // Stage a change so diff is non-empty
  writeFileSync(join(dir, 'init.txt'), 'initial content\nmodified\n');
  execSync('git add .', { cwd: dir });
  return dir;
};

/**
 * Run prepare + verify with a valid draft to get a verified nonce ready for staging.
 * The draft contains a valid Record-Id and evidence from the transcript.
 */
const prepareAndVerify = (cwd: string): { nonce: string } => {
  const transcript = 'We chose sha256 because it is the standard hash function for integrity checking.';
  const diff = execSync('git diff --cached', { cwd, encoding: 'utf8' });
  const result = prepareCaptureContext({ cwd, transcript });

  // Build a valid draft record with evidence that appears in the transcript
  const draft = [
    {
      trailers: [
        { key: 'Limit', value: 'use sha256 for integrity checking' },
        { key: 'Record-Id', value: 'r-teststage01' },
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

  verifyCaptureRecords({ nonce: result.nonce, draft, transcript, diff, cwd });
  return { nonce: result.nonce };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stageCaptureRecord', () => {
  it('writes a pending file with expiry and records (RED test)', () => {
    const cwd = makeRepo();
    const { nonce } = prepareAndVerify(cwd);

    const staged = stageCaptureRecord({ nonce, cwd });
    expect(staged).toBe(nonce);

    // Read back the pending record
    const record = readPending(nonce, { cwd });
    expect(record).not.toBeNull();
    expect(record!.phase).toBe('staged');
    expect(record!.staged_at).not.toBeNull();
    expect(record!.expires_at).not.toBeNull();

    // Expiry is ~5 minutes after staged_at
    const stagedAt = new Date(record!.staged_at!).getTime();
    const expiresAt = new Date(record!.expires_at!).getTime();
    const diffMs = expiresAt - stagedAt;
    expect(diffMs).toBe(5 * 60 * 1000);

    // Binding conditions are present
    expect(record!.base_head).toMatch(/^[0-9a-f]{40}$/);
    expect(record!.staged_diff_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record!.policy_identity_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('expires_at is null for prepared and verified phases, only stamped at stage', () => {
    const cwd = makeRepo();
    const transcript = 'We chose sha256 because it is the standard hash function for integrity checking.';
    const diff = execSync('git diff --cached', { cwd, encoding: 'utf8' });
    const result = prepareCaptureContext({ cwd, transcript });

    // After prepare: expires_at must be null
    const prepared = readPending(result.nonce, { cwd });
    expect(prepared!.phase).toBe('prepared');
    expect(prepared!.expires_at).toBeNull();

    // After verify: expires_at must still be null
    const draft = [
      {
        trailers: [
          { key: 'Limit', value: 'use sha256 for integrity checking' },
          { key: 'Record-Id', value: 'r-testexpiry01' },
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
    verifyCaptureRecords({ nonce: result.nonce, draft, transcript, diff, cwd });
    const verified = readPending(result.nonce, { cwd });
    expect(verified!.phase).toBe('verified');
    expect(verified!.expires_at).toBeNull();

    // After stage: expires_at must be set
    const staged = stageCaptureRecord({ nonce: result.nonce, cwd });
    expect(staged).toBe(result.nonce);
    const stagedRecord = readPending(result.nonce, { cwd });
    expect(stagedRecord!.phase).toBe('staged');
    expect(stagedRecord!.expires_at).not.toBeNull();
    expect(stagedRecord!.staged_at).not.toBeNull();
  });

  it('validation_result empty returns null (nothing to stage)', () => {
    const cwd = makeRepo();
    const transcript = 'We chose sha256 because it is the standard hash function.';
    const diff = execSync('git diff --cached', { cwd, encoding: 'utf8' });
    const result = prepareCaptureContext({ cwd, transcript });

    // Verify with a fabricated draft (evidence does not appear in transcript)
    const draft = [
      {
        trailers: [
          { key: 'Limit', value: 'fabricated limit' },
          { key: 'Record-Id', value: 'r-empty01' },
        ],
        evidence: [
          {
            key: 'Limit',
            source: 'transcript' as const,
            quote: 'THIS DOES NOT EXIST IN THE TRANSCRIPT AT ALL',
            locator: 'L1-L1',
          },
        ],
      },
    ];
    verifyCaptureRecords({ nonce: result.nonce, draft, transcript, diff, cwd });

    const staged = stageCaptureRecord({ nonce: result.nonce, cwd });
    expect(staged).toBeNull();
  });

  it('max records enforced (>1 record throws)', () => {
    const cwd = makeRepo();
    const transcript =
      'We chose sha256 because it is the standard. We also chose AES for encryption because it is fast.';
    const diff = execSync('git diff --cached', { cwd, encoding: 'utf8' });
    const result = prepareCaptureContext({ cwd, transcript });

    // Verify with two valid records — both with evidence in transcript
    const draft = [
      {
        trailers: [
          { key: 'Limit', value: 'use sha256' },
          { key: 'Record-Id', value: 'r-multi01' },
        ],
        evidence: [
          { key: 'Limit', source: 'transcript' as const, quote: 'chose sha256 because it is the standard', locator: 'L1-L1' },
        ],
      },
      {
        trailers: [
          { key: 'Limit', value: 'use AES for encryption' },
          { key: 'Record-Id', value: 'r-multi02' },
        ],
        evidence: [
          { key: 'Limit', source: 'transcript' as const, quote: 'chose AES for encryption because it is fast', locator: 'L1-L1' },
        ],
      },
    ];
    verifyCaptureRecords({ nonce: result.nonce, draft, transcript, diff, cwd });

    expect(() => stageCaptureRecord({ nonce: result.nonce, cwd })).toThrow();
  });

  it('unverified nonce (prepared phase) cannot stage', () => {
    const cwd = makeRepo();
    const transcript = 'some transcript content for this test';
    const result = prepareCaptureContext({ cwd, transcript });

    // Try to stage without verifying — nonce is in 'prepared' phase
    const staged = stageCaptureRecord({ nonce: result.nonce, cwd });
    expect(staged).toBeNull();
  });

  it('expiryMinutes overrides the window length', () => {
    const cwd = makeRepo();
    const { nonce } = prepareAndVerify(cwd);

    const staged = stageCaptureRecord({ nonce, cwd, expiryMinutes: 10 });
    expect(staged).toBe(nonce);

    const record = readPending(nonce, { cwd });
    const stagedAt = new Date(record!.staged_at!).getTime();
    const expiresAt = new Date(record!.expires_at!).getTime();
    const diffMs = expiresAt - stagedAt;
    expect(diffMs).toBe(10 * 60 * 1000);
  });

  it('caller cannot substitute payload (stage input has nonce only)', () => {
    const cwd = makeRepo();
    const { nonce } = prepareAndVerify(cwd);

    // TypeScript enforces at compile time that stageCaptureRecord
    // accepts only nonce, cwd, and expiryMinutes. Runtime: verify
    // the function signature does not accept records/evidence/base_head.
    const staged = stageCaptureRecord({ nonce, cwd });
    expect(staged).toBe(nonce);

    // The staged record's base_head was computed server-side at prepare time,
    // not passed by the caller at stage time
    const record = readPending(nonce, { cwd });
    const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();
    expect(record!.base_head).toBe(head);
  });

  // === MUTATION ORACLES ===

  it('ORACLE-MUST-FAIL: expires_at stamped at prepare instead of stage', () => {
    // This oracle validates the CEO amendment: if expires_at were set at prepare
    // time, the test that checks expires_at is null for prepared phase would catch it.
    // Here we explicitly verify the staged_at is the anchor.
    const cwd = makeRepo();
    const { nonce } = prepareAndVerify(cwd);

    // Read verified (pre-stage) state
    const preStage = readPending(nonce, { cwd });
    expect(preStage!.expires_at).toBeNull(); // Must be null before stage

    const staged = stageCaptureRecord({ nonce, cwd });
    expect(staged).toBe(nonce);

    const postStage = readPending(nonce, { cwd });
    // expires_at must equal staged_at + 5 minutes exactly
    const stagedAt = new Date(postStage!.staged_at!);
    const expiresAt = new Date(postStage!.expires_at!);
    expect(expiresAt.getTime() - stagedAt.getTime()).toBe(5 * 60 * 1000);
    // Anchor is staged_at, not created_at
    const createdAt = new Date(postStage!.created_at);
    expect(expiresAt.getTime() - createdAt.getTime()).not.toBe(5 * 60 * 1000);
  });

  it('ORACLE-MUST-FAIL: accepts a caller-supplied base_head', () => {
    // This oracle proves that if the HEAD-recheck were removed (allowing a caller
    // to bypass the server-side binding), the test catches it. We create a scenario
    // where HEAD moves after prepare+verify but before stage. The correct code
    // throws; a mutant that skips the check would succeed.
    const cwd = makeRepo();
    const transcript = 'We chose sha256 because it is the standard hash function for integrity checking.';
    const diff = execSync('git diff --cached', { cwd, encoding: 'utf8' });
    const result = prepareCaptureContext({ cwd, transcript });

    const draft = [
      {
        trailers: [
          { key: 'Limit', value: 'use sha256 for integrity checking' },
          { key: 'Record-Id', value: 'r-baseheadtest' },
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
    verifyCaptureRecords({ nonce: result.nonce, draft, transcript, diff, cwd });

    // Move HEAD after verify — stage must reject because base_head no longer matches
    writeFileSync(join(cwd, 'extra.txt'), 'extra content\n');
    execSync('git add extra.txt', { cwd });
    execSync('git commit -m "move HEAD" --no-verify --quiet', { cwd });

    // The correct implementation throws because HEAD moved
    expect(() => stageCaptureRecord({ nonce: result.nonce, cwd })).toThrow(/HEAD moved/);
  });

  it('ORACLE-MUST-PASS: re-staging an already-staged nonce returns null', () => {
    // A staged nonce cannot be staged again — the phase is already 'staged'
    const cwd = makeRepo();
    const { nonce } = prepareAndVerify(cwd);

    const first = stageCaptureRecord({ nonce, cwd });
    expect(first).toBe(nonce);

    // Second attempt: phase is now 'staged', not 'verified'
    const second = stageCaptureRecord({ nonce, cwd });
    expect(second).toBeNull();
  });
});
