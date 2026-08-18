/**
 * What happens to a damaged index, now that the b-tree walk is off the read
 * path (#782).
 *
 * `healthProblem` used to run `PRAGMA quick_check(1)` before every answer,
 * which turned structural damage into a rebuild before any query could reach
 * it. That walk cost 62 ms median on a 15 MB index -- about a third of a
 * hook fire that usually has nothing to say -- and it does not cover the case
 * that would actually hurt: SQLite documents that `quick_check` does not
 * verify index content against table content, so a desynchronised secondary
 * index passes it.
 *
 * Moving it is only safe if the two things it was incidentally doing still
 * happen. Nothing asserted either before this file, which is why nothing went
 * red when the walk was removed.
 */

import { execFileSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { closeIndex, ensureIndex, indexDbPath, integrityProblem, rebuildIndex } from '../src/core/index-db.js';
import { runQuery } from '../src/core/query.js';

import { createTestRepo } from './git-fixtures.js';

// `import ... from 'node:sqlite'` is what the source deliberately avoids
// (ADR-0012), and the test build resolves it the same way.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => {
    prepare: (sql: string) => { get: (...args: unknown[]) => unknown };
    close: () => void;
  };
};

const commitWithRecord = (repo: string, file: string, id: string): void => {
  execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '--quiet', '-m',
    `Add ${file}\n\nLimit: corruption fixture\nRecord-Id: ${id}\nProvenance: authored\nCommitLore-Version: 2.0.0`]);
};

/**
 * Flips bytes inside the file, past the header. Writing past the end would
 * extend it instead, which is a different kind of broken -- the first draft of
 * this did that and produced a multi-megabyte sparse file for a 30-commit
 * index, failing for a reason the test was not about.
 */
const damage = (path: string, count: number): void => {
  const size = statSync(path).size;
  const fd = openSync(path, 'r+');
  try {
    const buf = Buffer.alloc(1);
    const start = 4096;
    const span = Math.max(1, size - start - 1);
    for (let i = 0; i < count; i += 1) {
      const at = start + ((i * 97) % span);
      readSync(fd, buf, 0, 1, at);
      buf[0] = (buf[0] ?? 0) ^ 0xff;
      writeSync(fd, buf, 0, 1, at);
    }
  } finally {
    closeSync(fd);
  }
};

const populated = (label: string): string => {
  const repo = createTestRepo({ path: join(mkdtempSync(join(tmpdir(), `cl-corrupt-${label}-`)), 'repo') });
  for (let i = 0; i < 30; i += 1) commitWithRecord(repo, `f${i}.ts`, `r-corrupt${i}`);
  const { handle } = ensureIndex({ cwd: repo });
  rebuildIndex(handle);
  closeIndex(handle);
  return repo;
};

describe('#782 a damaged index', () => {
  it('is still detected — the walk moved to the rebuild, it did not go away', () => {
    const repo = populated('detect');
    const path = indexDbPath(repo);
    const clean = new DatabaseSync(path, { readOnly: true });
    expect(integrityProblem(clean as never)).toBeNull();
    clean.close();

    damage(path, 400);

    // Opened directly rather than through `openIndex`, which rebuilds the FTS
    // table on open and therefore throws on a smashed file before any check
    // runs. That throw predates this change and is filed separately; what is
    // asserted here is only that the scan `rebuildIndex` now consults still
    // recognises damage.
    const broken = new DatabaseSync(path, { readOnly: true });
    try {
      expect(integrityProblem(broken as never)).not.toBeNull();
    } finally {
      broken.close();
    }
  });

  it('answers from a scan rather than crashing or going quiet', () => {
    const repo = populated('query');
    damage(indexDbPath(repo), 400);

    // The failure this guards is specific: `inject --hook-input` fail-opens to
    // empty stdout, so an uncaught read error would reach the agent looking
    // exactly like a path that has no records. An answer must still arrive.
    const result = runQuery({ cwd: repo, path: '.', noIndex: false });
    expect(result.records.length).toBeGreaterThan(0);
  });

  it('keeps the cheap checks on the read path', () => {
    const repo = populated('cheap');
    const { handle } = ensureIndex({ cwd: repo });
    try {
      // Schema version and table presence are `meta` reads at 0.04 ms; they
      // stay. This pins that the split kept them rather than removing the lot.
      expect(integrityProblem(handle.db)).toBeNull();
    } finally {
      closeIndex(handle);
    }
  });
});
