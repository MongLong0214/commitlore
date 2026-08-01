import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestRepo } from './git-fixtures.js';
import { gcPending } from '../src/core/pending-gc.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-gc-'));
  temporaries.push(dir);
  createTestRepo({ path: dir });
  writeFileSync(join(dir, 'init.txt'), 'init');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial', '--no-verify'], { cwd: dir });
  return dir;
};

const pendingDir = (repo: string): string => {
  const gitDir = execFileSync('git', ['rev-parse', '--git-path', 'commitlore/pending'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();
  const resolved = join(repo, gitDir);
  mkdirSync(resolved, { recursive: true });
  return resolved;
};

const writePending = (dir: string, nonce: string, record: Record<string, unknown>): string => {
  const filePath = join(dir, `${nonce}.json`);
  writeFileSync(filePath, JSON.stringify(record, null, 2));
  return filePath;
};

const pastIso = (minutesAgo: number): string =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

const futureIso = (minutesAhead: number): string =>
  new Date(Date.now() + minutesAhead * 60_000).toISOString();

const headOf = (repo: string): string =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

/** A well-formed commit id that is not this repository's HEAD. */
const OTHER_HEAD = 'deadbeef'.repeat(5);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pending-gc', () => {
  it('gc removes an expired prepared file', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = 'a'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(30),
      expires_at: pastIso(10),
      phase: 'prepared',
      consumed: false,
    });

    const result = gcPending(repo);
    expect(result.removed).toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(false);
  });

  it('gc removes an expired verified file', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = 'b'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(30),
      expires_at: pastIso(5),
      phase: 'verified',
      consumed: false,
    });

    const result = gcPending(repo);
    expect(result.removed).toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(false);
  });

  it('gc keeps a staged file even past expires_at', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = 'c'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(30),
      expires_at: pastIso(10),
      phase: 'staged',
      consumed: false,
    });

    const result = gcPending(repo);
    expect(result.kept).toContain(`${nonce}.json`);
    expect(result.removed).not.toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('gc keeps an applied file even past expires_at', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = 'd'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(30),
      expires_at: pastIso(10),
      phase: 'applied',
      consumed: false,
    });

    const result = gcPending(repo);
    expect(result.kept).toContain(`${nonce}.json`);
    expect(result.removed).not.toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('gc removes a consumed file past the 24h retention window', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = 'e'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(60 * 25), // 25 hours ago
      expires_at: pastIso(60 * 25 - 5),
      phase: 'consumed',
      consumed: true,
      consumed_at: pastIso(60 * 25 - 5),
      consumed_by: 'f'.repeat(40),
    });

    const result = gcPending(repo);
    expect(result.removed).toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(false);
  });

  it('gc keeps a recently consumed file', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = 'f'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(10),
      expires_at: pastIso(5),
      phase: 'consumed',
      consumed: true,
      consumed_at: pastIso(5),
      consumed_by: '1'.repeat(40),
    });

    const result = gcPending(repo);
    expect(result.kept).toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('gc skips a file with missing created_at and expires_at (undeterminable age)', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = '1'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      phase: 'prepared',
      consumed: false,
      // No created_at, no expires_at — undeterminable
    });

    const result = gcPending(repo);
    expect(result.kept).toContain(`${nonce}.json`);
    expect(result.removed).not.toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('gc skips a file with corrupt JSON', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = '2'.repeat(32);
    writeFileSync(join(dir, `${nonce}.json`), 'not valid json {{{');

    const result = gcPending(repo);
    expect(result.kept).toContain(`${nonce}.json`);
    expect(result.removed).not.toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('gc skips a file with unknown version', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = '3'.repeat(32);
    writePending(dir, nonce, {
      version: 99,
      nonce,
      created_at: pastIso(30),
      expires_at: pastIso(10),
      phase: 'prepared',
      consumed: false,
    });

    const result = gcPending(repo);
    expect(result.kept).toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('gc skips a file with missing phase', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = '4'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(30),
      expires_at: pastIso(10),
      consumed: false,
      // No phase — undeterminable
    });

    const result = gcPending(repo);
    expect(result.kept).toContain(`${nonce}.json`);
    expect(result.removed).not.toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('gc keeps a non-expired file', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = '5'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(2),
      expires_at: futureIso(3),
      phase: 'prepared',
      consumed: false,
    });

    const result = gcPending(repo);
    expect(result.kept).toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('gc keeps a file with null expires_at inside the retention window', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = '6'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(120),
      expires_at: null,
      phase: 'prepared',
      consumed: false,
      base_head: OTHER_HEAD,
    });

    const result = gcPending(repo);
    // Two hours old: unstageable, but well short of the 24h window, so the
    // file a capture is still working with is not pulled out from under it.
    expect(result.kept).toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('gc returns empty arrays when pending directory does not exist', () => {
    const repo = makeRepo();
    // Don't create the pending directory
    const result = gcPending(repo);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual([]);
  });

  // --- Mutation oracles ---

  it('ORACLE: must fail if staged file past expiry is removed', () => {
    // This oracle verifies the protection of staged files.
    // If gcPending ever removes a staged file, this test catches it.
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = '7'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(60),
      expires_at: pastIso(30),
      phase: 'staged',
      consumed: false,
    });

    const result = gcPending(repo);
    // The staged file MUST survive — if it doesn't, the oracle catches a mutation
    // that removed the phase protection
    expect(result.removed).not.toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('ORACLE: must fail if applied file past expiry is removed', () => {
    // This oracle verifies the protection of applied files.
    // An applied-but-unconsumed record may still be finalised by T-1018's post-commit.
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = '8'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(60),
      expires_at: pastIso(30),
      phase: 'applied',
      consumed: false,
    });

    const result = gcPending(repo);
    // The applied file MUST survive — removing it would race T-1018's finaliser
    expect(result.removed).not.toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('ORACLE: must fail if undeterminable file is removed', () => {
    // This oracle verifies the fail-closed behaviour: a file whose age/phase
    // cannot be determined must be skipped, never guessed at.
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = '9'.repeat(32);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      // No created_at, no expires_at, no phase — completely undeterminable
      consumed: false,
    });

    const result = gcPending(repo);
    // The undeterminable file MUST be kept
    expect(result.removed).not.toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('ORACLE: must pass — expired prepared file is correctly removed', () => {
    // This oracle verifies that an expired, non-protected file IS removed.
    // A mutation that over-protects would fail this.
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = 'ab'.repeat(16);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(30),
      expires_at: pastIso(10),
      phase: 'prepared',
      consumed: false,
    });

    const result = gcPending(repo);
    // This file MUST be removed — a mutation that over-protects would fail here
    expect(result.removed).toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(false);
  });
});

/**
 * #367: `expires_at` is stamped at stage time, so a transaction that never
 * reaches `staged` carries `expires_at: null` for ever and the expiry rule above
 * can never fire on it. Since #341 made skipping the ordinary outcome, that is
 * the common path, and every skip left a file behind permanently.
 *
 * These transactions age out on `created_at` instead — but only once HEAD has
 * moved past `base_head`, which is the condition `stageCaptureRecord` itself
 * refuses on. Both must hold, so gc still never collects anything that could
 * still be staged and finalised.
 */
describe('#367 a transaction that can never be stamped with an expiry', () => {
  it.each(['prepared', 'verified'])(
    'collects an aged %s transaction that HEAD has moved past',
    (phase) => {
      const repo = makeRepo();
      const dir = pendingDir(repo);
      const nonce = 'c1'.repeat(16);
      writePending(dir, nonce, {
        version: 1,
        nonce,
        created_at: pastIso(60 * 25),
        expires_at: null,
        phase,
        consumed: false,
        base_head: OTHER_HEAD,
      });

      const result = gcPending(repo);
      expect(result.removed).toContain(`${nonce}.json`);
      expect(existsSync(join(dir, `${nonce}.json`))).toBe(false);
    },
  );

  it('keeps a fresh unstageable transaction: the window has not elapsed', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = 'c2'.repeat(16);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(5),
      expires_at: null,
      phase: 'verified',
      consumed: false,
      base_head: OTHER_HEAD,
    });

    const result = gcPending(repo);
    expect(result.kept).toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('ORACLE: keeps an aged transaction whose base is still HEAD — it can still be staged', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = 'c3'.repeat(16);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(60 * 25),
      expires_at: null,
      phase: 'verified',
      consumed: false,
      base_head: headOf(repo),
    });

    const result = gcPending(repo);
    expect(result.removed).not.toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('ORACLE: keeps an aged staged transaction with no expiry — protection is unchanged', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = 'c4'.repeat(16);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(60 * 25),
      expires_at: null,
      phase: 'staged',
      consumed: false,
      base_head: OTHER_HEAD,
    });

    const result = gcPending(repo);
    expect(result.removed).not.toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });

  it('ORACLE: keeps an aged transaction with no recorded base — undeterminable', () => {
    const repo = makeRepo();
    const dir = pendingDir(repo);
    const nonce = 'c5'.repeat(16);
    writePending(dir, nonce, {
      version: 1,
      nonce,
      created_at: pastIso(60 * 25),
      expires_at: null,
      phase: 'prepared',
      consumed: false,
      // No base_head — whether it could still be staged cannot be determined
    });

    const result = gcPending(repo);
    expect(result.removed).not.toContain(`${nonce}.json`);
    expect(existsSync(join(dir, `${nonce}.json`))).toBe(true);
  });
});
