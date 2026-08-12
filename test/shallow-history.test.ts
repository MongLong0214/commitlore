import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runDoctor } from '../src/commands/doctor.js';
import { hookResult } from '../src/commands/inject.js';
import { guard } from '../src/core/guard.js';
import { buildInjection } from '../src/core/inject.js';
import { notesAbsenceEvidenceKey } from '../src/core/notes.js';
import { runQuery } from '../src/core/query.js';
import { createTestRepo } from './git-fixtures.js';

const temporaries: string[] = [];

afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const commit = (cwd: string, contents: string, message: string): void => {
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src/policy.ts'), contents);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', message]);
};

const shallowClone = (): string => {
  const origin = mkdtempSync(join(tmpdir(), 'commitlore-shallow-origin-'));
  const parent = mkdtempSync(join(tmpdir(), 'commitlore-shallow-clone-'));
  const clone = join(parent, 'repo');
  temporaries.push(origin, parent);
  createTestRepo({ path: origin });
  commit(origin, 'one\n', 'start');
  commit(
    origin,
    'two\n',
    'Reject a queue\n\nRuled-out: RabbitMQ | another service is not allowed\nRecord-Id: r-shallow1',
  );
  createTestRepo({ path: clone, source: `file://${origin}`, depth: 1 });
  git(clone, ['config', '--add', 'remote.origin.fetch', '+refs/notes/commitlore:refs/notes/commitlore']);
  // A refspec says what this clone would fetch, never what the remote has, so
  // it alone leaves notes availability unknown and every answer incomplete
  // (#512). `doctor --fix` records the probe; the fixture records the same
  // evidence directly, because this suite is about the shallow caveat and an
  // unrelated incompleteness would mask it.
  git(clone, [
    'config',
    '--local',
    notesAbsenceEvidenceKey('origin'),
    git(clone, ['config', '--get', 'remote.origin.url']).trim(),
  ]);
  return clone;
};

describe('shallow history caveat', () => {
  it('carries the caveat through query, guard, inject, and doctor without changing exit semantics', () => {
    const cwd = shallowClone();
    const caveat = 'shallow history, so this answer may be missing records that exist upstream';

    expect(existsSync(resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'shallow']).trim()))).toBe(true);
    expect(runQuery({ cwd, noIndex: true }).diagnostics).toContain(
      `this clone has ${caveat} (fix: git fetch --unshallow)`,
    );

    expect(guard({ cwd, proposal: 'rename this variable', noIndex: true })).toMatchObject({
      shallow: true,
      incomplete: false,
    });

    const injection = buildInjection({
      cwd,
      path: 'src/policy.ts',
      at: new Date('2100-01-01T00:00:00Z'),
      noIndex: true,
    });
    expect(injection.diagnostics).toContain(`this clone has ${caveat} (fix: git fetch --unshallow)`);
    expect(
      hookResult(
        JSON.stringify({
          cwd,
          tool_name: 'Read',
          tool_input: { file_path: 'src/policy.ts' },
        }),
        { cwd, at: new Date('2100-01-01T00:00:00Z'), noIndex: true },
      ).stderr,
    ).toContain(caveat);

    expect(runDoctor({ cwd }).checks).toContainEqual(
      expect.objectContaining({
        id: 'history-depth',
        status: 'warn',
        fix: 'git fetch --unshallow',
      }),
    );
  });

  it('detects shallow history from a linked worktree', () => {
    const clone = shallowClone();
    const parent = mkdtempSync(join(tmpdir(), 'commitlore-shallow-worktree-'));
    const cwd = join(parent, 'linked');
    temporaries.push(parent);
    git(clone, ['worktree', 'add', '-q', '-b', 'linked', cwd]);

    expect(git(cwd, ['rev-parse', '--is-shallow-repository']).trim()).toBe('true');
    expect(runQuery({ cwd, noIndex: true }).shallow).toBe(true);
    expect(runDoctor({ cwd }).checks).toContainEqual(
      expect.objectContaining({
        id: 'history-depth',
        status: 'warn',
        fix: 'git fetch --unshallow',
      }),
    );
  });
});
