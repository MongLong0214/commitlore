/**
 * #987 narrowed: one request reads each repository fact once.
 *
 * The issue asked for a snapshot that makes a *repeated* request cheap, and its
 * two acceptance bullets could not both hold — a snapshot that "dies with
 * whatever owns the request" is not there for the next request, which is the
 * request the measurement was about. Review settled it: the achievable saving is
 * duplication *inside* one request, and that saving applies to the first request
 * as well as the repeat, so it does not depend on how often a real session
 * repeats a path — which the issue itself said was an assertion rather than a
 * number.
 *
 * What was duplicated, measured on this repository at 1,621 commits with a
 * complete index, in git processes:
 *
 *   before   query 18, the same query again 18   (rev-parse 9, config 4, log 3, show 1, rev-list 1)
 *   after    query 14, the same query again 14   (rev-parse 6, config 4, log 3, show 1)
 *
 * The clearest case, and the one asserted below: `rev-parse --verify --quiet
 * HEAD^{commit}` is run by the index refresh and again by `historyAvailability`,
 * byte-identical argv, in the same call.
 *
 * ## Why the assertion counts one exact argv rather than a total
 *
 * A ceiling on the total would pass for the wrong reason the moment anything
 * else on the path got cheaper or more expensive, and `index-process-budget`
 * already guards totals. This counts the duplication itself: the argv that was
 * run twice must now appear once. Removing `facts` from `runQuery` takes it
 * straight back to two, which is the negative control.
 *
 * What this deliberately does not claim: that nothing else is duplicated.
 * `config` is still read four times per query, and `stale` is untouched at 78.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit, newRepoFacts } from '../src/core/git.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'commitlore.mjs');

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const scratch = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-facts-${label}-`));
  temporaries.push(dir);
  return dir;
};

const IDENTITY = [
  '-c',
  'user.name=CommitLore Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

const git = (dir: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });

/** A git that records its own argv before running. The shim of #959. */
const shim = (): string => {
  const dir = scratch('bin');
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  writeFileSync(
    join(dir, 'git'),
    `#!/bin/sh\necho "$*" >> "\${COMMITLORE_TEST_CALL_LOG:-/dev/null}"\nexec ${real} "$@"\n`,
  );
  execFileSync('chmod', ['+x', join(dir, 'git')]);
  return dir;
};

/**
 * A repository with records, a note, and an index already built.
 *
 * The index has to be complete before the measured call: a cold one rebuilds,
 * and a rebuild's reads would swamp the one duplication under test.
 */
const indexedRepo = (): string => {
  const dir = scratch('repo');
  git(dir, ['init', '-q', '--initial-branch=main']);
  for (let i = 0; i < 6; i += 1) {
    writeFileSync(join(dir, `f-${String(i)}.ts`), `revision ${String(i)}\n`);
    git(dir, ['add', '-A']);
    git(dir, [
      ...IDENTITY,
      'commit',
      '-q',
      '--no-verify',
      '-m',
      `change ${String(i)}\n\nA constraint the diff cannot show.\n\n` +
        `Record-Id: r-facts${String(i).padStart(6, '0')}\nBlast: local\n`,
    ]);
  }
  git(dir, [
    ...IDENTITY,
    'notes',
    '--ref=refs/notes/commitlore',
    'add',
    '-f',
    '-m',
    'note\n\nRecord-Id: r-factsnote01\nWarn: lives in the mirror\nBlast: local\n',
    git(dir, ['rev-parse', 'HEAD']).trim(),
  ]);
  const built = spawnSync(process.execPath, [CLI, 'index', '--rebuild'], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (built.status !== 0) throw new Error(`the fixture could not build its index: ${built.stderr}`);
  return dir;
};

/** Every git argv one `context` invocation ran, in order. */
const argvOfOneQuery = (repo: string): string[] => {
  const log = join(scratch('log'), 'calls.txt');
  writeFileSync(log, '');
  const result = spawnSync(process.execPath, [CLI, 'context', '--json'], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    env: {
      ...process.env,
      PATH: `${shim()}:${process.env['PATH'] ?? ''}`,
      COMMITLORE_TEST_CALL_LOG: log,
    },
  });
  if (result.status !== 0) {
    throw new Error(`context failed (${String(result.status)}): ${result.stderr.slice(0, 400)}`);
  }
  return readFileSync(log, 'utf8').split('\n').filter((line) => line !== '');
};

const HEAD_ARGV = 'rev-parse --verify --quiet HEAD^{commit}';
const NOTES_ARGV = 'rev-parse --verify --quiet refs/notes/commitlore';

describe('#987 one request resolves each repository fact once', () => {
  it('runs the HEAD and notes-ref resolutions once each, not twice', () => {
    const repo = indexedRepo();
    const argv = argvOfOneQuery(repo);

    const heads = argv.filter((line) => line === HEAD_ARGV);
    const notes = argv.filter((line) => line === NOTES_ARGV);

    // The premise: a query that resolved neither would satisfy `<= 1` twice
    // over and guard nothing.
    expect(heads.length, `no HEAD resolution at all in ${JSON.stringify(argv)}`).toBe(1);
    expect(notes.length, `no notes-ref resolution at all in ${JSON.stringify(argv)}`).toBe(1);
  }, 300_000);

  it('memoizes by argv, and only by argv', () => {
    const repo = indexedRepo();
    const facts = newRepoFacts(repo, execGit);

    const first = facts.once(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    const again = facts.once(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    expect(again).toBe(first);
    expect(facts.reused()).toBe(1);

    // A different question is a different answer, never the memoized one.
    const other = facts.once(['rev-parse', '--git-dir']);
    expect(other).not.toBe(first);
    expect(facts.reused()).toBe(1);

    // And the answer is real, not an empty placeholder.
    expect(first.code).toBe(0);
    expect(first.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
  }, 300_000);

  it('does not share between two instances, which is what request scope means', () => {
    // The guard against this becoming a module-level cache. Two facts values are
    // two requests: neither may answer from the other, or the lifetime claim in
    // `newRepoFacts` is false.
    const repo = indexedRepo();
    const one = newRepoFacts(repo, execGit);
    const two = newRepoFacts(repo, execGit);
    one.once(['rev-parse', '--git-dir']);
    two.once(['rev-parse', '--git-dir']);
    expect(one.reused()).toBe(0);
    expect(two.reused()).toBe(0);
  }, 300_000);
});
