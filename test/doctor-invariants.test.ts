/**
 * #461 — doctor's two documented invariants, fenced before the rebuild starts.
 *
 * ADR-0032 §8 promotes both to invariants and PRD §11 requires both tests by
 * name. Neither existed. The behaviour is real today and unfenced: a check
 * added next month that phones home or leaves a state file behind would pass
 * the whole suite.
 *
 * #422's lesson in one line — a property was shipped and never exercised
 * through the surface where it fails. These two were in exactly that state.
 * #63 is the local precedent for the write half: doctor's own `--fix` wrote a
 * fetch refspec that broke `git fetch` for everyone who followed the printed
 * instruction. The write surface of this command has already shipped a defect
 * once.
 *
 * Every later ticket in this milestone rebuilds doctor's internals. These
 * fences go in first so the rebuild has something to fail against.
 *
 * ---------------------------------------------------------------------------
 * TWO BLIND SPOTS, RECORDED RATHER THAN ABSORBED
 * ---------------------------------------------------------------------------
 *
 * 1. Child processes are outside the socket fence. Stubbing Node's own socket
 *    construction cannot see a socket opened by a spawned `git`. Two shipping
 *    checks contact the configured remote that way — `notes-refspec` runs
 *    `git fetch --dry-run <remote>` and `notes-push` runs `git ls-remote
 *    <remote>` (`checkRefspec`, `checkPush`). The socket test below passes in
 *    part because these fixtures use file-path remotes.
 *
 *    PRD §8.1 has since been rescoped to say exactly this: doctor's own
 *    process opens no socket, and network reaches the outside only inside
 *    spawned git transport commands. This file tests the half that is
 *    testable from here and does not pretend to the other.
 *
 * 2. "Zero writes" is scoped to the repository. `hook-runtime` writes its probe
 *    message under `tmpdir()` and removes it, which is outside the fence by
 *    construction. The repository — worktree and `.git/` — is what these
 *    assertions cover.
 *
 * 3. SQLite's sidecars are not a doctor write, and the PRD's wording does not
 *    yet say so. Running these assertions the strict way found it: a plain run
 *    touches `.git/commitlore/index.db-shm` and, under `--fix`, creates it and
 *    `-wal` too. Those are the WAL reader's own bookkeeping — opening a WAL
 *    database at all creates them, for readers as much as writers — and they
 *    carry no committed data. Changing that would mean opening the index
 *    outside WAL for doctor, which trades a documentation problem for the
 *    concurrency one #420 was about.
 *
 *    So the invariant these tests enforce is the one that means something:
 *    **`index.db` itself is byte-identical, and nothing else in the repository
 *    changes except those two sidecars.** PRD §8.2 currently says "zero
 *    writes" without the exception; that wording is wrong as written and is
 *    filed rather than quietly matched to the code here.
 */

import { execFileSync } from 'node:child_process';
import dns from 'node:dns';
import net from 'node:net';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { runDoctor } from '../src/commands/doctor.js';
import { closeIndex, openIndex, rebuildIndex } from '../src/core/index-db.js';
import { createTestRepo } from './git-fixtures.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `cl-inv-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

/**
 * A repository with something for every check to look at: a remote, history,
 * a recorded hook target, an installed hook stub, and an index.
 *
 * It deliberately leaves at least one check failing. PRD §8.2 says a plain run
 * is read-only *including under failure*, and a fixture where everything
 * passes would not exercise the remediation paths at all — which is where a
 * write would most plausibly appear.
 */
const populatedRepo = (label: string): string => {
  const remote = createTestRepo({ path: temp(`${label}-remote`), bare: true });
  const repo = createTestRepo({ path: temp(label) });

  git(repo, ['config', 'user.email', 'owner@example.invalid']);
  git(repo, ['config', 'user.name', 'owner']);
  git(repo, ['remote', 'add', 'origin', remote]);

  writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
  git(repo, ['add', '-A']);
  git(repo, [
    'commit',
    '--no-verify',
    '-m',
    'feat: a\n\nLimit: the v1 runtime has no egress\nRecord-Id: r-inv01\nProvenance: authored',
  ]);

  // A hook whose recorded target does not resolve: `commit-msg-hook` and
  // `hook-runtime` then take their failure paths, which is the point.
  // An empty init template leaves no `hooks/` directory at all.
  const hooks = join(repo, '.git', 'hooks');
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, 'commit-msg'), '#!/bin/sh\nexit 0\n');
  git(repo, ['config', '--local', 'commitlore.bin', join(repo, 'no-such-binary.mjs')]);
  git(repo, ['config', '--local', 'commitlore.node', process.execPath]);
  git(repo, ['config', '--local', 'commitlore.root', realpathSync(PACKAGE_ROOT)]);

  // Closed before the run: an open handle is a writer, and these tests assert
  // that doctor itself writes nothing.
  const handle = openIndex({ cwd: repo });
  rebuildIndex(handle);
  closeIndex(handle);
  return repo;
};

/** Recursive path → size+mtime inventory, for detecting any write. */
const inventory = (root: string): Map<string, string> => {
  const seen = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      try {
        const stat = statSync(full);
        seen.set(relative(root, full), `${String(stat.size)}:${String(stat.mtimeMs)}`);
      } catch {
        // A file that vanished between readdir and stat is itself a change;
        // record the fact rather than skipping it.
        seen.set(relative(root, full), 'vanished');
      }
    }
  };
  walk(root);
  return seen;
};

/** SQLite's own bookkeeping for a WAL database — see blind spot 3. */
const SQLITE_SIDECARS = ['.git/commitlore/index.db-shm', '.git/commitlore/index.db-wal'];

const diff = (before: Map<string, string>, after: Map<string, string>): string[] => {
  const changes: string[] = [];
  for (const [path, stamp] of after) {
    const was = before.get(path);
    if (was === undefined) changes.push(`added ${path}`);
    else if (was !== stamp) changes.push(`modified ${path}`);
  }
  for (const path of before.keys()) if (!after.has(path)) changes.push(`removed ${path}`);
  return changes.sort();
};

const localConfig = (repo: string): string => git(repo, ['config', '--list', '--local']);

describe('#461 doctor invariants', () => {
  it('leaves the repository byte-identical without --fix, including under failure', () => {
    const repo = populatedRepo('readonly');
    const report = runDoctor({ cwd: repo });

    // The fixture has to be exercising the paths a write would hide in.
    expect(report.checks.some((check) => check.needsAttention)).toBe(true);

    const before = inventory(repo);
    runDoctor({ cwd: repo });
    const after = inventory(repo);
    const changes = diff(before, after).filter(
      (entry) => !SQLITE_SIDECARS.some((sidecar) => entry.endsWith(sidecar)),
    );

    expect(changes, `a plain run wrote to the repository:\n${changes.join('\n')}`).toEqual([]);
    // The invariant that carries the meaning: the data did not move.
    expect(after.get('.git/commitlore/index.db')).toBe(before.get('.git/commitlore/index.db'));
  });

  it('completes every check with this process unable to open a socket', () => {
    // The update-lookup class ADR-0032 §8.1 refuses to ship would fail here.
    // A socket opened by a spawned git is invisible to this stub — see the
    // blind-spot note at the top of the file.
    const repo = populatedRepo('nosocket');

    const realSocket = net.Socket;
    const realConnect = net.connect;
    const realCreate = net.createConnection;
    const realLookup = dns.lookup;
    const refuse = (): never => {
      throw new Error('doctor opened a socket from its own process');
    };

    try {
      (net as unknown as { Socket: unknown }).Socket = refuse;
      (net as unknown as { connect: unknown }).connect = refuse;
      (net as unknown as { createConnection: unknown }).createConnection = refuse;
      (dns as unknown as { lookup: unknown }).lookup = refuse;

      const report = runDoctor({ cwd: repo });
      expect(report.checks.length).toBeGreaterThan(0);
      for (const check of report.checks) {
        expect(['ok', 'warn', 'fail', 'skipped']).toContain(check.status);
      }
    } finally {
      (net as unknown as { Socket: unknown }).Socket = realSocket;
      (net as unknown as { connect: unknown }).connect = realConnect;
      (net as unknown as { createConnection: unknown }).createConnection = realCreate;
      (dns as unknown as { lookup: unknown }).lookup = realLookup;
    }
  });

  it('writes only remote fetch refspecs under --fix', () => {
    // #63: --fix has already shipped one defect through this surface. A second
    // write surface growing here is what this pins.
    const repo = populatedRepo('fix');
    const configBefore = localConfig(repo);
    const before = inventory(repo);

    runDoctor({ cwd: repo, fix: true });

    const added = localConfig(repo)
      .split('\n')
      .filter((line) => line.trim() !== '' && !configBefore.includes(line));
    for (const line of added) {
      expect(line, `--fix wrote a config key outside remote.<name>.fetch: ${line}`).toMatch(
        /^remote\.[^.]+\.fetch=/,
      );
    }

    // Config lives in .git/config, so that file is expected to change; the
    // SQLite sidecars are the reader's own bookkeeping (blind spot 3). Nothing
    // else may move.
    const after = inventory(repo);
    const changes = diff(before, after).filter(
      (entry) =>
        !entry.endsWith('.git/config') &&
        !SQLITE_SIDECARS.some((sidecar) => entry.endsWith(sidecar)),
    );
    expect(changes, `--fix wrote outside the config:\n${changes.join('\n')}`).toEqual([]);
    expect(after.get('.git/commitlore/index.db')).toBe(before.get('.git/commitlore/index.db'));
  });
});
