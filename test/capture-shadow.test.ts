/** Historical capture shadow mode — it measures without touching the repository. */

import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { formatCaptureShadow } from '../src/commands/capture.js';
import { runCaptureShadow } from '../src/core/capture-shadow.js';

const temporaries: string[] = [];
const CLI = join(__dirname, '..', 'dist', 'commitlore.mjs');

afterEach(() => {
  while (temporaries.length > 0) rmSync(temporaries.pop()!, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const commit = (cwd: string, subject: string): void => {
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '--no-verify', '--quiet', '-m', subject]);
};

/**
 * A content snapshot includes `.git`; metadata is deliberately excluded.
 *
 * Entries that vanish between the `readdir` and the `lstat` are skipped rather
 * than fatal. Git writes and removes its own lock files under `.git/objects`
 * while this walks them, and a snapshot that dies because git tidied up is
 * reporting on the walker rather than on the thing under test -- CI hit
 * exactly that on `maintenance.lock`. Anything that survives long enough to be
 * stat'd is still compared byte for byte, so this cannot hide a change the
 * shadow run made: a file it wrote would still be there.
 */
const byteSnapshot = (root: string): string[] => {
  const walk = (path: string, relative: string): string[] => {
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    if (stat.isSymbolicLink()) return [`link ${relative} ${readlinkSync(path)}`];
    if (stat.isFile()) {
      return [
        `file ${relative} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`,
      ];
    }
    if (!stat.isDirectory()) return [`other ${relative}`];
    let entries: string[];
    try {
      entries = readdirSync(path).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return entries.flatMap((entry) =>
      walk(join(path, entry), relative === '' ? entry : `${relative}/${entry}`),
    );
  };
  return walk(root, '');
};

const makeRepository = (): { cwd: string; since: string; secret: string } => {
  const cwd = mkdtempSync(join(tmpdir(), 'capture-shadow-'));
  temporaries.push(cwd);
  git(cwd, ['init', '--quiet']);
  git(cwd, ['config', 'user.email', 'shadow@example.test']);
  git(cwd, ['config', 'user.name', 'Shadow Test']);
  writeFileSync(join(cwd, 'README.md'), '# fixture\n');
  commit(cwd, 'initial fixture');
  const since = git(cwd, ['rev-parse', 'HEAD']).trim();

  writeFileSync(join(cwd, 'decision.md'), 'Limit: the deployment target has no managed queue service\n');
  commit(cwd, 'document queue limit');

  writeFileSync(join(cwd, 'routine.md'), 'ordinary implementation detail\n');
  commit(cwd, 'add routine note');

  const secret = 'ghp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8';
  writeFileSync(join(cwd, 'credential.md'), `We decided to use token ${secret} for this test.\n`);
  commit(cwd, `add ${secret}`);

  return { cwd, since, secret };
};

describe('capture --shadow', () => {
  it('exposes the read-only measurement through the CLI without leaking a blocked record', () => {
    const { cwd, since, secret } = makeRepository();
    const before = byteSnapshot(cwd);
    const stdout = execFileSync('node', [CLI, 'capture', '--shadow', '--since', since], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    expect(byteSnapshot(cwd)).toEqual(before);
    expect(stdout).toContain('commitlore capture --shadow');
    expect(stdout).toContain('silence rate: 1/3 (33.3%)');
    expect(stdout).toContain('secret-guard: BLOCKED');
    expect(stdout).not.toContain(secret);
  });

  it('runs prepare and verify against history without changing the worktree or .git', () => {
    const { cwd, since, secret } = makeRepository();
    const before = byteSnapshot(cwd);

    const result = runCaptureShadow({ cwd, since });
    const after = byteSnapshot(cwd);

    expect(after).toEqual(before);
    expect(result.commits).toHaveLength(3);
    expect(result.commits[0]).toMatchObject({ would_record: true, secret_guard: 'clear' });
    expect(result.commits[0]?.record).toContain('Limit: the deployment target has no managed queue service');
    expect(result.commits[0]?.record).toContain('Provenance: drafted');
    expect(result.commits[1]).toMatchObject({
      would_record: false,
      secret_guard: 'not-run',
    });
    expect(result.commits[1]?.silence_reason).toContain('records": []');
    expect(result.commits[2]).toMatchObject({ would_record: true, secret_guard: 'blocked' });
    expect(result.commits[2]?.record).toBeUndefined();
    expect(result.commits[2]?.subject).not.toContain(secret);
    expect(result.commits[2]?.secret_findings?.[0]?.ruleId).toBe('github-token');

    const rendered = formatCaptureShadow(result);
    expect(rendered).toContain('silence rate: 1/3 (33.3%)');
    expect(rendered).toContain('secret-guard: BLOCKED');
    expect(rendered).not.toContain(secret);
    expect(rendered).toContain('This is an approximation, not a replay');
    expect(rendered).toContain('does not call createPending');
  });

  it('computes silence over commits examined, not over records that survived', () => {
    const { cwd, since } = makeRepository();

    const result = runCaptureShadow({ cwd, since });

    expect(result.summary).toMatchObject({
      commits_examined: 3,
      would_record: 2,
      blocked: 1,
      silence: 1,
      silence_rate: 1 / 3,
    });
  });
});
