/**
 * #951 item 1: the index paid a process to re-derive a block it already held.
 *
 * `readCommitRecords` reads `TRAILERS_ATOM` in the same `git log` that fetches
 * the commit, so the message's own trailer block arrives with the walk. The
 * recovery pass then called `parseRecordBlocks(message)` with no `last`, which
 * spawns `git interpret-trailers --parse` to work out the block that was
 * already in hand — 94 processes on this repository's history, and 244 of the
 * 261 git processes a cold rebuild spent were `interpret-trailers`.
 *
 * `stale` and `squash-preserve` were moved onto `parseRecordBlocksWithAtom`
 * for this reason and the index was left behind.
 *
 * The fixtures below are shaped so the saving is the whole of the count. A
 * message reaches the recovery pass when `record-id` appears more than once,
 * and pays one process per earlier paragraph that mentions it. Put both
 * mentions in the message's own trailer block and no earlier paragraph is a
 * candidate: every process the pass spends is then the re-derivation, so the
 * expected count is zero rather than "fewer than before".
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'commitlore.mjs');

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const scratch = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-atom-${label}-`));
  temporaries.push(dir);
  return dir;
};

const GIT_IDENTITY = [
  '-c',
  'user.name=CommitLore Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

/**
 * A git that logs its own argv before running.
 *
 * The same shape `test/update-apply.test.ts` uses: the log arrives through the
 * environment rather than living beside the shim, so a run cannot read another
 * run's calls.
 */
const CALL_LOG_VAR = 'COMMITLORE_TEST_CALL_LOG';

const gitShim = (): string => {
  const dir = scratch('bin');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  writeFileSync(
    join(dir, 'git'),
    `#!/bin/sh\necho "git $*" >> "\${${CALL_LOG_VAR}:-/dev/null}"\nexec ${realGit} "$@"\n`,
  );
  execFileSync('chmod', ['+x', join(dir, 'git')]);
  return dir;
};

/**
 * `count` commits whose own trailer block mentions `record-id` twice and whose
 * body mentions it not at all.
 *
 * The second mention is a `Warn:` value, which is a real record line rather
 * than a contrivance: a warning about records is the ordinary way a message
 * says the word twice.
 */
const repoWithSelfMentioningRecords = (count: number): string => {
  const dir = scratch('repo');
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir });
  for (let i = 0; i < count; i += 1) {
    writeFileSync(join(dir, `file-${String(i)}.txt`), `revision ${String(i)}\n`);
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync(
      'git',
      [
        ...GIT_IDENTITY,
        'commit',
        '-q',
        '--no-verify',
        '-m',
        `change ${String(i)}\n\n` +
          'A constraint the diff cannot show, written without the word in it.\n\n' +
          `Record-Id: r-atom${i.toString(36)}\n` +
          'Warn: whoever edits this next should check the record-id on the parent\n' +
          'Blast: local\n',
      ],
      { cwd: dir },
    );
  }
  return dir;
};

interface RebuildResult {
  parses: number;
  totalGit: number;
  trailers: number;
}

const rebuild = (repo: string): RebuildResult => {
  const bin = gitShim();
  const log = join(scratch('log'), 'calls.txt');
  writeFileSync(log, '');
  const result = spawnSync(process.execPath, [CLI, 'index', '--rebuild', '--json'], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      [CALL_LOG_VAR]: log,
    },
  });
  if (result.status !== 0) {
    throw new Error(`index --rebuild failed (${String(result.status)}): ${result.stderr}`);
  }
  const calls = readFileSync(log, 'utf8').split('\n').filter((line) => line !== '');
  const parsed = JSON.parse(result.stdout) as { trailersIndexed?: number };
  return {
    parses: calls.filter((line) => line.includes('interpret-trailers')).length,
    totalGit: calls.length,
    trailers: parsed.trailersIndexed ?? 0,
  };
};

describe('#951 the index reuses the block the walk already read', () => {
  it('spends no interpret-trailers process on a message with no earlier candidate', () => {
    const commits = 24;
    const outcome = rebuild(repoWithSelfMentioningRecords(commits));

    // The premise: these commits really were indexed. Without it a rebuild that
    // read nothing would also spend no processes, and pass.
    expect(outcome.trailers).toBe(commits * 3);
    expect(outcome.totalGit).toBeGreaterThan(0);

    // Every message here reaches the recovery pass and offers it no candidate
    // paragraph, so the only process the pass could spend is the one that
    // re-derives the block the atom already carried.
    expect(outcome.parses).toBe(0);
  }, 300_000);
});
