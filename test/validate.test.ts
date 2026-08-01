/**
 * T-202: `commitlore validate` against the conformance fixtures (SPEC §9) and
 * against real commits.
 *
 * The exit-code contract (0 clean / 1 violations / 2 usage) is asserted here at
 * the function level and end-to-end through the built binary in
 * `hooks.test.ts`, because a hook and a CI job both branch on it.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { CHECK_CLASS_NEEDS, runValidate } from '../src/commands/validate.js';
import { writeRecord } from '../src/core/notes.js';
import { loadFixtures } from './fixtures.js';
import { createTestRepo } from './git-fixtures.js';

const RULES = ['unknown-key', 'enum', 'format', 'cardinality', 'dangling-ref', 'duplicate-id'];

/**
 * `GIT_CONFIG_GLOBAL`/`SYSTEM` are neutralized so the developer's own config
 * (`core.hooksPath`, `commit.gpgsign`, `init.templateDir`) cannot reach into a
 * test repository.
 */
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'CommitLore Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'CommitLore Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

const temporaryDirectories: string[] = [];

const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-validate-'));
  // A test that escapes the temp dir would be writing into a real repository.
  expect(dir.startsWith(tmpdir())).toBe(true);
  temporaryDirectories.push(dir);
  return createTestRepo({ path: dir, env: GIT_ENV });
};

const commit = (repo: string, file: string, message: string): string => {
  writeFileSync(join(repo, file), `${file}\n`);
  execFileSync('git', ['add', '-A'], { cwd: repo, env: GIT_ENV });
  execFileSync('git', ['commit', '-q', '--no-verify', '-F', '-'], {
    cwd: repo,
    env: GIT_ENV,
    input: message,
  });
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    env: GIT_ENV,
    encoding: 'utf8',
  }).trim();
};

afterAll(() => {
  for (const dir of temporaryDirectories) rmSync(dir, { recursive: true, force: true });
});

describe('validate — invalid fixtures', () => {
  for (const fixture of loadFixtures('invalid')) {
    const expected = fixture.expected.violations ?? [];
    const rules = expected.map((violation) => violation.rule);

    if (rules.includes('dangling-ref')) {
      it(`${fixture.id} passes shape-only validation`, () => {
        const result = runValidate({ messageFile: fixture.txtPath, cwd: tmpdir() });
        expect(result.violations).toEqual([]);
        expect(result.code).toBe(0);
      });
      continue;
    }

    it(`${fixture.id} is rejected with the expected rule and exit 1`, () => {
      const result = runValidate({ messageFile: fixture.txtPath, cwd: tmpdir() });
      expect(result.code).toBe(1);
      expect(result.violations.map((violation) => violation.rule)).toEqual(rules);
      // `want` is advisory prose owned by src/core/schema.ts, not part of the
      // conformance contract (SPEC §9 pins the violation class). The fields
      // the repair loop keys on are compared exactly.
      expect(result.violations.map(({ key, value, rule, got }) => ({ key, value, rule, got }))).toEqual(
        expected.map(({ key, value, rule, got }) => ({ key, value, rule, got })),
      );
      for (const violation of result.violations) expect(violation.want.length).toBeGreaterThan(0);
      expect(result.stdout).not.toBe('');
    });
  }
});

describe('validate — valid and boundary fixtures', () => {
  for (const fixture of [...loadFixtures('valid'), ...loadFixtures('boundary')]) {
    it(`${fixture.id} passes shape validation and reports references not checked`, () => {
      const result = runValidate({ messageFile: fixture.txtPath, cwd: tmpdir() });
      expect(result.violations).toEqual([]);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('shape ok · references not checked (no repository)\n');
      expect(result.stderr).toBe('');
    });
  }
});

describe('validate — prose/trailer boundary', () => {
  it('warns when known trailer-looking lines are outside Git’s trailer block', () => {
    const result = runValidate({
      readStdin: () =>
        'fix the auth bug\nLimit: token introspection unavailable\nRuled-out: extend TTL | security policy\nRecord-Id: r-typical00001\n',
    });

    expect(result.code).toBe(0);
    expect(result.violations).toEqual([]);
    expect(result.stderr).toBe(
      'commitlore: line 2 looks like a Limit trailer, but git did not parse it; the trailer block needs a blank line before it\n' +
        'commitlore: line 3 looks like a Ruled-out trailer, but git did not parse it; the trailer block needs a blank line before it\n' +
        'commitlore: line 4 looks like a Record-Id trailer, but git did not parse it; the trailer block needs a blank line before it\n',
    );
  });

  it('warns when tab indentation keeps a known trailer out of Git’s trailer block', () => {
    const result = runValidate({
      readStdin: () => 'fix the auth bug\n\n\tLimit: token introspection unavailable\n',
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe(
      'commitlore: line 3 looks like a Limit trailer, but git did not parse it; remove the leading tab\n',
    );
  });

  it('names a merge-title paragraph instead of reporting its word as an unknown key', () => {
    const repo = makeRepo();
    commit(repo, 'base.txt', 'Base\n');
    execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo, env: GIT_ENV });
    commit(repo, 'feature.txt', 'Feature\n');
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo, env: GIT_ENV });
    commit(repo, 'main.txt', 'Main\n');
    execFileSync(
      'git',
      [
        'merge',
        '--no-ff',
        '-q',
        'feature',
        '-m',
        'Merge pull request #72 from owner/feature\n\ninject: diagnose silent hook failures on stderr (#67)',
      ],
      { cwd: repo, env: GIT_ENV },
    );
    const merge = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      env: GIT_ENV,
      encoding: 'utf8',
    }).trim();

    const result = runValidate({ commit: merge, cwd: repo });

    expect(result.code).toBe(0);
    expect(result.violations).toEqual([]);
    expect(result.stderr).toBe(
      `commitlore: ${merge.slice(0, 10)}:3: final paragraph does not look like a CommitLore trailer block; saw "inject: diagnose silent hook failures on stderr (#67)"\n`,
    );
  });

  it('gives the same merge-title message the same shape verdict via --message-file as via --commit (bug-issue-90)', () => {
    const repo = makeRepo();
    commit(repo, 'base.txt', 'Base\n');
    execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo, env: GIT_ENV });
    commit(repo, 'feature.txt', 'Feature\n');
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo, env: GIT_ENV });
    commit(repo, 'main.txt', 'Main\n');
    execFileSync(
      'git',
      [
        'merge',
        '--no-ff',
        '-q',
        'feature',
        '-m',
        'Merge pull request #72 from owner/feature\n\ninject: diagnose silent hook failures on stderr (#67)',
      ],
      { cwd: repo, env: GIT_ENV },
    );
    const merge = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      env: GIT_ENV,
      encoding: 'utf8',
    }).trim();

    // The exact reproduction from the issue: extract the already-made merge
    // commit's message to a file (as a commit-msg hook, or a human, would
    // hand it to `--message-file`) rather than pointing validate at the repo.
    const extracted = execFileSync('git', ['log', '-1', '--format=%B', merge], {
      cwd: repo,
      env: GIT_ENV,
      encoding: 'utf8',
    });
    const messageFile = join(repo, 'extracted-message.txt');
    writeFileSync(messageFile, extracted);

    const viaCommit = runValidate({ commit: merge, cwd: repo });
    const viaMessageFile = runValidate({ messageFile, cwd: tmpdir() });

    expect(viaMessageFile.checks[0]).toEqual(viaCommit.checks[0]);
    expect(viaMessageFile.checks[0]).toEqual({ class: 'shape', status: 'ok' });
    expect(viaMessageFile.violations).toEqual([]);
    expect(viaMessageFile.stderr).toBe(
      'commitlore: commit:3: final paragraph does not look like a CommitLore trailer block; saw "inject: diagnose silent hook failures on stderr (#67)"\n',
    );
  });
});

describe('validate — input modes', () => {
  it('validates a message file', () => {
    const fixture = loadFixtures('invalid').find((entry) => entry.name === '01-enum-blast');
    const result = runValidate({ messageFile: fixture?.txtPath ?? '', cwd: tmpdir() });
    expect(result.code).toBe(1);
    expect(result.violations[0]?.rule).toBe('enum');
    expect(result.violations[0]?.sha).toBeUndefined();
  });

  it('validates a message read from stdin', () => {
    const result = runValidate({ readStdin: () => 'Subject\n\nUndo: clean\n' });
    expect(result.code).toBe(1);
    expect(result.violations[0]).toMatchObject({ key: 'Undo', rule: 'enum', line: 3 });
  });

  it('validates one commit by sha and reports it', () => {
    const repo = makeRepo();
    commit(repo, 'a.txt', 'Clean commit\n\nBlast: local\n');
    const bad = commit(repo, 'b.txt', 'Bad commit\n\nBlast: wide\n');

    const result = runValidate({ commit: bad, cwd: repo });
    expect(result.code).toBe(1);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.sha).toBe(bad);
    expect(result.violations[0]?.rule).toBe('enum');
  });

  it('accepts an abbreviated revision and reports the full sha', () => {
    const repo = makeRepo();
    const sha = commit(repo, 'a.txt', 'Bad commit\n\nCertainty: high\n');

    const result = runValidate({ commit: 'HEAD', cwd: repo });
    expect(result.code).toBe(1);
    expect(result.violations[0]?.sha).toBe(sha);
  });

  it('walks a range and attributes each violation to its commit', () => {
    const repo = makeRepo();
    const base = commit(repo, 'a.txt', 'Base\n\nBlast: local\n');
    const bad = commit(repo, 'b.txt', 'Bad\n\nUndo: clean\n');
    commit(repo, 'c.txt', 'Clean\n\nCertainty: guess\n');
    const worse = commit(repo, 'd.txt', 'Worse\n\nConstraint: nope\n');

    const result = runValidate({ range: `${base}..HEAD`, cwd: repo });
    expect(result.code).toBe(1);
    expect(result.violations.map((violation) => [violation.sha, violation.rule])).toEqual([
      [bad, 'enum'],
      [worse, 'unknown-key'],
    ]);
  });

  it('exits 0 on a range whose commits are all clean', () => {
    const repo = makeRepo();
    const base = commit(repo, 'a.txt', 'Base\n');
    commit(repo, 'b.txt', 'Second\n\nBlast: module\nCertainty: firm\n');

    const result = runValidate({ range: `${base}..HEAD`, cwd: repo });
    expect(result.code).toBe(0);
    expect(result.violations).toEqual([]);
  });

  it('exits 0 on a commit that recorded nothing (SPEC §2.1 B7)', () => {
    const repo = makeRepo();
    commit(repo, 'a.txt', 'Just a subject\n');
    const result = runValidate({ commit: 'HEAD', cwd: repo });
    expect(result.code).toBe(0);
  });
});

describe('validate — check classes and reference integrity', () => {
  it('declares the information required by all three check classes', () => {
    expect(CHECK_CLASS_NEEDS).toEqual({
      shape: 'message',
      reference: 'repository',
      conservation: 'before and after',
    });
  });

  it('reports shape as checked and references as not checked on stdin', () => {
    const result = runValidate({ readStdin: () => 'Subject\n\nBlast: local\n' });

    expect(result.checks).toEqual([
      { class: 'shape', status: 'ok' },
      { class: 'reference', status: 'not-checked', reason: 'no repository' },
    ]);
    expect(result.stdout).toBe('shape ok · references not checked (no repository)\n');
    expect(result.code).toBe(0);
  });

  it('reports both classes checked for a repository commit', () => {
    const repo = makeRepo();
    commit(repo, 'a.txt', 'Base\n\nRecord-Id: r-base01\n');
    const sha = commit(
      repo,
      'b.txt',
      'Follow up\n\nFollows: r-base01\nRecord-Id: r-next01\n',
    );

    const result = runValidate({ commit: sha, cwd: repo });

    expect(result.checks).toEqual([
      { class: 'shape', status: 'ok' },
      { class: 'reference', status: 'ok' },
    ]);
    expect(result.stdout).toBe('shape ok · references ok\n');
    expect(result.code).toBe(0);
  });

  it.each([
    ['annals 03b4bfe', 'r-8c31f7'],
    ['gitseed 4d99a48', 'r-gsa007'],
  ])('rejects the missing Follows from the real %s incident', (_incident, missing) => {
    const repo = makeRepo();
    const sha = commit(
      repo,
      'incident.txt',
      `Incident\n\nFollows: ${missing}\nRecord-Id: r-child01\n`,
    );

    const result = runValidate({ commit: sha, cwd: repo });

    expect(result.code).toBe(1);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ sha, key: 'Follows', got: missing, rule: 'dangling-ref' }),
    );
    expect(result.checks[1]).toEqual({ class: 'reference', status: 'failed' });
  });

  it('does not let a later declaration rescue a backwards-only reference', () => {
    const repo = makeRepo();
    const referring = commit(
      repo,
      'first.txt',
      'Refers forward\n\nFollows: r-later1\nRecord-Id: r-first01\n',
    );
    commit(repo, 'later.txt', 'Declared later\n\nRecord-Id: r-later1\n');

    const result = runValidate({ commit: referring, cwd: repo });

    expect(result.violations).toContainEqual(
      expect.objectContaining({ key: 'Follows', got: 'r-later1', rule: 'dangling-ref' }),
    );
  });

  it('checks the commit-msg message file against the repository at HEAD', () => {
    const repo = makeRepo();
    commit(repo, 'base.txt', 'Base\n\nRecord-Id: r-base02\n');
    const messageFile = join(repo, '.git', 'COMMIT_EDITMSG');
    writeFileSync(messageFile, 'Candidate\n\nFollows: r-base02\nRecord-Id: r-next02\n');

    const result = runValidate({ messageFile, cwd: repo });

    expect(result.code).toBe(0);
    expect(result.checks[1]).toEqual({ class: 'reference', status: 'ok' });
  });

  it('rejects a divergent note that claims a commit message Record-Id', () => {
    const repo = makeRepo();
    const sha = commit(
      repo,
      'approved.txt',
      'Approved\n\nLimit: approved content\nRecord-Id: r-collide\n',
    );
    writeRecord(
      sha,
      [
        { key: 'Limit', value: 'attacker content' },
        { key: 'Record-Id', value: 'r-collide' },
      ],
      { cwd: repo },
    );

    const result = runValidate({ commit: sha, cwd: repo });

    expect(result.code).toBe(1);
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        sha,
        key: 'Record-Id',
        got: 'r-collide',
        rule: 'duplicate-id',
      }),
    );
  });

  it('rejects two blocks in one message that share a Record-Id (bug-issue-92)', () => {
    const repo = makeRepo();
    const sha = commit(
      repo,
      'squash.txt',
      [
        'squash: bring in the branch',
        '',
        'Limit: the vendor caps us at 3 concurrent workers',
        'Record-Id: r-dupdup',
        '',
        'Warn: do not raise the retry ceiling',
        'Record-Id: r-dupdup',
      ].join('\n'),
    );

    const result = runValidate({ commit: sha, cwd: repo });

    expect(result.code).toBe(1);
    expect(result.checks[1]).toEqual({ class: 'reference', status: 'failed' });
    // Reported once per block, so the repair loop sees which line of *each*
    // block is implicated, the same way `commitlore parse` already does.
    expect(
      result.violations.filter((violation) => violation.rule === 'duplicate-id'),
    ).toHaveLength(2);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ sha, key: 'Record-Id', got: 'r-dupdup', rule: 'duplicate-id' }),
    );
  });

  // bug-issue-145: `--message-file`/stdin sources never resolve an `sha`, so
  // the `sharesACommit` branch exercised above (bug-issue-92) can never fire
  // for them — this is the gap the commit-msg hook actually runs into, since
  // it always calls `validate --message-file` on a message that is not a
  // commit yet.
  it('rejects two blocks in a message file that share a Record-Id, naming it (bug-issue-145)', () => {
    const result = runValidate({
      readStdin: () =>
        'Two blocks same id\n\nLimit: first\nRecord-Id: r-dupxx1\n\nLimit: second\nRecord-Id: r-dupxx1\n',
    });

    expect(result.code).toBe(1);
    expect(result.checks[0]).toEqual({ class: 'shape', status: 'failed' });
    expect(
      result.violations.filter((violation) => violation.rule === 'duplicate-id'),
    ).toHaveLength(2);
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        key: 'Record-Id',
        value: 'r-dupxx1',
        got: 'r-dupxx1',
        rule: 'duplicate-id',
      }),
    );
    expect(result.stdout).toContain('r-dupxx1');
  });

  it('accepts two blocks in one message that declare different Record-Ids', () => {
    const result = runValidate({
      readStdin: () =>
        'Two blocks different ids\n\nLimit: first\nRecord-Id: r-diffid1\n\nLimit: second\nRecord-Id: r-diffid2\n',
    });

    expect(result.code).toBe(0);
    expect(result.violations).toEqual([]);
  });

  it('accepts a single record block, unaffected by the collision check', () => {
    const result = runValidate({
      readStdin: () => 'One block\n\nLimit: fine\nRecord-Id: r-single01\n',
    });

    expect(result.code).toBe(0);
    expect(result.violations).toEqual([]);
  });

  // bug-issue-352(a): a shallow clone cannot see the ancestor that declares the
  // referenced id, and reporting `dangling-ref` there blocks a commit whose
  // record is not invalid — the history is truncated. `action/lint/lint.mjs`
  // refuses to report green over a shallow checkout for the mirror-image
  // reason; the local hook must equally refuse to report red.
  it('does not report a reference to an ancestor below the shallow boundary as dangling (bug-issue-352)', () => {
    const parent = mkdtempSync(join(tmpdir(), 'commitlore-validate-shallow-'));
    expect(parent.startsWith(tmpdir())).toBe(true);
    temporaryDirectories.push(parent);

    const origin = join(parent, 'origin');
    createTestRepo({ path: origin, env: GIT_ENV });
    commit(origin, 'old.txt', 'Old decision\n\nLimit: one runner\nRecord-Id: r-old352\n');
    commit(origin, 'tip.txt', 'Tip\n\nLimit: two runners\nRecord-Id: r-tip352\n');

    const message = 'Retire it\n\nSupersedes: r-old352\nRecord-Id: r-new352\n';

    // The notes refspec is configured, so the `unfetched` gate does not fire
    // and the reference check genuinely runs — otherwise this fixture would
    // pass for the wrong reason.
    const shallow = join(parent, 'shallow');
    createTestRepo({ path: shallow, source: `file://${origin}`, depth: 1, env: GIT_ENV });
    execFileSync(
      'git',
      ['config', '--add', 'remote.origin.fetch', '+refs/notes/commitlore:refs/notes/commitlore'],
      { cwd: shallow, env: GIT_ENV },
    );
    const shallowMessage = join(shallow, 'message.txt');
    writeFileSync(shallowMessage, message);

    // Control: the same message against the same origin, cloned whole, is a
    // valid record. Only the truncation makes it look dangling.
    const full = join(parent, 'full');
    createTestRepo({ path: full, source: `file://${origin}`, env: GIT_ENV });
    execFileSync(
      'git',
      ['config', '--add', 'remote.origin.fetch', '+refs/notes/commitlore:refs/notes/commitlore'],
      { cwd: full, env: GIT_ENV },
    );
    const fullMessage = join(full, 'message.txt');
    writeFileSync(fullMessage, message);

    const fullResult = runValidate({ messageFile: fullMessage, cwd: full });
    expect(fullResult.code).toBe(0);
    expect(fullResult.checks[1]).toEqual({ class: 'reference', status: 'ok' });

    const result = runValidate({ messageFile: shallowMessage, cwd: shallow });

    expect(result.violations.filter((violation) => violation.rule === 'dangling-ref')).toEqual([]);
    expect(result.code).toBe(0);
    // Skipped, and said so — never a silent pass.
    expect(result.checks[1]).toEqual({
      class: 'reference',
      status: 'not-checked',
      reason:
        'shallow history — a Record-Id declared below the clone boundary is not visible here (fix: git fetch --unshallow)',
    });
    expect(result.stdout).toContain('shallow history');
  });

  // bug-issue-352(b): `Follows:`/`Supersedes:` resolve against `Record-Id`s
  // "regardless of which block declared them" (SPEC §2.4), and a multi-block
  // message is what this project's own squash inheritance and GitHub's squash
  // button both produce.
  it('resolves a Follows: to an earlier block of the same message (bug-issue-352)', () => {
    const repo = makeRepo();
    commit(repo, 'base.txt', 'Base\n\nRecord-Id: r-base352\n');
    const messageFile = join(repo, '.git', 'COMMIT_EDITMSG');
    writeFileSync(
      messageFile,
      [
        'squash: bring in the branch',
        '',
        'Limit: the vendor caps us at 3 concurrent workers',
        'Record-Id: r-blocka352',
        '',
        'Warn: do not raise the retry ceiling',
        'Follows: r-blocka352',
        'Record-Id: r-blockb352',
        '',
      ].join('\n'),
    );

    const result = runValidate({ messageFile, cwd: repo });

    expect(result.violations).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.checks[1]).toEqual({ class: 'reference', status: 'ok' });
  });

  // bug-issue-352(b), the indexed half: the index's identity is
  // `(commit_sha, source, block, seq)`, and flattening it to `(sha, source)`
  // hides every block after the first from the declared set.
  it('resolves a Follows: to a Record-Id declared in a later block of a commit in history (bug-issue-352)', () => {
    const repo = makeRepo();
    commit(
      repo,
      'squash.txt',
      [
        'squash: bring in the branch',
        '',
        'Limit: the vendor caps us at 3 concurrent workers',
        'Record-Id: r-hista352',
        '',
        'Warn: do not raise the retry ceiling',
        'Record-Id: r-histb352',
        '',
      ].join('\n'),
    );
    const messageFile = join(repo, '.git', 'COMMIT_EDITMSG');
    writeFileSync(messageFile, 'Follow up\n\nFollows: r-histb352\nRecord-Id: r-next352\n');

    const result = runValidate({ messageFile, cwd: repo });

    expect(result.violations).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.checks[1]).toEqual({ class: 'reference', status: 'ok' });
  });

  // bug-issue-187: --range must honour a Supersedes: declaration that comes
  // later in the range than the colliding commits, the same way stale does.
  it('accepts a cross-commit duplicate when a later commit in the range declares Supersedes (bug-issue-187)', () => {
    const repo = makeRepo();
    commit(repo, 'a.txt', 'First claim\n\nLimit: original\nRecord-Id: r-dup187a\n');
    const tag = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      env: GIT_ENV,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['tag', 'base187', tag], { cwd: repo, env: GIT_ENV });
    commit(repo, 'b.txt', 'Second claim same id\n\nLimit: revised\nRecord-Id: r-dup187a\n');
    commit(
      repo,
      'c.txt',
      'Retire the duplicate\n\nSupersedes: r-dup187a\nRecord-Id: r-succ187\n',
    );

    const result = runValidate({ range: 'base187..HEAD', cwd: repo });

    expect(result.code).toBe(0);
    expect(result.violations.filter((v) => v.rule === 'duplicate-id')).toHaveLength(0);
  });

  it('still rejects a cross-commit duplicate when no Supersedes is declared (bug-issue-187)', () => {
    const repo = makeRepo();
    commit(repo, 'a.txt', 'First claim\n\nLimit: original\nRecord-Id: r-dup187b\n');
    const tag = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      env: GIT_ENV,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['tag', 'base187b', tag], { cwd: repo, env: GIT_ENV });
    commit(repo, 'b.txt', 'Second claim same id\n\nLimit: revised\nRecord-Id: r-dup187b\n');

    const result = runValidate({ range: 'base187b..HEAD', cwd: repo });

    expect(result.code).toBe(1);
    expect(result.violations.filter((v) => v.rule === 'duplicate-id').length).toBeGreaterThan(0);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ key: 'Record-Id', value: 'r-dup187b', rule: 'duplicate-id' }),
    );
  });

  it('still rejects a same-message duplicate as unresolvable even with Supersedes in range (bug-issue-187)', () => {
    const repo = makeRepo();
    // Need a base commit so the range has a proper starting point.
    commit(repo, 'base.txt', 'Base commit\n\nRecord-Id: r-base187c\n');
    const baseTag = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      env: GIT_ENV,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['tag', 'base187c', baseTag], { cwd: repo, env: GIT_ENV });
    const sha = commit(
      repo,
      'ambiguous.txt',
      [
        'Two blocks same id in one message',
        '',
        'Limit: first meaning',
        'Record-Id: r-ambig187',
        '',
        'Limit: second meaning',
        'Record-Id: r-ambig187',
      ].join('\n'),
    );
    // Even a later Supersedes cannot disambiguate a same-message collision.
    commit(
      repo,
      'd.txt',
      'Try to resolve same-message\n\nSupersedes: r-ambig187\nRecord-Id: r-resolve187\n',
    );

    const result = runValidate({ range: 'base187c..HEAD', cwd: repo });

    expect(result.code).toBe(1);
    const collisions = result.violations.filter(
      (v) => v.rule === 'duplicate-id' && v.value === 'r-ambig187',
    );
    expect(collisions.length).toBeGreaterThan(0);
    // The sha is attached since --range resolves commits.
    expect(collisions[0]?.sha).toBe(sha);
  });

  it('still rejects a divergent-notes collision as unresolvable even with Supersedes in range (bug-issue-187)', () => {
    // A Record-Id mirrored to refs/notes/commitlore with a divergent payload
    // is the shape that actually reaches the suppression path in checkReferences
    // (the same-message shape does not, due to an incidental property of
    // collectRecords). This must remain reported even when a later Supersedes:
    // targeting the id exists in the range.
    const repo = makeRepo();
    commit(repo, 'base-note.txt', 'Base for notes test\n\nRecord-Id: r-notebase191\n');
    const baseTag = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      env: GIT_ENV,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['tag', 'base191n', baseTag], { cwd: repo, env: GIT_ENV });
    const sha = commit(
      repo,
      'noted.txt',
      'Commit with divergent note\n\nLimit: alpha\nRecord-Id: r-notediv191\n',
    );
    // Mirror the same Record-Id to the notes ref with a different payload.
    writeRecord(
      sha,
      [
        { key: 'Limit', value: 'beta' },
        { key: 'Record-Id', value: 'r-notediv191' },
      ],
      { cwd: repo },
    );
    // A later commit declares Supersedes: for the colliding id.
    commit(
      repo,
      'succ-note.txt',
      'Attempt to resolve divergent note\n\nSupersedes: r-notediv191\nRecord-Id: r-nsucc191\n',
    );

    const result = runValidate({ range: 'base191n..HEAD', cwd: repo });

    expect(result.code).toBe(1);
    const collisions = result.violations.filter(
      (v) => v.rule === 'duplicate-id' && v.value === 'r-notediv191',
    );
    expect(collisions.length).toBeGreaterThan(0);
    expect(collisions[0]?.sha).toBe(sha);
  });

  it('rejects only the two colliding blocks out of three, naming the shared id', () => {
    const result = runValidate({
      readStdin: () =>
        [
          'Three blocks, two collide',
          '',
          'Limit: alpha',
          'Record-Id: r-dupxx1',
          '',
          'Limit: beta',
          'Record-Id: r-uniqueb',
          '',
          'Limit: gamma',
          'Record-Id: r-dupxx1',
        ].join('\n'),
    });

    expect(result.code).toBe(1);
    const duplicateIdViolations = result.violations.filter(
      (violation) => violation.rule === 'duplicate-id',
    );
    expect(duplicateIdViolations).toHaveLength(2);
    expect(duplicateIdViolations.every((violation) => violation.value === 'r-dupxx1')).toBe(true);
    expect(result.violations.some((violation) => violation.value === 'r-uniqueb')).toBe(false);
  });

  // bug-issue-365: the shape check and `checkReferences` both find the same
  // same-message `Record-Id` collision, and the two lists are concatenated, so
  // a two-problem message reads as a four-problem one. The count in the
  // summary line is what a person uses to judge how much work they are in for,
  // and `--json` is what the repair loop reads — a doubled list hands it two
  // identical instructions for one edit.
  it('reports a same-message duplicate once per colliding block, not once per check that found it (bug-issue-365)', () => {
    const repo = makeRepo();
    commit(repo, 'base.txt', 'Base\n\nRecord-Id: r-base365\n');
    const messageFile = join(repo, '.git', 'COMMIT_EDITMSG');
    writeFileSync(
      messageFile,
      [
        'dup',
        '',
        'Limit: X',
        'Record-Id: r-dup365z',
        'Certainty: firm',
        '',
        'Limit: Y',
        'Record-Id: r-dup365z',
        'Certainty: firm',
        '',
      ].join('\n'),
    );

    const result = runValidate({ messageFile, cwd: repo });

    // Control: both detectors must be live here, or the fixture would pass for
    // the wrong reason — the reference half is invisible until the `unfetched`
    // gate is past.
    expect(result.checks[0]).toEqual({ class: 'shape', status: 'failed' });
    expect(result.checks[1]?.status).toBe('failed');

    expect(result.code).toBe(1);
    // Two blocks collide: two problems, one per block, each carrying the line
    // of that block's `Record-Id`.
    expect(result.violations.map((violation) => violation.line)).toEqual([4, 8]);
    expect(result.violations).toHaveLength(2);
    expect(result.stderr).toContain('2 violations (SPEC §6)');

    const jsonResult = runValidate({ messageFile, cwd: repo, json: true });
    const payload = JSON.parse(jsonResult.stdout) as { violations: unknown[] };
    expect(payload.violations).toHaveLength(2);
    expect(new Set(payload.violations.map((violation) => JSON.stringify(violation))).size).toBe(2);
  });
});

describe('validate — usage errors exit 2', () => {
  it('rejects two input modes at once', () => {
    const result = runValidate({ messageFile: 'x.txt', commit: 'HEAD' });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('mutually exclusive');
    expect(result.stderr).toContain('--message-file');
    expect(result.stderr).toContain('--commit');
    expect(result.stdout).toBe('');
  });

  it('rejects all three input modes at once', () => {
    const result = runValidate({ messageFile: 'x.txt', commit: 'HEAD', range: 'a..b' });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--range');
  });

  it('rejects a --range that is not a range', () => {
    const result = runValidate({ range: 'HEAD' });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('<a>..<b>');
  });

  it('reports an unreadable message file as usage, not as a violation', () => {
    const result = runValidate({ messageFile: join(tmpdir(), 'commitlore-does-not-exist.txt') });
    expect(result.code).toBe(2);
    expect(result.violations).toEqual([]);
    expect(result.stderr).toContain('commitlore:');
  });

  it('reports an unknown revision as usage', () => {
    const repo = makeRepo();
    commit(repo, 'a.txt', 'Base\n');
    const result = runValidate({ commit: 'no-such-ref', cwd: repo });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('cannot resolve commit');
  });
});

describe('validate — --json', () => {
  it('emits parseable JSON whose rules are all in the SPEC §6 classes', () => {
    const fixtures = loadFixtures('invalid');
    for (const fixture of fixtures) {
      const result = runValidate({ messageFile: fixture.txtPath, cwd: tmpdir(), json: true });
      const parsed = JSON.parse(result.stdout) as { violations: { rule: string }[] };
      expect(Array.isArray(parsed.violations)).toBe(true);
      for (const violation of parsed.violations) expect(RULES).toContain(violation.rule);
      expect(result.stderr).toBe('');
    }
  });

  it('carries the full repair-loop shape', () => {
    const fixture = loadFixtures('invalid').find((entry) => entry.name === '01-enum-blast');
    const result = runValidate({
      messageFile: fixture?.txtPath ?? '',
      cwd: tmpdir(),
      json: true,
    });
    expect(JSON.parse(result.stdout)).toEqual({
      checks: [
        { class: 'shape', status: 'failed' },
        { class: 'reference', status: 'not-checked', reason: 'no repository' },
      ],
      violations: [
        {
          line: 3,
          key: 'Blast',
          value: 'wide',
          rule: 'enum',
          got: 'wide',
          want: 'local|module|system',
        },
      ],
      secrets: [],
    });
  });

  it('emits an empty violation list for a clean record', () => {
    const result = runValidate({ readStdin: () => 'Subject\n\nBlast: local\n', json: true });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      checks: [
        { class: 'shape', status: 'ok' },
        { class: 'reference', status: 'not-checked', reason: 'no repository' },
      ],
      violations: [],
      secrets: [],
    });
  });
});

describe('validate — line numbers', () => {
  it('points at the offending line of each invalid fixture', () => {
    const lines = new Map([
      ['01-enum-blast', 3],
      ['02-format-ruled-out-no-pipe', 3],
      ['03-unknown-key', 3],
      ['04-cardinality-blast-twice', 4],
    ]);
    for (const fixture of loadFixtures('invalid')) {
      const expected = lines.get(fixture.name);
      if (expected === undefined) continue;
      const result = runValidate({ messageFile: fixture.txtPath, cwd: tmpdir() });
      expect([fixture.name, result.violations[0]?.line]).toEqual([fixture.name, expected]);
    }
  });

  it('points into the last paragraph, not an earlier prose one (SPEC §2.1 B2)', () => {
    const result = runValidate({
      readStdin: () => 'Subject\n\nBlast: wide\nSource: prose\n\nLimit: fine\nBlast: wide\n',
    });
    expect(result.code).toBe(1);
    expect(result.violations.map((violation) => violation.line)).toEqual([7]);
  });

  it('counts folded continuation lines (SPEC §2.1 B4)', () => {
    const result = runValidate({
      readStdin: () => 'Subject\n\nWarn: one\n  two\n  three\nBlast: wide\n',
    });
    expect(result.violations[0]?.line).toBe(6);
  });

  it('skips the comment lines a commit message file carries', () => {
    const result = runValidate({
      readStdin: () =>
        'Subject\n\nBody\n\n# Please enter the commit message\nBlast: wide\n# a comment\nLimit: one runner\n',
    });
    expect(result.violations[0]?.line).toBe(6);
  });

  it('omits the line rather than guessing between identical trailers', () => {
    const result = runValidate({ readStdin: () => 'Subject\n\nBlast: wide\nBlast: wide\n' });
    expect(result.violations.map((violation) => [violation.rule, violation.line])).toEqual([
      ['enum', undefined],
      ['enum', undefined],
      // The cardinality rule names the occurrence, so that one is locatable.
      ['cardinality', 4],
    ]);
  });
});

/**
 * Issue #372. `Ruled-out:` has one delimiter and no escape, so a value with a
 * second `|` splits somewhere the author may not have meant. The record then
 * cannot match the thing it rules out, and until now `validate` said
 * `shape ok` about it.
 *
 * The two halves are reported differently on purpose, and the boundary was
 * drawn by counting this repository's own records. 620 distinct `Ruled-out:`
 * values, three with more than one pipe, two of those three correct — a `||`
 * in a reason, an `.mjs|.js` alternation. Rejecting every multi-pipe value
 * would invalidate two correct records to catch one broken one, so that half
 * warns. An alternative whose code span the separator cut open is not a
 * judgement call — the span opened before the pipe and closed after it, so the
 * pipe was inside quoted text — and that half is refused.
 */
describe('validate — Ruled-out: separator ambiguity (issue #372)', () => {
  const message = (value: string): string =>
    `feat: pipes\n\nBody.\n\nRecord-Id: r-ggg777\nRuled-out: ${value}\nCertainty: firm\n` +
    'CommitLore-Version: 1.0.0\n';

  it('refuses an alternative whose code span the separator cut open', () => {
    const result = runValidate({
      readStdin: () =>
        message('shelling out to `grep | head` for counts | it silently returns head exit status'),
      cwd: tmpdir(),
    });
    expect(result.code).toBe(1);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ key: 'Ruled-out', rule: 'format' }),
    );
    // The repair loop reads `want`, so it has to name the actual defect. A
    // record that already carries a separator is told nothing at all by
    // "alternative | reason".
    expect(result.violations[0]?.want).toContain('code span');
    expect(result.stdout).toContain('code span');
  });

  it('warns, without refusing, when the value merely carries a second pipe', () => {
    const result = runValidate({
      readStdin: () =>
        message(
          'Passing the version through $args so irm | iex could take one | iex gives a piped ' +
            'script no arguments',
        ),
      cwd: tmpdir(),
    });
    expect(result.code).toBe(0);
    expect(result.violations).toEqual([]);
    expect(result.stderr).toContain('more than one "|"');
    // The warning has to say where the split landed, or the author cannot tell
    // whether it is the one they meant.
    expect(result.stderr).toContain('Passing the version through $args so irm');
  });

  it('leaves a reason that quotes a pipe warned but valid', () => {
    const result = runValidate({
      readStdin: () =>
        message(
          'set +e at the top of each step | it also disables the abort for genuinely ' +
            'unexpected failures; the || form is scoped to the one command',
        ),
      cwd: tmpdir(),
    });
    expect(result.code).toBe(0);
    expect(result.violations).toEqual([]);
    expect(result.stderr).toContain('more than one "|"');
  });

  it('says nothing about a value with exactly one pipe', () => {
    const result = runValidate({
      readStdin: () => message('shared Redis cache | ops refuses another stateful dependency'),
      cwd: tmpdir(),
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
  });
});
