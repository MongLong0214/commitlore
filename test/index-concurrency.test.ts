/**
 * #420: the PreToolUse hook fires per edit, so several `commitlore inject`
 * processes overlap whenever an agent touches files in quick succession. A
 * current index must remain usable to all of them under SQLite contention.
 *
 * With no `busy_timeout`, SQLite fails a contended reader immediately and
 * `openSource` answers from a full scan instead. The answer stays correct — the
 * fallback is the fail-safe design working — but at 100,000 commits an indexed
 * `context` is 496 ms p50 against 86,673 ms for the scan (`docs/evidence.md`),
 * so losing a current index to contention that would have cleared in
 * milliseconds is expensive. A missing index is a separate #522 case: queries
 * scan git and leave explicit `index`/`init` to build the derived file.
 *
 * Two things are asserted, and they fail for different reasons:
 *
 * 1. **Correctness under contention** — every concurrent answer equals the one
 *    a serial warm-index run gives. This held before the fix too, and it is
 *    here so a future change to the locking cannot trade the answer for speed.
 * 2. **The index is actually used** — no run falls back. This is what #420
 *    changed.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { createTestRepo } from './git-fixtures.js';

const run = promisify(execFile);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO_ROOT, 'dist', 'cli.js');

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): void => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
};

/** How many files, and therefore how many concurrent injections. */
const FANOUT = 8;

/** Enough commits that a rebuild is not instantaneous, few enough to stay quick. */
const COMMITS = 40;

const repoWithRecords = (label: string): string => {
  const dir = createTestRepo({
    path: mkdtempSync(join(realpathSync(tmpdir()), `commitlore-${label}-`)),
  });
  scratch.push(dir);
  git(dir, ['config', 'user.email', 'fixture@example.invalid']);
  git(dir, ['config', 'user.name', 'fixture']);
  mkdirSync(join(dir, 'src'), { recursive: true });

  for (let i = 1; i <= COMMITS; i += 1) {
    writeFileSync(join(dir, 'src', `f${i}.ts`), `export const v${i} = ${i};\n`);
    git(dir, ['add', '-A']);
    git(dir, [
      'commit',
      '--quiet',
      '-m',
      `Add module ${i}\n\nLimit: module ${i} has a constraint that must hold\n` +
        `Ruled-out: alternative ${i} | rejected for reason ${i}\n` +
        `Record-Id: r-conc${i}\nProvenance: authored\n`,
    ]);
  }
  return dir;
};

const inject = async (cwd: string, file: string): Promise<{ stdout: string; stderr: string }> => {
  try {
    return await run(process.execPath, [CLI, 'inject', '--path', `src/${file}`], { cwd });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(`inject failed for ${file}: ${failure.stderr ?? String(error)}`);
  }
};

describe('#420 concurrent injections keep using a current index', () => {
  it('answers identically under contention, and keeps using the index', async () => {
    const dir = repoWithRecords('concurrency');
    const files = Array.from({ length: FANOUT }, (_, i) => `f${i + 1}.ts`);

    // Reference: serial, warm index. This is the answer contention must not change.
    await run(process.execPath, [CLI, 'index', '--rebuild'], { cwd: dir });
    const reference: string[] = [];
    for (const file of files) reference.push((await inject(dir, file)).stdout);
    expect(reference.every((text) => text.length > 0)).toBe(true);

    // The same valid index is read concurrently. The busy timeout must keep a
    // temporary checkpoint from turning an indexed read into a scan.
    const concurrent = await Promise.all(files.map((file) => inject(dir, file)));

    concurrent.forEach((result, index) => {
      expect(result.stdout, `payload for ${files[index]} changed under contention`).toBe(
        reference[index],
      );
    });

    const fellBack = concurrent
      .map((result, index) => ({ file: files[index], stderr: result.stderr }))
      .filter(({ stderr }) => stderr.includes('the index is unavailable'));

    expect(
      fellBack.map(({ file, stderr }) => `${file}: ${stderr.trim()}`),
      'a concurrent injection lost the index and answered from a full scan',
    ).toEqual([]);
  }, 120_000);

  it('leaves a cold index absent after concurrent fallback scans', async () => {
    const dir = repoWithRecords('concurrency-health');
    const files = Array.from({ length: FANOUT }, (_, i) => `f${i + 1}.ts`);

    rmSync(join(dir, '.git', 'commitlore'), { recursive: true, force: true });
    await Promise.all(files.map((file) => inject(dir, file)));

    const doctor = await run(process.execPath, [CLI, 'doctor', '--json'], { cwd: dir });
    const report = JSON.parse(doctor.stdout) as {
      checks: { id: string; status: string; detail: string }[];
    };
    const health = report.checks.find((entry) => entry.id === 'index-health');
    expect(health?.status, health?.detail).toBe('warn');
    expect(health?.detail).toContain('no index yet');
  }, 120_000);
});
