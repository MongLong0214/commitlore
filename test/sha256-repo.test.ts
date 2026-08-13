/**
 * SHA-256 repositories: the remaining 40-only object-id assumptions after #603.
 *
 * Provenance `inherited <sha>` already accepts 64 hex. Capture, pending,
 * grading, shadow, and the commit hooks still treated a git object id as
 * exactly 40 lowercase hex. A real `git init --object-format=sha256`
 * repository then failed to resolve HEAD, dropped authors, and downgraded
 * trusted-author records from directive to claim.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { prepareCaptureContext } from '../src/core/capture-prepare.js';
import { runCaptureShadow } from '../src/core/capture-shadow.js';
import { stageCaptureRecord } from '../src/core/capture-stage.js';
import { verifyCaptureRecords } from '../src/core/capture-verify.js';
import { authorsOf } from '../src/core/grade.js';
import { execGit, resolveRevision } from '../src/core/git.js';
import { buildInjection } from '../src/core/inject.js';
import { resolveHead } from '../src/core/pending.js';
import {
  configuredSignedDirectivesRequired,
  configuredTrustedAuthors,
  seedTrustedAuthor,
} from '../src/core/trusted-authors.js';
import { GIT_OBJECT_ID_PATTERN, isFullObjectId } from '../src/core/types.js';
import { preserveSquashRecords } from '../src/hooks/prepare-commit-msg.js';
import { readSourceFiles } from './fixtures.js';
import { createTestRepo } from './git-fixtures.js';

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(PACKAGE_ROOT, '..', 'dist', 'commitlore.mjs');

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: '/nonexistent/commitlore-sha256-test',
  GIT_CONFIG_SYSTEM: '/nonexistent/commitlore-sha256-test',
  GIT_AUTHOR_NAME: 'SHA256 Test',
  GIT_AUTHOR_EMAIL: 'sha256@test.invalid',
  GIT_COMMITTER_NAME: 'SHA256 Test',
  GIT_COMMITTER_EMAIL: 'sha256@test.invalid',
};

const gitEnv = (cwd: string): NodeJS.ProcessEnv => ({
  ...process.env,
  ...GIT_ENV,
  COMMITLORE_BIN: CLI_BIN,
  HOME: cwd,
});

const temp = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[], stdin?: string): string => {
  const result = execGit(args, { cwd, ...(stdin === undefined ? {} : { stdin }) });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout;
};

const runGit = (
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } => {
  const result = spawnSync('git', args, {
    cwd,
    env: gitEnv(cwd),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
};

const runCli = (
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } => {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    env: gitEnv(cwd),
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
};

const sha256Repo = (label: string): string => {
  const dir = createTestRepo({ path: temp(label), objectFormat: 'sha256' });
  writeFileSync(join(dir, 'README.md'), 'seed\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '--no-verify', '-m', 'seed']);
  const head = git(dir, ['rev-parse', 'HEAD']).trim();
  expect(head).toMatch(/^[0-9a-f]{64}$/);
  expect(git(dir, ['rev-parse', '--show-object-format']).trim()).toBe('sha256');
  return dir;
};

const sha1Repo = (label: string): string => {
  const dir = createTestRepo({ path: temp(label) });
  writeFileSync(join(dir, 'README.md'), 'seed\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '--no-verify', '-m', 'seed']);
  return dir;
};

const stageChange = (cwd: string, path: string, body: string): void => {
  writeFileSync(join(cwd, path), body);
  git(cwd, ['add', '--', path]);
};

const TRANSCRIPT = 'The team decided to use SQLite instead of PostgreSQL for local storage.';

const draftFor = (recordId: string) => [
  {
    trailers: [
      { key: 'Ruled-out', value: 'PostgreSQL | SQLite chosen for local storage simplicity' },
      { key: 'Record-Id', value: recordId },
    ],
    evidence: [
      {
        key: 'Ruled-out' as const,
        source: 'transcript' as const,
        quote: 'The team decided to use SQLite instead of PostgreSQL for local storage.',
        locator: 'L1-L1',
      },
    ],
  },
];

const prepareVerifyStage = (cwd: string, recordId: string): string => {
  const prepared = prepareCaptureContext({ cwd, transcript: TRANSCRIPT });
  const diff = git(cwd, ['diff', '--cached']);
  const verified = verifyCaptureRecords({
    nonce: prepared.nonce,
    draft: draftFor(recordId),
    transcript: TRANSCRIPT,
    diff,
    cwd,
  });
  expect(verified.validation_result, JSON.stringify(verified.rejected)).toBe('pass');
  expect(stageCaptureRecord({ nonce: prepared.nonce, cwd })).toBe(prepared.nonce);
  return prepared.nonce;
};

const pendingDir = (cwd: string): string =>
  resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'commitlore/pending']).trim());

const readPending = (cwd: string, nonce: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(pendingDir(cwd), `${nonce}.json`), 'utf8')) as Record<
    string,
    unknown
  >;

const installHooks = (cwd: string): void => {
  const hooksDir = resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'hooks']).trim());
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(
    join(hooksDir, 'prepare-commit-msg'),
    ['#!/bin/sh', `exec "${process.execPath}" "${CLI_BIN}" prepare-commit-msg "$@"`, ''].join('\n'),
    { mode: 0o755 },
  );
  writeFileSync(
    join(hooksDir, 'post-commit'),
    ['#!/bin/sh', `exec "${process.execPath}" "${CLI_BIN}" post-commit`, ''].join('\n'),
    { mode: 0o755 },
  );
};

const SHA1 = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('full object id is exactly 40 or exactly 64 hex (R0-03)', () => {
  it('accepts a full SHA-1 and a full SHA-256, in either case', () => {
    expect(isFullObjectId(SHA1)).toBe(true);
    expect(isFullObjectId(SHA256)).toBe(true);
    expect(isFullObjectId(SHA1.toUpperCase())).toBe(true);
  });

  /**
   * The lengths that matter. 41 through 63 are the reason this predicate is
   * separate from the trailer grammar: under a shared `{4,64}` they validated
   * as canonical, so a truncated id was persisted and compared as though it
   * named an object.
   */
  it.each([4, 7, 39, 41, 63, 65])('rejects a %d-character id at the persisted boundary', (n) => {
    expect(isFullObjectId('a'.repeat(n))).toBe(false);
  });

  it('rejects non-hex and empty input', () => {
    expect(isFullObjectId('')).toBe(false);
    expect(isFullObjectId('z'.repeat(40))).toBe(false);
    expect(isFullObjectId(` ${SHA1}`)).toBe(false);
    expect(isFullObjectId(`${SHA1}\n`)).toBe(false);
  });

  it('keeps the trailer grammar separate and still abbreviation-tolerant', () => {
    // SPEC §3 writes `Provenance: inherited <sha>` with no length constraint,
    // and record.schema.json carries a synchronised copy. Tightening the
    // trailer grammar is a spec change; this issue is about internal state.
    expect(GIT_OBJECT_ID_PATTERN).toBe('[0-9a-fA-F]{4,64}');
    expect(new RegExp(`^${GIT_OBJECT_ID_PATTERN}$`).test('dead')).toBe(true);
    expect(isFullObjectId('dead')).toBe(false);
  });

  it('leaves no loose object-id predicate for new code to reach for', () => {
    const types = readFileSync(resolve(PACKAGE_ROOT, '..', 'src', 'core', 'types.ts'), 'utf8');
    expect(types).not.toContain('isGitObjectId');
  });
});

describe('resolveRevision turns user input into one full id, or refuses (R0-03)', () => {
  it('resolves an abbreviation to the full id it names', () => {
    const cwd = sha1Repo('resolve');
    stageChange(cwd, 'first.txt', 'first\n');
    git(cwd, ['commit', '--quiet', '--no-verify', '-m', 'first']);
    const full = git(cwd, ['rev-parse', 'HEAD']).trim();
    const abbrev = full.slice(0, 7);

    expect(isFullObjectId(abbrev)).toBe(false);
    expect(resolveRevision(cwd, abbrev)).toBe(full);
    expect(isFullObjectId(resolveRevision(cwd, abbrev) ?? '')).toBe(true);
  });

  it('resolves a branch, a tag and a relative revision to full ids', () => {
    const cwd = sha1Repo('resolve');
    stageChange(cwd, 'first.txt', 'first\n');
    git(cwd, ['commit', '--quiet', '--no-verify', '-m', 'first']);
    const first = git(cwd, ['rev-parse', 'HEAD']).trim();
    stageChange(cwd, 'second.txt', 'second\n');
    git(cwd, ['commit', '--quiet', '--no-verify', '-m', 'second']);
    const second = git(cwd, ['rev-parse', 'HEAD']).trim();
    git(cwd, ['tag', '-a', 'v1', '-m', 'release']);

    expect(resolveRevision(cwd, 'HEAD')).toBe(second);
    expect(resolveRevision(cwd, 'HEAD~1')).toBe(first);
    // An annotated tag must peel to the commit, not to the tag object.
    expect(resolveRevision(cwd, 'v1')).toBe(second);
  });

  it('refuses an unknown revision instead of inventing one', () => {
    const cwd = sha1Repo('resolve');
    stageChange(cwd, 'first.txt', 'first\n');
    git(cwd, ['commit', '--quiet', '--no-verify', '-m', 'first']);
    expect(resolveRevision(cwd, 'no-such-branch')).toBeNull();
    expect(resolveRevision(cwd, 'f'.repeat(40))).toBeNull();
    expect(resolveRevision(cwd, '')).toBeNull();
  });

  it('refuses an ambiguous prefix rather than picking one', () => {
    const cwd = sha1Repo('resolve');
    // Commit until two commits share a 3-hex prefix, then ask git with it.
    // 4096 buckets against ~120 commits makes a collision likely but not
    // certain, so the search is bounded and the assertion is skipped rather
    // than faked when this run does not produce one.
    const seen = new Map<string, string>();
    let ambiguous: string | null = null;
    for (let i = 0; i < 120 && ambiguous === null; i += 1) {
      stageChange(cwd, `c${i}.txt`, `body ${i}\n`);
      git(cwd, ['commit', '--quiet', '--no-verify', '-m', `c${i}`]);
      const sha = git(cwd, ['rev-parse', 'HEAD']).trim();
      const prefix = sha.slice(0, 3);
      if (seen.has(prefix)) ambiguous = prefix;
      else seen.set(prefix, sha);
    }
    if (ambiguous === null) return;

    // Guard the guard: git itself must consider this prefix ambiguous, or the
    // refusal below would prove nothing.
    const direct = execGit(['rev-parse', '--verify', '--quiet', `${ambiguous}^{commit}`], { cwd });
    expect(direct.code).not.toBe(0);
    expect(resolveRevision(cwd, ambiguous)).toBeNull();
  });

  it('resolves against a real SHA-256 repository too', () => {
    const cwd = sha256Repo('resolve');
    stageChange(cwd, 'first.txt', 'first\n');
    git(cwd, ['commit', '--quiet', '--no-verify', '-m', 'first']);
    const full = git(cwd, ['rev-parse', 'HEAD']).trim();
    expect(full).toMatch(/^[0-9a-f]{64}$/);
    expect(resolveRevision(cwd, full.slice(0, 10))).toBe(full);
    expect(isFullObjectId(full)).toBe(true);
  });
});

describe('SHA-256 capture prepare and stage', () => {
  it('prepares and stages a record against a real 64-character HEAD', () => {
    const cwd = sha256Repo('capture');
    stageChange(cwd, 'queue.ts', 'export const workers = 3;\n');
    const head = git(cwd, ['rev-parse', 'HEAD']).trim();

    let prepared: ReturnType<typeof prepareCaptureContext>;
    try {
      prepared = prepareCaptureContext({ cwd, transcript: TRANSCRIPT });
    } catch (error: unknown) {
      throw new Error(
        `prepare must accept a SHA-256 HEAD, not refuse it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    expect(prepared.base_head).toBe(head);
    expect(prepared.base_head).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.staged_tree_oid).toMatch(/^[0-9a-f]{64}$/);
    expect(resolveHead(cwd)).toBe(head);

    const nonce = prepareVerifyStage(cwd, 'r-sha256cap');
    const pending = readPending(cwd, nonce);
    expect(pending['phase']).toBe('staged');
    expect(pending['base_head']).toBe(head);
  });

  it('still prepares against a SHA-1 40-character HEAD', () => {
    const cwd = sha1Repo('capture-sha1');
    stageChange(cwd, 'queue.ts', 'export const workers = 3;\n');
    const head = git(cwd, ['rev-parse', 'HEAD']).trim();
    const prepared = prepareCaptureContext({ cwd, transcript: TRANSCRIPT });
    expect(prepared.base_head).toBe(head);
    expect(prepared.base_head).toMatch(/^[0-9a-f]{40}$/);
    expect(resolveHead(cwd)).toBe(head);
  });
});

describe('SHA-256 shadow capture', () => {
  it('examines historical commits instead of skipping every 64-character object id', () => {
    const cwd = sha256Repo('shadow');
    const since = git(cwd, ['rev-parse', 'HEAD']).trim();
    writeFileSync(
      join(cwd, 'decision.md'),
      'Limit: the deployment target has no managed queue service\n',
    );
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '--quiet', '--no-verify', '-m', 'document queue limit']);

    const result = runCaptureShadow({ cwd, since });
    expect(result.summary.commits_examined).toBeGreaterThan(0);
    expect(result.commits[0]?.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(result.commits.some((commit) => commit.would_record)).toBe(true);
  });
});

describe('SHA-256 trusted-author grading', () => {
  it('authorsOf returns the author of a real SHA-256 commit', () => {
    const cwd = sha256Repo('authors');
    const head = git(cwd, ['rev-parse', 'HEAD']).trim();
    const authors = authorsOf(cwd, [head]);
    expect(authors.get(head)).toMatch(/<.+@.+>/);
  });

  it('grades a configured trusted author as directive, not claim', () => {
    const cwd = sha256Repo('grade');
    const author = 'trusted@example.invalid';
    git(cwd, ['config', 'user.email', author]);
    git(cwd, ['config', 'user.name', 'trusted']);
    writeFileSync(join(cwd, 'session.ts'), 'export const ttl = 30;\n');
    git(cwd, ['add', '-A']);
    git(
      cwd,
      [
        'commit',
        '--quiet',
        '--no-verify',
        `--author=trusted <${author}>`,
        '-m',
        [
          'feat: cache sessions',
          '',
          'Ruled-out: shared Redis cache | ops refuses another stateful dependency',
          'Record-Id: r-sha256dir',
          'Provenance: authored',
        ].join('\n'),
      ],
    );
    expect(seedTrustedAuthor(cwd).recorded).toBe(true);
    expect(configuredTrustedAuthors(cwd)).toEqual([author]);

    const head = git(cwd, ['rev-parse', 'HEAD']).trim();
    expect(authorsOf(cwd, [head]).get(head)).toContain(author);

    const text = buildInjection({
      path: 'session.ts',
      cwd,
      at: new Date('2100-01-01T00:00:00Z'),
      noIndex: true,
      trustedAuthors: configuredTrustedAuthors(cwd),
      requireSignedDirective: configuredSignedDirectivesRequired(cwd),
    }).text;
    expect(text).toMatch(/\[directive\]\s+r-sha256dir/);
    expect(text).not.toMatch(/\[claim\]\s+r-sha256dir/);
  });
});

describe('SHA-256 amend and pathspec commits (#592 must hold for SHA-256)', () => {
  it(
    'consumes a capture attached by git commit --amend --no-edit',
    () => {
      const cwd = sha256Repo('amend');
      installHooks(cwd);
      stageChange(cwd, 'amended.ts', 'export const amended = true;\n');
      const nonce = prepareVerifyStage(cwd, 'r-sha256amd');

      const commit = runGit(cwd, ['commit', '--amend', '--no-edit']);
      expect(commit.status, commit.stderr).toBe(0);
      expect(runGit(cwd, ['log', '-1', '--format=%B']).stdout).toContain('Record-Id: r-sha256amd');

      const pending = readPending(cwd, nonce);
      expect(pending['phase']).toBe('consumed');
      expect(pending['consumed']).toBe(true);
      expect(String(pending['consumed_by'])).toMatch(/^[0-9a-f]{64}$/);
    },
    60_000,
  );

  it(
    'reports a pathspec commit whose temporary index no longer matches the verified diff',
    () => {
      const cwd = sha256Repo('pathspec');
      installHooks(cwd);
      writeFileSync(join(cwd, 'one.ts'), 'export const one = 1;\n');
      writeFileSync(join(cwd, 'two.ts'), 'export const two = 2;\n');
      git(cwd, ['add', 'one.ts', 'two.ts']);
      const nonce = prepareVerifyStage(cwd, 'r-sha256pth');

      const commit = runGit(cwd, ['commit', '-m', 'feat: add one', '--', 'one.ts']);
      expect(commit.status, commit.stderr).toBe(0);
      expect(commit.stderr).toContain('commitlore: staged capture r-sha256pth was not attached');
      expect(commit.stderr).toContain('temporary index');
      expect(runGit(cwd, ['log', '-1', '--format=%B']).stdout).not.toContain(
        'Record-Id: r-sha256pth',
      );

      const pending = readPending(cwd, nonce);
      expect(pending['phase']).toBe('staged');
      expect(pending['consumed']).toBe(false);
    },
    60_000,
  );
});

describe('SHA-256 squash commit-id extraction in prepare-commit-msg', () => {
  it('preserves records from a SQUASH_MSG that names 64-character commits', () => {
    const cwd = sha256Repo('squash');
    git(cwd, ['checkout', '--quiet', '-b', 'feature']);
    writeFileSync(join(cwd, 'queue.ts'), 'export const workers = 3;\n');
    git(cwd, ['add', '--', 'queue.ts']);
    git(
      cwd,
      [
        'commit',
        '--quiet',
        '--no-verify',
        '-m',
        'add the worker pool\n\nLimit: the vendor caps us at 3 concurrent workers\nRecord-Id: r-sha256sq\n',
      ],
    );
    const source = git(cwd, ['rev-parse', 'HEAD']).trim();
    expect(source).toMatch(/^[0-9a-f]{64}$/);

    git(cwd, ['checkout', '--quiet', 'main']);
    git(cwd, ['merge', '--squash', 'feature']);
    const squashPath = resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'SQUASH_MSG']).trim());
    const squashBody = readFileSync(squashPath, 'utf8');
    expect(squashBody).toMatch(new RegExp(`^commit ${source}$`, 'm'));

    const draft = join(cwd, 'SQUASH_DRAFT');
    writeFileSync(draft, 'Add the worker pool\n');
    expect(preserveSquashRecords(draft, cwd)).toBe(true);
    expect(readFileSync(draft, 'utf8')).toContain('Record-Id: r-sha256sq');
  });
});

describe('no leftover 40-only git object-id assumptions under src/', () => {
  /**
   * `core/types.ts` is where the two object-id contracts are defined, so it is
   * the one file allowed to spell the lengths out. Every other reader has to
   * import a predicate rather than re-deriving one — a local copy is how the
   * SHA-256 blindness got spread across six modules in the first place.
   */
  it('every reader imports a predicate instead of writing a local length copy', () => {
    const offenders: string[] = [];
    for (const [path, body] of readSourceFiles()) {
      if (path.endsWith('hooks/secret-rules.ts')) continue;
      if (path.endsWith('core/types.ts')) continue;
      if (/\[0-9a-f(?:A-F)?\]\{(?:40|4,40|4,64)\}/.test(body)) offenders.push(path);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('defines both contracts exactly once, in core/types.ts', () => {
    const definitions = readSourceFiles().filter(([, body]) =>
      /export const (FULL_OBJECT_ID_PATTERN|GIT_OBJECT_ID_PATTERN)/.test(body),
    );
    expect(definitions.map(([path]) => path)).toEqual(['core/types.ts']);
  });
});
