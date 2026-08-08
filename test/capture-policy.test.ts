/**
 * T-1110 — user-editable policy file, after consolidating the triplicated
 * policy identity (acceptance row B-7, matrix row P1-5).
 *
 * The first two tests are the bound precondition, not the feature: at
 * `da1c733` the defaults object and `computePolicyIdentityHash` existed three
 * times independently, under two different constant names, agreeing only
 * because three object literals happened to list the same keys in the same
 * order — which is what `JSON.stringify` serialises. Nothing tested that they
 * agreed. Changing the hash input in three places is how a stage-versus-consume
 * comparison starts silently disagreeing.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  POLICY_DEFAULTS,
  POLICY_FILE_NAME,
  computePolicyIdentityHash,
  resolvePolicy,
} from '../src/core/capture-policy.js';

/**
 * The default-policy digest measured at `da1c733`, before consolidation.
 * Consolidation must not change it: every pending file in flight on any machine
 * would otherwise report a policy change that never happened.
 */
const PINNED_DEFAULT_DIGEST = '02bd63fd270db510791fafbd80f4b735f228d8f26b635c4c5312c04b40780b31';

/**
 * What the defaults hashed to before ADR-0030 changed `mode` from `suggest` to
 * `auto`. Kept named rather than deleted: a pending record written under it is
 * refused after the upgrade, and that refusal is the identity hash doing its
 * job, not a regression to hunt.
 */
const PRE_ADR30_DIGEST = '702612744c741f34141b0329f2a42a5a1623bee5a8d6cff61d49c2c613fbc4c5';

const SRC_FILES = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...SRC_FILES(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
};

let repo: string;

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'commitlore-policy-'));
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('T-1110 precondition: one definition of the policy identity', () => {
  it('the default policy digest equals the value pinned before consolidation', () => {
    expect(computePolicyIdentityHash(POLICY_DEFAULTS)).toBe(PINNED_DEFAULT_DIGEST);
  });

  it('no file outside src/core/capture-policy.ts defines the policy identity or its defaults', () => {
    const offenders: string[] = [];
    for (const file of SRC_FILES('src')) {
      if (file.endsWith(join('core', 'capture-policy.ts'))) continue;
      const body = readFileSync(file, 'utf8');
      const definesHash = /const\s+computePolicyIdentityHash\s*=/.test(body);
      const definesDefaults =
        /(HARDCODED_DEFAULTS|CAPTURE_POLICY_DEFAULTS)\s*=\s*\{/.test(body) ||
        (body.includes('max_records_per_commit:') && body.includes('require_verified_evidence:'));
      if (definesHash || definesDefaults) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('T-1110 resolution with no policy file', () => {
  it('produces the hardcoded defaults and the pinned digest', () => {
    const r = resolvePolicy(repo);
    expect(r.ok).toBe(true);
    expect(r.policy).toEqual(POLICY_DEFAULTS);
    expect(r.identityHash).toBe(PINNED_DEFAULT_DIGEST);
    expect(r.source).toBe('defaults');
    expect(r.error).toBeNull();
  });

  it('no longer matches a pending record written before ADR-0030, and that is the point', () => {
    // ADR-0030 changed the default mode, so the defaults hash differently. A
    // pending record written under the old default is refused at stage with
    // "policy identity changed since prepare" — which is exactly what the hash
    // exists to catch (ADR-0021 §7). The cost is bounded: a pending record
    // expires five minutes after staging and 24 hours from creation, so only a
    // capture in flight across the upgrade is lost.
    expect(resolvePolicy(repo).identityHash).not.toBe(PRE_ADR30_DIGEST);
    expect(resolvePolicy(repo).identityHash).toBe(PINNED_DEFAULT_DIGEST);
  });
});

describe('T-1110 resolution with a policy file', () => {
  it('hashes the file contents, not the parsed object', () => {
    const contents = `{\n  "max_records_per_commit": 2\n}\n`;
    writeFileSync(join(repo, POLICY_FILE_NAME), contents);
    const r = resolvePolicy(repo);
    expect(r.ok).toBe(true);
    expect(r.source).toBe('repository');
    expect(r.policy.max_records_per_commit).toBe(2);
    expect(r.identityHash).toBe(createHash('sha256').update(contents).digest('hex'));
    expect(r.identityHash).not.toBe(PINNED_DEFAULT_DIGEST);
  });

  it('fills unset keys from the defaults without changing the hash input', () => {
    const contents = '{"max_records_per_commit": 3}';
    writeFileSync(join(repo, POLICY_FILE_NAME), contents);
    const r = resolvePolicy(repo);
    expect(r.policy.mode).toBe(POLICY_DEFAULTS.mode);
    expect(r.policy.require_verified_evidence).toBe(POLICY_DEFAULTS.require_verified_evidence);
    expect(r.identityHash).toBe(createHash('sha256').update(contents).digest('hex'));
  });

  it('rejects an undeclared key rather than merging it', () => {
    writeFileSync(join(repo, POLICY_FILE_NAME), '{"max_records_per_commit": 2, "allow_anything": true}');
    const r = resolvePolicy(repo);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('allow_anything');
    expect(r.policy).toEqual(POLICY_DEFAULTS);
  });

  it('reports an invalid value with the key named, and retains the previous behaviour', () => {
    writeFileSync(join(repo, POLICY_FILE_NAME), '{"max_records_per_commit": 0}');
    const r = resolvePolicy(repo);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('max_records_per_commit');
    expect(r.policy).toEqual(POLICY_DEFAULTS);
  });

  it('reports unparseable JSON and never falls back silently', () => {
    writeFileSync(join(repo, POLICY_FILE_NAME), '{ not json');
    const r = resolvePolicy(repo);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.policy).toEqual(POLICY_DEFAULTS);
    // The identity hash must describe the policy that actually ran, which is
    // the defaults — never the file it could not read.
    expect(r.identityHash).toBe(PINNED_DEFAULT_DIGEST);
  });

  it('refuses a policy value that is not one of the declared types', () => {
    writeFileSync(join(repo, POLICY_FILE_NAME), '{"mode": "enforce-everything"}');
    const r = resolvePolicy(repo);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('mode');
  });
});

describe('T-1110 one location, so precedence cannot be ambiguous', () => {
  it('reads only the repository-local file and never a user-global one', () => {
    // A file outside the repository must have no effect: shipping one location
    // is how PRD-F13 requirement 11 is satisfied without an ambiguous
    // precedence rule.
    const outside = mkdtempSync(join(tmpdir(), 'commitlore-global-'));
    try {
      writeFileSync(join(outside, POLICY_FILE_NAME), '{"max_records_per_commit": 9}');
      const r = resolvePolicy(repo);
      expect(r.policy.max_records_per_commit).toBe(POLICY_DEFAULTS.max_records_per_commit);
      expect(r.source).toBe('defaults');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('resolves the repository root from a subdirectory, so the CLI and the hook agree', () => {
    writeFileSync(join(repo, POLICY_FILE_NAME), '{"max_records_per_commit": 4}');
    const sub = join(repo, 'nested', 'deeper');
    execFileSync('mkdir', ['-p', sub]);
    expect(resolvePolicy(sub).policy.max_records_per_commit).toBe(4);
  });
});

describe('T-1110 the error reaches the user', () => {
  it('prepare carries a named policy error rather than swallowing it', async () => {
    const { prepareCaptureContext } = await import('../src/core/capture-prepare.js');
    writeFileSync(join(repo, 'a.txt'), 'hello\n');
    git('add', 'a.txt');
    git('commit', '--quiet', '-m', 'seed');
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    git('add', 'a.txt');
    writeFileSync(join(repo, POLICY_FILE_NAME), '{ not json');

    const result = prepareCaptureContext({ cwd: repo, transcript: 'we chose X over Y' });
    expect(result.policy_error).toBeTruthy();
    expect(result.policy_error).toContain(POLICY_FILE_NAME);
    // The identity must describe the policy that actually ran.
    expect(result.policy_identity_hash).toBe(PINNED_DEFAULT_DIGEST);
  });

  it('carries null when the policy resolved cleanly', async () => {
    const { prepareCaptureContext } = await import('../src/core/capture-prepare.js');
    writeFileSync(join(repo, 'a.txt'), 'hello\n');
    git('add', 'a.txt');
    git('commit', '--quiet', '-m', 'seed');
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    git('add', 'a.txt');

    const result = prepareCaptureContext({ cwd: repo, transcript: 'we chose X over Y' });
    expect(result.policy_error).toBeNull();
  });
});

describe('T-1110 untrusted input', () => {
  it('never lets the policy file carry a path or a command', () => {
    writeFileSync(
      join(repo, POLICY_FILE_NAME),
      '{"max_records_per_commit": 2, "bin": "/tmp/evil", "command": "rm -rf /"}',
    );
    const r = resolvePolicy(repo);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.policy)).not.toContain('/tmp/evil');
    expect(JSON.stringify(r.policy)).not.toContain('rm -rf');
  });
});

/**
 * ADR-0030 decisions 1 and 5: capture runs unattended by default, a repository
 * can turn it off, and a record staged without anyone reading it says so.
 */
describe('ADR-0030 capture modes', () => {
  it('defaults to auto — unattended is the shipped behaviour', () => {
    expect(resolvePolicy(repo).policy.mode).toBe('auto');
  });

  it('accepts each of the three modes from a policy file', () => {
    for (const mode of ['auto', 'suggest', 'off'] as const) {
      writeFileSync(join(repo, POLICY_FILE_NAME), `{ "mode": "${mode}" }\n`);
      const resolved = resolvePolicy(repo);
      expect(resolved.error, `mode ${mode} was rejected`).toBeNull();
      expect(resolved.policy.mode).toBe(mode);
    }
    rmSync(join(repo, POLICY_FILE_NAME), { force: true });
  });

  it('names all three in the error for an unknown mode, rather than the old single value', () => {
    writeFileSync(join(repo, POLICY_FILE_NAME), `{ "mode": "ask-nicely" }\n`);
    const resolved = resolvePolicy(repo);
    expect(resolved.error).toMatch(/"auto"/);
    expect(resolved.error).toMatch(/"suggest"/);
    expect(resolved.error).toMatch(/"off"/);
    rmSync(join(repo, POLICY_FILE_NAME), { force: true });
  });

  /**
   * Each mode has a different identity, so switching one is a policy change the
   * hook detects between stage and commit — the property ADR-0021 §7 built the
   * hash for.
   */
  it('gives each mode its own identity', () => {
    const digests = new Set<string>();
    for (const mode of ['auto', 'suggest', 'off'] as const) {
      writeFileSync(join(repo, POLICY_FILE_NAME), `{ "mode": "${mode}" }\n`);
      digests.add(resolvePolicy(repo).identityHash);
    }
    expect(digests.size).toBe(3);
    rmSync(join(repo, POLICY_FILE_NAME), { force: true });
  });
});
