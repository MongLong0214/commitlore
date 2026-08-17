/**
 * #709 — a committed policy with no local override.
 *
 * The report: `.commitlore-policy.json` is committed, so a contributor who
 * needs to differ from it has one route — edit the tracked file. Their worktree
 * is then permanently dirty, and in the repository that filed this, a release
 * script that refuses to tag a dirty tree stopped working. Refusing the overlay
 * never prevented the divergence; it converted it into a modified tracked file.
 *
 * So the overlay wins per key, in both directions, and the price of a stated
 * precedence is paid here: that the digest of a repository without one does not
 * move, that a record prepared under an overlay is stamped with the policy that
 * actually produced it, and that the disagreement is visible.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runDoctor } from '../src/commands/doctor.js';
import {
  POLICY_DEFAULTS,
  POLICY_FILE_NAME,
  POLICY_LOCAL_FILE_NAME,
  computePolicyIdentityHash,
  resolvePolicy,
  setUnattendedCapture,
} from '../src/core/capture-policy.js';

let repo: string;

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

/** Writes the committed policy and commits it, as a repository sharing one does. */
const commitPolicy = (contents: string): string => {
  writeFileSync(join(repo, POLICY_FILE_NAME), contents);
  git('add', POLICY_FILE_NAME);
  git('commit', '--quiet', '--no-verify', '-m', 'share the policy');
  return contents;
};

const writeOverlay = (contents: string): void => {
  writeFileSync(join(repo, POLICY_LOCAL_FILE_NAME), contents);
};

/** Tracked files that differ from HEAD. The overlay is untracked, so it is absent here. */
const dirtyTracked = (): string[] =>
  git('status', '--porcelain', '--untracked-files=no')
    .split('\n')
    .filter((line) => line.trim().length > 0);

beforeEach(() => {
  // `git rev-parse --show-toplevel` returns the real path, and on macOS the
  // temp directory is reached through a symlink — so resolve it here rather
  // than comparing two spellings of the same directory.
  repo = mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-overlay-'));
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(repo, 'seed.txt'), 'seed\n');
  git('add', 'seed.txt');
  git('commit', '--quiet', '--no-verify', '-m', 'seed');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('#709 the overlay decides per key', () => {
  it('leaves the keys it does not set as the repository set them', () => {
    commitPolicy(`${JSON.stringify({ mode: 'suggest', max_records_per_commit: 3 }, null, 2)}\n`);
    writeOverlay(`${JSON.stringify({ mode: 'auto' }, null, 2)}\n`);

    const resolution = resolvePolicy(repo);

    expect(resolution.ok).toBe(true);
    expect(resolution.policy.mode, 'the overlay decides this one').toBe('auto');
    expect(
      resolution.policy.max_records_per_commit,
      'per key: an overlay silent on this key must not reset it to the default',
    ).toBe(3);
    expect(resolution.source).toBe('local');
    expect(resolution.overridden).toEqual(['mode']);
  });

  it('may turn the setting up, which is the direction the committed file cannot afford to', () => {
    // A repository commits the conservative value because it applies to
    // everyone who clones. The contributor who does run an agent host is the
    // case that had no route but editing the tracked file.
    commitPolicy(`${JSON.stringify({ mode: 'auto', unattended: false }, null, 2)}\n`);
    writeOverlay(`${JSON.stringify({ unattended: true }, null, 2)}\n`);

    const resolution = resolvePolicy(repo);

    expect(resolution.ok).toBe(true);
    expect(resolution.policy.unattended).toBe(true);
    expect(resolution.beneath.unattended, 'what the repository still says').toBe(false);
    expect(resolution.overridden).toEqual(['unattended']);
  });

  it('may turn it down, and leaves the repository saying what it said', () => {
    const bytes = commitPolicy(
      `${JSON.stringify({ mode: 'auto', unattended: true }, null, 2)}\n`,
    );
    writeOverlay(`${JSON.stringify({ unattended: false }, null, 2)}\n`);

    const resolution = resolvePolicy(repo);

    expect(resolution.policy.unattended).toBe(false);
    expect(readFileSync(join(repo, POLICY_FILE_NAME), 'utf8'), 'untouched').toBe(bytes);
    expect(dirtyTracked(), 'the whole point: the worktree stays clean').toEqual([]);
  });

  it('applies on its own when the repository committed no policy', () => {
    writeOverlay(`${JSON.stringify({ mode: 'off' }, null, 2)}\n`);

    const resolution = resolvePolicy(repo);

    expect(resolution.ok).toBe(true);
    expect(resolution.policy.mode).toBe('off');
    expect(resolution.path, 'there is no committed file to name').toBeNull();
    expect(resolution.localPath).toBe(join(repo, POLICY_LOCAL_FILE_NAME));
    expect(resolution.beneath, 'the defaults are what it overlays').toEqual(POLICY_DEFAULTS);
  });

  it('reports no override when the overlay restates what it overlays', () => {
    commitPolicy(`${JSON.stringify({ mode: 'suggest' }, null, 2)}\n`);
    writeOverlay(`${JSON.stringify({ mode: 'suggest' }, null, 2)}\n`);

    const resolution = resolvePolicy(repo);

    expect(resolution.source, 'the file is still what decided the identity').toBe('local');
    expect(resolution.overridden, 'setting a key is not disagreeing about it').toEqual([]);
  });
});

describe('#709 the identity hash describes the policy that ran', () => {
  it('does not move for a repository that has no overlay', () => {
    // The condition on the whole feature. A pending transaction stamps this
    // hash and the hook compares it; a digest that shifted under an unchanged
    // repository would refuse every capture in flight across the upgrade.
    expect(resolvePolicy(repo).identityHash).toBe(computePolicyIdentityHash(POLICY_DEFAULTS));

    const bytes = commitPolicy(`${JSON.stringify({ mode: 'suggest' }, null, 2)}\n`);
    expect(resolvePolicy(repo).identityHash, 'still the file bytes, as ADR-0021 set it').toBe(
      sha256(bytes),
    );
  });

  it('is taken over the effective policy once an overlay decides it', () => {
    const bytes = commitPolicy(`${JSON.stringify({ mode: 'suggest' }, null, 2)}\n`);
    writeOverlay(`${JSON.stringify({ mode: 'auto' }, null, 2)}\n`);

    const resolution = resolvePolicy(repo);

    // Neither file's bytes describe what ran, so neither may be the identity.
    expect(resolution.identityHash).not.toBe(sha256(bytes));
    expect(resolution.identityHash).not.toBe(computePolicyIdentityHash(POLICY_DEFAULTS));
    expect(resolution.identityHash).toBe(
      sha256(
        `${JSON.stringify(
          {
            mode: 'auto',
            unattended: false,
            max_records_per_commit: 1,
            require_verified_evidence: true,
          },
          null,
          2,
        )}\n`,
      ),
    );
  });

  it('carries unattended, which the defaults digest deliberately omits', () => {
    // #511 leaves `unattended` out of the defaults digest because the setting
    // can only be turned on by a file, and a file's identity is its own bytes.
    // An overlay breaks that premise: it turns the setting on from a file whose
    // bytes are not the digest input, so the value has to travel in the digest.
    commitPolicy(`${JSON.stringify({ mode: 'auto' }, null, 2)}\n`);

    writeOverlay(`${JSON.stringify({ unattended: false }, null, 2)}\n`);
    const off = resolvePolicy(repo).identityHash;

    writeOverlay(`${JSON.stringify({ unattended: true }, null, 2)}\n`);
    const on = resolvePolicy(repo).identityHash;

    expect(resolvePolicy(repo).policy.unattended).toBe(true);
    expect(on, 'a consent change the digest could not see is a record misreporting itself').not.toBe(
      off,
    );
  });

  it('moves when the overlay changes a value, so a capture in flight is refused', () => {
    commitPolicy(`${JSON.stringify({ max_records_per_commit: 2 }, null, 2)}\n`);
    const before = resolvePolicy(repo).identityHash;

    writeOverlay(`${JSON.stringify({ max_records_per_commit: 5 }, null, 2)}\n`);

    expect(resolvePolicy(repo).identityHash).not.toBe(before);
  });
});

describe('#709 a file the resolver cannot use is named, not ignored', () => {
  it('rejects an overlay with an unknown key and says which file', () => {
    commitPolicy(`${JSON.stringify({ mode: 'auto' }, null, 2)}\n`);
    writeOverlay(`${JSON.stringify({ made_up: true }, null, 2)}\n`);

    const resolution = resolvePolicy(repo);

    expect(resolution.ok).toBe(false);
    expect(resolution.error).toContain(POLICY_LOCAL_FILE_NAME);
    expect(resolution.error).toContain('made_up');
    expect(resolution.policy, 'a rejected policy runs on the defaults, as before').toEqual(
      POLICY_DEFAULTS,
    );
  });

  it('rejects an overlay that is not JSON', () => {
    writeOverlay('{ nope\n');

    const resolution = resolvePolicy(repo);

    expect(resolution.ok).toBe(false);
    expect(resolution.error).toContain(`${POLICY_LOCAL_FILE_NAME} is not valid JSON`);
  });

  it('names both files when the two together are incoherent', () => {
    // `unattended` is honoured in auto mode only. Split across two files, the
    // error has to say where each half came from or it blames a file that is
    // fine on its own.
    commitPolicy(`${JSON.stringify({ mode: 'suggest' }, null, 2)}\n`);
    writeOverlay(`${JSON.stringify({ unattended: true }, null, 2)}\n`);

    const resolution = resolvePolicy(repo);

    expect(resolution.ok).toBe(false);
    expect(resolution.error).toContain(POLICY_LOCAL_FILE_NAME);
    expect(resolution.error).toContain(POLICY_FILE_NAME);
    expect(resolution.error).toContain('suggest');
  });
});

describe('#709 auto writes the file this machine keeps its answer in', () => {
  it('creates the overlay on --local and leaves the tracked file alone', () => {
    const bytes = commitPolicy(`${JSON.stringify({ mode: 'auto', unattended: false }, null, 2)}\n`);

    const result = setUnattendedCapture(repo, true, { local: true });

    expect(result.ok).toBe(true);
    expect(result.ok && result.scope).toBe('local');
    expect(result.path).toBe(join(repo, POLICY_LOCAL_FILE_NAME));
    expect(readFileSync(join(repo, POLICY_FILE_NAME), 'utf8')).toBe(bytes);
    expect(dirtyTracked(), 'the reported failure was a release script refusing a dirty tree').toEqual(
      [],
    );
    expect(resolvePolicy(repo).policy.unattended).toBe(true);
  });

  it('writes only the keys the setting needs, so later repository changes still apply', () => {
    commitPolicy(`${JSON.stringify({ mode: 'auto', max_records_per_commit: 2 }, null, 2)}\n`);

    setUnattendedCapture(repo, true, { local: true });

    expect(JSON.parse(readFileSync(join(repo, POLICY_LOCAL_FILE_NAME), 'utf8'))).toEqual({
      mode: 'auto',
      unattended: true,
    });

    // The repository raises its own limit; the overlay must not be pinning it.
    writeFileSync(
      join(repo, POLICY_FILE_NAME),
      `${JSON.stringify({ mode: 'auto', max_records_per_commit: 7 }, null, 2)}\n`,
    );
    expect(resolvePolicy(repo).policy.max_records_per_commit).toBe(7);
  });

  it('writes the overlay once it exists, without being asked again', () => {
    const bytes = commitPolicy(`${JSON.stringify({ mode: 'auto', unattended: true }, null, 2)}\n`);
    writeOverlay(`${JSON.stringify({ unattended: true }, null, 2)}\n`);

    const result = setUnattendedCapture(repo, false);

    expect(result.ok && result.scope).toBe('local');
    expect(result.ok && result.changed).toBe(true);
    expect(readFileSync(join(repo, POLICY_FILE_NAME), 'utf8')).toBe(bytes);
    expect(resolvePolicy(repo).policy.unattended).toBe(false);
  });

  it('writes the committed file when there is no overlay, as it always did', () => {
    const result = setUnattendedCapture(repo, true);

    expect(result.ok && result.scope).toBe('repository');
    expect(result.path).toBe(join(repo, POLICY_FILE_NAME));
    expect(existsSync(join(repo, POLICY_LOCAL_FILE_NAME)), 'not created behind the operator').toBe(
      false,
    );
  });

  it('creates nothing when the requested state already applies', () => {
    commitPolicy(`${JSON.stringify({ mode: 'auto', unattended: false }, null, 2)}\n`);

    const result = setUnattendedCapture(repo, false, { local: true });

    expect(result.ok && result.changed).toBe(false);
    expect(
      existsSync(join(repo, POLICY_LOCAL_FILE_NAME)),
      'an overlay saying nothing new still moves the identity hash',
    ).toBe(false);
  });

  it('refuses rather than overwriting an overlay it cannot read', () => {
    writeOverlay('{ broken\n');

    const result = setUnattendedCapture(repo, true, { local: true });

    expect(result.ok).toBe(false);
    expect(readFileSync(join(repo, POLICY_LOCAL_FILE_NAME), 'utf8')).toBe('{ broken\n');
  });
});

describe('#709 doctor makes the precedence visible', () => {
  const overlayCheck = (): { status: string; detail: string } => {
    const found = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'policy-overlay');
    if (found === undefined) throw new Error('doctor has no policy-overlay check');
    return { status: found.status, detail: found.detail };
  };

  it('names both values and the effective one', () => {
    commitPolicy(`${JSON.stringify({ mode: 'suggest', unattended: false }, null, 2)}\n`);
    writeOverlay(`${JSON.stringify({ mode: 'auto', unattended: true }, null, 2)}\n`);

    const result = overlayCheck();

    // ok, not warn: the operator wrote the overlay on purpose, and a warning
    // that fires forever on a correct machine teaches people to ignore the
    // surface that carries the real ones.
    expect(result.status).toBe('ok');
    expect(result.detail).toContain(POLICY_FILE_NAME);
    expect(result.detail).toContain(POLICY_LOCAL_FILE_NAME);
    expect(result.detail, 'the repository value').toContain('"suggest"');
    expect(result.detail, 'the effective value').toContain('"auto"');
    expect(result.detail).toContain('unattended');
  });

  it('says so when an overlay exists and changes nothing', () => {
    commitPolicy(`${JSON.stringify({ mode: 'suggest' }, null, 2)}\n`);
    writeOverlay(`${JSON.stringify({ mode: 'suggest' }, null, 2)}\n`);

    const result = overlayCheck();

    expect(result.status).toBe('ok');
    expect(result.detail).toMatch(/changes nothing/);
  });

  it('warns that neither file is in force when the overlay is rejected', () => {
    commitPolicy(`${JSON.stringify({ mode: 'suggest' }, null, 2)}\n`);
    writeOverlay(`${JSON.stringify({ made_up: 1 }, null, 2)}\n`);

    const result = overlayCheck();

    expect(result.status).toBe('warn');
    expect(result.detail).toContain(POLICY_LOCAL_FILE_NAME);
    expect(result.detail, 'the committed file is not in force either').toMatch(/built-in defaults/);
  });

  it('reports ok and names no overlay when there is none', () => {
    commitPolicy(`${JSON.stringify({ mode: 'suggest' }, null, 2)}\n`);

    const result = overlayCheck();

    expect(result.status).toBe('ok');
    expect(result.detail).toMatch(/no \.commitlore-policy\.local\.json/);
  });
});
