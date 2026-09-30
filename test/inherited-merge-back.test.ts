import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { buildReport, collectRecords } from '../src/commands/stale.js';
import { runSquashPreserve } from '../src/commands/squash-preserve.js';
import { runQuery } from '../src/core/query.js';
import { createTestRepo } from './git-fixtures.js';

const repos: string[] = [];
afterAll(() => repos.forEach((cwd) => rmSync(cwd, { recursive: true, force: true })));
const git = (cwd: string, args: string[], input?: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', ...(input === undefined ? {} : { input }) });
const head = (cwd: string): string => git(cwd, ['rev-parse', 'HEAD']).trim();
const ID = 'r-mergeback1144';
const LIMIT = 'a.txt grows by one line per change';

const fixture = (provenance?: string, limit = LIMIT) => {
  const cwd = mkdtempSync(join(tmpdir(), 'commitlore-merge-back-'));
  repos.push(cwd);
  createTestRepo({ path: cwd });
  writeFileSync(join(cwd, 'a.txt'), 'a\n');
  git(cwd, ['add', 'a.txt']);
  git(cwd, ['commit', '-qm', 'base']);
  const base = head(cwd);
  git(cwd, ['checkout', '-qb', 'dev']);
  writeFileSync(join(cwd, 'a.txt'), 'a\nb\n');
  git(cwd, ['add', 'a.txt']);
  git(cwd, ['commit', '-qF', '-'], `feat: change a\n\nLimit: ${limit}\nRecord-Id: ${ID}\n` +
    (provenance === undefined ? '' : `Provenance: ${provenance}\n`));
  const origin = head(cwd);
  const message = git(cwd, ['log', '-1', '--format=%B']);
  git(cwd, ['checkout', '-q', 'main']);
  git(cwd, ['merge', '-q', '--squash', 'dev']);
  git(cwd, ['commit', '-qm', 'release squash']);
  const target = head(cwd);
  expect(runSquashPreserve({ cwd, range: `${base}..dev`, target }).code).toBe(0);
  const note = git(cwd, ['notes', '--ref=commitlore', 'show', target]);
  const mergeBack = () => {
    git(cwd, ['checkout', '-q', 'dev']);
    git(cwd, ['merge', '-q', '--no-edit', 'main']);
  };
  const report = () => buildReport(collectRecords({ cwd, allHistory: true }), new Date());
  return { cwd, base, origin, target, message, note, mergeBack, report };
};

describe('#1144 inherited copies after merge-back', () => {
  it.each([undefined, 'drafted', 'authored'])('keeps an inherited %s record collision-free on both readers', (provenance) => {
    const f = fixture(provenance);
    expect(f.report().idCollisions).toEqual([]);
    f.mergeBack();
    expect(f.report().idCollisions).toEqual([]);
    for (const noIndex of [false, true]) {
      const result = runQuery({ cwd: f.cwd, path: 'a.txt', noIndex });
      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.identityCollision).not.toBe(true);
      expect(result.records[0]?.trailers).toContainEqual({ key: 'Limit', value: LIMIT });
      expect(result.diagnostics.join('\n')).not.toMatch(/withheld|make them agree/);
    }
    expect(git(f.cwd, ['log', '-1', '--format=%B', f.origin])).toBe(f.message);
    expect(git(f.cwd, ['notes', '--ref=commitlore', 'show', f.target])).toBe(f.note);
  });

  it('still withholds altered content, without comparing the inherited transport stamp', () => {
    const f = fixture('drafted');
    git(f.cwd, ['notes', '--ref=commitlore', 'add', '-f', '-m', f.note.replace(LIMIT, 'a changed constraint'), f.target]);
    f.mergeBack();
    expect(f.report().idCollisions.map((v) => v.value)).toContain(ID);
    for (const noIndex of [false, true]) {
      const result = runQuery({ cwd: f.cwd, path: 'a.txt', noIndex });
      expect(result.records[0]?.collisionKeys).toEqual(['Limit']);
      expect(result.records[0]?.trailers.some((t) => t.key === 'Limit')).toBe(false);
    }
  });

  it('does not forgive a stamp naming a different reachable commit', () => {
    const f = fixture('drafted');
    git(f.cwd, ['notes', '--ref=commitlore', 'add', '-f', '-m', f.note.replace(f.origin, f.base), f.target]);
    f.mergeBack();
    expect(f.report().idCollisions.map((v) => v.value)).toContain(ID);
  });

  it('does not equate an unreachable source with a new declaration of the same id', () => {
    const f = fixture('authored');
    writeFileSync(join(f.cwd, 'a.txt'), 'a\nb\nc\n');
    git(f.cwd, ['add', 'a.txt']);
    git(f.cwd, ['commit', '-qF', '-'], `feat: separate declaration\n\nLimit: ${LIMIT}\nRecord-Id: ${ID}\nProvenance: authored\n`);
    expect(f.report().idCollisions.map((v) => v.value)).toContain(ID);
  });

  it('keeps a real duplicate visible alongside a valid copy', () => {
    const f = fixture('authored');
    f.mergeBack();
    writeFileSync(join(f.cwd, 'a.txt'), 'a\nb\nc\n');
    git(f.cwd, ['add', 'a.txt']);
    git(f.cwd, ['commit', '-qF', '-'], `feat: collision\n\nLimit: another constraint\nRecord-Id: ${ID}\nProvenance: authored\n`);
    expect(f.report().idCollisions.map((v) => v.value)).toContain(ID);
  });

  it('does not let an untrusted note writer gain the source author’s trust', () => {
    const f = fixture('authored');
    git(f.cwd, ['-c', 'user.name=Untrusted Writer', '-c', 'user.email=untrusted@example.invalid',
      'notes', '--ref=commitlore', 'add', '-f', '-m', f.note.trim().split('\n').reverse().join('\n'), f.target]);
    f.mergeBack();
    const result = runQuery({ cwd: f.cwd, path: 'a.txt', trustedAuthors: ['CommitLore Test <test@example.invalid>'] });
    expect(result.records[0]?.identityCollision).not.toBe(true);
    expect(result.records[0]?.trust).toBe('claim');
  });
});
