import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { collectRecords } from '../src/commands/stale.js';
import { closeIndex, openIndex } from '../src/core/index-db.js';
import { runSquashPreserve } from '../src/commands/squash-preserve.js';
import { readRecord, readRecordBlocks, writeRecordBlocks } from '../src/core/notes.js';
import { runQuery } from '../src/core/query.js';
import { parseRecordBlocks } from '../src/core/trailers.js';
import { createTestRepo } from './git-fixtures.js';

const repos: string[] = [];
afterAll(() => repos.forEach((cwd) => rmSync(cwd, { recursive: true, force: true })));
const git = (cwd: string, args: string[], input?: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', ...(input === undefined ? {} : { input }) });
const head = (cwd: string): string => git(cwd, ['rev-parse', 'HEAD']).trim();

const fixture = (identified = false) => {
  const cwd = mkdtempSync(join(tmpdir(), 'commitlore-no-id-'));
  repos.push(cwd);
  createTestRepo({ path: cwd });
  writeFileSync(join(cwd, 'a.txt'), 'base\n');
  git(cwd, ['add', 'a.txt']);
  git(cwd, ['commit', '-qm', 'base']);
  const base = head(cwd);
  git(cwd, ['checkout', '-qb', 'feat']);
  for (let n = 1; n <= 3; n++) {
    writeFileSync(join(cwd, 'a.txt'), `base\n${n}\n`);
    git(cwd, ['add', 'a.txt']);
    git(cwd, ['commit', '-qF', '-'], `change ${n}\n\nLimit: limit number ${n}\nWarn: warning number ${n}\nRuled-out: choice ${n} | reason ${n}\n${identified ? `Record-Id: r-source1145${n}\n` : ''}`);
  }
  git(cwd, ['checkout', '-q', 'main']);
  git(cwd, ['merge', '-q', '--squash', 'feat']);
  git(cwd, ['commit', '-qm', 'squash of feat']);
  return { cwd, range: `${base}..feat`, target: head(cwd) };
};

describe('#1145 no-ID squash notes', () => {
  it('keeps all three blocks visible on indexed and raw Git readers', () => {
    const f = fixture();
    const preserved = runSquashPreserve(f);
    expect(preserved.code).toBe(0);
    const note = git(f.cwd, ['notes', '--ref=commitlore', 'show', f.target]);
    expect(note).not.toContain('Record-Id:');
    expect(readRecordBlocks(f.target, { cwd: f.cwd })).toHaveLength(3);
    expect(readRecord(f.target, { cwd: f.cwd }).filter((t) => t.key === 'Limit')).toHaveLength(1);
    for (const noIndex of [false, true]) {
      const result = runQuery({ cwd: f.cwd, path: 'a.txt', noIndex });
      expect(result.records).toHaveLength(3);
      for (const key of ['Limit', 'Warn', 'Ruled-out']) {
        expect(result.records.flatMap((r) => r.trailers.filter((t) => t.key === key))).toHaveLength(3);
      }
    }
    expect(git(f.cwd, ['notes', '--ref=commitlore', 'show', f.target])).toBe(note);
    expect(preserved.stderr).not.toContain('only the last');
    expect(collectRecords({ cwd: f.cwd, allHistory: true }).records.filter((r) => r.source === 'notes')).toHaveLength(3);
  });

  it('also recovers pre-existing no-ID canonical notes without rewriting them', () => {
    const f = fixture();
    const note = 'Limit: identical constraint\n\nLimit: identical constraint\n\nLimit: identical constraint\n';
    git(f.cwd, ['notes', '--ref=commitlore', 'add', '-m', note, f.target]);
    expect(runQuery({ cwd: f.cwd, path: 'a.txt' }).records).toHaveLength(3);
    const index = openIndex({ cwd: f.cwd });
    index.db.prepare("UPDATE meta SET v = '5' WHERE k = 'schema_version'").run();
    index.db.prepare("DELETE FROM trailers WHERE source = 'notes' AND block < 2").run();
    closeIndex(index);
    expect(runQuery({ cwd: f.cwd, path: 'a.txt' }).records).toHaveLength(3);
    expect(runQuery({ cwd: f.cwd, path: 'a.txt', noIndex: true }).records).toHaveLength(3);
    expect(git(f.cwd, ['notes', '--ref=commitlore', 'show', f.target])).toBe(note);
    expect(parseRecordBlocks('subject\n\nLimit: body prose\n\nmore body prose')).toEqual([]);
  });

  it('fails a lossy message-only write before modifying the draft', () => {
    const f = fixture();
    const messageFile = join(f.cwd, 'merge-message');
    const before = 'squash of feat\n';
    writeFileSync(messageFile, before);
    const outcome = runSquashPreserve({ cwd: f.cwd, range: f.range, messageFile });
    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toMatch(/read.back|recover/i);
    expect(readFileSync(messageFile, 'utf8')).toBe(before);
    expect(git(f.cwd, ['notes', '--ref=commitlore', 'list'])).toBe('');
  });

  it('retains an earlier identified draft record outside the replaced tail', () => {
    const f = fixture(true);
    const messageFile = join(f.cwd, 'merge-message');
    const before = 'merge subject\n\nLimit: existing decision\nRecord-Id: r-existing1145\n\nadditional merge prose\n';
    writeFileSync(messageFile, before);
    const outcome = runSquashPreserve({ cwd: f.cwd, range: f.range, messageFile });
    expect(outcome.code).toBe(0);
    const after = readFileSync(messageFile, 'utf8');
    expect(after).toContain(before.trimEnd());
    expect(parseRecordBlocks(after)).toHaveLength(4);
  });

  it('refuses a block list whose empty block disappears on readback', () => {
    const f = fixture();
    expect(() => writeRecordBlocks(f.target, [[{ key: 'Limit', value: 'visible' }], []], { cwd: f.cwd })).toThrow(/read.back|recover/i);
    expect(git(f.cwd, ['notes', '--ref=commitlore', 'list'])).toBe('');
  });
});
