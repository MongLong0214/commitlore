/**
 * T-1605 (#742): `doctor` carries staleness, because neither other mechanism
 * can.
 *
 * The notice is silent for every `--json` invocation, so without this the one
 * structured contract anybody consumes could not report a stale install — it
 * would be missing from exactly the output built for programs to read.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PACKAGE_ROOT, 'dist', 'commitlore.mjs');
const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `cl-drel-${label}-`));

const remoteWithTags = (tags: readonly string[]): string => {
  const dir = join(scratch('remote'), 'origin');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', dir]);
  const work = join(scratch('work'), 'work');
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', work]);
  execFileSync('git', ['-C', work, 'config', 'user.email', 'test@example.invalid']);
  execFileSync('git', ['-C', work, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', work, 'commit', '--allow-empty', '--quiet', '-m', 'root']);
  for (const tag of tags) execFileSync('git', ['-C', work, 'tag', tag]);
  execFileSync('git', ['-C', work, 'remote', 'add', 'origin', dir]);
  execFileSync('git', ['-C', work, 'push', '--quiet', '--tags', 'origin', 'main']);
  return dir;
};

const runDoctor = (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { out: string; err: string; code: number } => {
  const repo = join(scratch('repo'), 'repo');
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', repo]);
  try {
    const out = execFileSync(process.execPath, [CLI, 'doctor', ...args], {
      encoding: 'utf8',
      cwd: repo,
      env: { ...process.env, HOME: scratch('home'), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { out, err: '', code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { out: e.stdout ?? '', err: e.stderr ?? '', code: e.status ?? 1 };
  }
};

const row = (json: string): { status?: string; detail?: string; evidence?: Record<string, string> } => {
  const parsed = JSON.parse(json) as { checks?: Array<{ id: string }> };
  return (parsed.checks ?? []).find((c) => c.id === 'release-freshness') ?? {};
};

describe('T-1605 doctor reports staleness', () => {
  // Both, asserted separately: a field with no prose is invisible to a human,
  // prose with no field is invisible to a script, and this ticket exists
  // because one of those already happened.
  it('names a newer release in the prose report', () => {
    const { out } = runDoctor([], { COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']) });
    expect(out).toContain('release freshness');
    expect(out).toContain('v99.0.0');
  });

  it('carries it in --json, which is the case that makes this necessary', () => {
    const { out } = runDoctor(['--json'], { COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']) });
    const found = row(out);
    expect(found.evidence?.['latest']).toBe('v99.0.0');
    expect(found.evidence?.['update_available']).toBe('true');
  });

  it('ignores CI, unlike the notice — a report that omits itself when piped lies', () => {
    const { out } = runDoctor(['--json'], {
      CI: '1',
      COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']),
    });
    expect(row(out).evidence?.['latest']).toBe('v99.0.0');
  });

  it('says checking is disabled rather than reporting up to date', () => {
    const { out } = runDoctor(['--json'], { COMMITLORE_NO_UPDATE_CHECK: '1' });
    const found = row(out);
    expect(found.status).toBe('skipped');
    expect(found.evidence?.['disabled_by']).toBe('COMMITLORE_NO_UPDATE_CHECK');
    expect(found.evidence?.['latest']).not.toBe('up to date');
  });

  it('says it does not know when the check could not run', () => {
    const { out } = runDoctor(['--json'], {
      COMMITLORE_INSTALL_SOURCE: join(scratch('gone'), 'not-a-repository.git'),
    });
    const found = row(out);
    expect(found.status).toBe('skipped');
    expect(found.evidence?.['latest']).toBe('unknown');
  });

  it('does not change doctor’s exit code when a newer release exists', () => {
    const fresh = runDoctor([], { COMMITLORE_NO_UPDATE_CHECK: '1' });
    const stale = runDoctor([], { COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']) });
    expect(stale.code).toBe(fresh.code);
  });

  // Asserted here as well as in T-1604, because a double report is what two
  // mechanisms owning one fact produces.
  it('prints no trailing notice of its own', () => {
    const { err } = runDoctor([], { COMMITLORE_INSTALL_SOURCE: remoteWithTags(['v99.0.0']) });
    expect(err).not.toContain('is available (running');
  });
});
