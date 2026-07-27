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

const mergeBranch = (repo: string, branch: string, message: string): string => {
  execFileSync('git', ['merge', '--no-ff', '-q', branch, '-m', message], {
    cwd: repo,
    env: GIT_ENV,
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
    const merge = mergeBranch(
      repo,
      'feature',
      'Merge pull request #72 from owner/feature\n\ninject: diagnose silent hook failures on stderr (#67)',
    );

    const result = runValidate({ commit: merge, cwd: repo });

    expect(result.code).toBe(1);
    expect(result.violations).toEqual([
      expect.objectContaining({ sha: merge, line: 3, rule: 'format', key: 'trailer-block' }),
    ]);
    expect(result.stdout).toContain(
      `${merge.slice(0, 10)}:3: final paragraph does not look like a CommitLore trailer block; saw unknown key "inject"`,
    );
    expect(result.stderr).toBe('commitlore: 1 violation (SPEC §6) — the message was not modified\n');
  });

  it('does not echo a credential from a merge-title paragraph', () => {
    const repo = makeRepo();
    commit(repo, 'base.txt', 'Base\n');
    execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo, env: GIT_ENV });
    commit(repo, 'feature.txt', 'Feature\n');
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo, env: GIT_ENV });
    commit(repo, 'main.txt', 'Main\n');
    const secret = ['ghp_', 'woQsV1K0ETSd7oY7wtnp83A4UTVAyjyr6VaT'].join('');
    const merge = mergeBranch(
      repo,
      'feature',
      `Merge pull request #72 from owner/feature\n\ninject: ${secret}`,
    );

    const result = runValidate({ commit: merge, cwd: repo });
    const rendered = `${result.stdout}${result.stderr}`;

    expect(result.code).toBe(1);
    expect(result.secrets).toHaveLength(1);
    expect(rendered).toContain('saw unknown key "inject"');
    expect(rendered).not.toContain(secret);
  });

  it('keeps a genuine unknown-key failure when a merge paragraph also has a valid trailer', () => {
    const repo = makeRepo();
    commit(repo, 'base.txt', 'Base\n');
    execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo, env: GIT_ENV });
    commit(repo, 'feature.txt', 'Feature\n');
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo, env: GIT_ENV });
    commit(repo, 'main.txt', 'Main\n');
    const merge = mergeBranch(
      repo,
      'feature',
      'Merge pull request #72 from owner/feature\n\nConstraint: still invalid\nBlast: local',
    );

    const result = runValidate({ commit: merge, cwd: repo });

    expect(result.code).toBe(1);
    expect(result.violations).toEqual([
      expect.objectContaining({ sha: merge, line: 3, rule: 'unknown-key', key: 'Constraint' }),
    ]);
    expect(result.stdout).not.toContain('final paragraph does not look');
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

  it('attributes merge-title and genuine unknown-key failures across a range', () => {
    const repo = makeRepo();
    const base = commit(repo, 'base.txt', 'Base\n');
    execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo, env: GIT_ENV });
    commit(repo, 'feature.txt', 'Feature\n');
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: repo, env: GIT_ENV });
    commit(repo, 'main.txt', 'Main\n');
    const merge = mergeBranch(
      repo,
      'feature',
      'Merge pull request #72 from owner/feature\n\ninject: diagnose silent hook failures',
    );
    const invalid = commit(repo, 'invalid.txt', 'Invalid\n\nConstraint: still invalid\n');

    const result = runValidate({ range: `${base}..HEAD`, cwd: repo });

    expect(result.code).toBe(1);
    expect(result.violations.map(({ sha, rule, key }) => [sha, rule, key])).toEqual([
      [merge, 'format', 'trailer-block'],
      [invalid, 'unknown-key', 'Constraint'],
    ]);
  });

  it('attributes unparsed-trailer warnings to their commit in a range', () => {
    const repo = makeRepo();
    const base = commit(repo, 'base.txt', 'Base\n');
    const warned = commit(repo, 'warned.txt', 'Subject\nLimit: token introspection unavailable\n');

    const result = runValidate({ range: `${base}..HEAD`, cwd: repo });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe(
      `commitlore: ${warned.slice(0, 10)}:2 looks like a Limit trailer, but git did not parse it; the trailer block needs a blank line before it\n`,
    );
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
