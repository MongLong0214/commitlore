/**
 * #415 acceptance: after a plain install, a record the installer authored
 * reaches the agent as `[directive]` — and a record someone else authored does
 * not.
 *
 * #415's finding was measured, not inferred: every installed surface passed no
 * `--trusted-author`, grading fell closed to `claim` for everything, and the
 * `[directive]` tier the injected legend advertises had never been delivered to
 * anyone. So the load-bearing case here drives the same path a user's agent
 * drives — `buildInjection` with the options `commitlore inject` builds — and
 * asserts on the rendered text, not on a grading function in isolation. A unit
 * test of `gradeRecord` would have passed throughout the entire period the bug
 * existed.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { buildInjection } from '../src/core/inject.js';
import {
  REQUIRE_SIGNED_DIRECTIVE_KEY,
  TRUSTED_AUTHOR_KEY,
  configuredSignedDirectivesRequired,
  configuredTrustedAuthors,
  seedTrustedAuthor,
} from '../src/core/trusted-authors.js';
import { createTestRepo } from './git-fixtures.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const INSTALLER = 'installer@example.invalid';
const OUTSIDER = 'outsider@example.invalid';

const RECORD = [
  'Ruled-out: shared Redis cache | ops refuses another stateful dependency',
  'Record-Id: r-trust01',
  'Provenance: authored',
].join('\n');

let repo: string;

beforeEach(() => {
  repo = createTestRepo({ path: mkdtempSync(join(realpathSync(tmpdir()), 'cl-trust-')) });
  scratch.push(repo);
  execGit(['config', 'user.email', INSTALLER], { cwd: repo });
  execGit(['config', 'user.name', 'installer'], { cwd: repo });
});

/**
 * Commits a record touching `session.ts`, authored by `email`.
 *
 * `--author` rather than GIT_AUTHOR_EMAIL: `execGit` takes no `env` option, so
 * an env override is silently ignored and every commit would land under the
 * repo's configured identity — which would have made the outsider case pass
 * for the wrong reason.
 */
const commitRecord = (email: string, body: string): void => {
  writeFileSync(join(repo, 'session.ts'), `export const ttl = ${String(body.length)};\n`);
  execGit(['add', '-A'], { cwd: repo });
  execGit(
    ['commit', '--no-verify', `--author=someone <${email}>`, '-m', `feat: cache sessions\n\n${body}`],
    { cwd: repo },
  );
};

const injected = (): string =>
  buildInjection({
    path: 'session.ts',
    cwd: repo,
    noIndex: true,
    trustedAuthors: configuredTrustedAuthors(repo),
    requireSignedDirective: configuredSignedDirectivesRequired(repo),
  }).text;

describe('#415 trusted authors after a plain install', () => {
  it('delivers a record the installer authored as [directive]', () => {
    commitRecord(INSTALLER, RECORD);
    expect(seedTrustedAuthor(repo).recorded).toBe(true);

    const text = injected();
    expect(text).toContain('r-trust01');
    // The whole point of #415: this line used to read `[claim]` on every
    // install that has ever existed.
    expect(text).toMatch(/\[directive\]\s+r-trust01/);
  });

  it('still grades another author\'s record as [claim] — the attack is unchanged', () => {
    commitRecord(OUTSIDER, RECORD);
    seedTrustedAuthor(repo);

    const text = injected();
    expect(text).toContain('r-trust01');
    // The legend always names every tier, so the assertion is on the record
    // line itself rather than on the payload containing the word.
    expect(text).toMatch(/\[claim\]\s+r-trust01/);
    expect(text).not.toMatch(/\[directive\]\s+r-trust01/);
  });

  it('trusts nobody until an author is recorded — the fail-closed default holds', () => {
    commitRecord(INSTALLER, RECORD);
    expect(configuredTrustedAuthors(repo)).toEqual([]);
    expect(injected()).toMatch(/\[claim\]\s+r-trust01/);
  });

  it('leaves a repository that already answered the question alone', () => {
    execGit(['config', '--local', '--add', TRUSTED_AUTHOR_KEY, 'reviewer@example.invalid'], {
      cwd: repo,
    });
    const result = seedTrustedAuthor(repo);

    expect(result.recorded).toBe(false);
    expect(configuredTrustedAuthors(repo)).toEqual(['reviewer@example.invalid']);
  });

  it('records nothing when the machine has no git identity, rather than guessing', () => {
    execGit(['config', '--unset', 'user.email'], { cwd: repo });
    const result = seedTrustedAuthor(repo);

    expect(result.recorded).toBe(false);
    expect(result.reason).toMatch(/no git user\.email/);
    expect(configuredTrustedAuthors(repo)).toEqual([]);
  });

  it('can be emptied back to trust-nobody without editing a hook command', () => {
    commitRecord(INSTALLER, RECORD);
    seedTrustedAuthor(repo);
    expect(injected()).toMatch(/\[directive\]\s+r-trust01/);

    execGit(['config', '--unset-all', TRUSTED_AUTHOR_KEY], { cwd: repo });
    expect(injected()).toMatch(/\[claim\]\s+r-trust01/);
  });

  it('leaves verified signatures opt-in and downgrades an unsigned forged author string', () => {
    commitRecord(INSTALLER, RECORD);
    seedTrustedAuthor(repo);

    // Default author-string mode preserves the established behaviour: the
    // commit's author selected the configured string, so it is a directive.
    expect(configuredSignedDirectivesRequired(repo)).toBe(false);
    expect(injected()).toMatch(/\[directive\]\s+r-trust01/);

    execGit(['config', '--local', REQUIRE_SIGNED_DIRECTIVE_KEY, 'true'], { cwd: repo });
    expect(configuredSignedDirectivesRequired(repo)).toBe(true);
    // This is a real commit whose author string matches the configured email;
    // it carries no signature, so opt-in signature mode must demote it.
    expect(injected()).toMatch(/\[claim\]\s+r-trust01/);
  });
});

/**
 * The layer the earlier tests in this file did not reach.
 *
 * Everything above drives `buildInjection` with options assembled by hand. That
 * passes whether or not the CLI ever produces those options — and it did not.
 * Commander declares `--trusted-author` with a default of `[]`, so the absent
 * flag arrived as an empty array rather than `undefined`, the nullish fallback
 * to the configured authors never fired, and **every record on every install
 * still graded `claim`**. The defect #415 was opened about, reintroduced one
 * layer up by the fix for it, and shipped in 0.7.0.
 *
 * The file header already said a unit test of `gradeRecord` would have passed
 * throughout the period the original bug existed. This is the same sentence one
 * layer out, and the reason these cases spawn the built CLI instead.
 */
describe('#415 through the command line, which is the only path the hook uses', () => {
  const cli = (args: string[], cwd: string): string => {
    const run = spawnSync(process.execPath, [join(REPO_ROOT, 'dist', 'commitlore.mjs'), ...args], {
      cwd,
      encoding: 'utf8',
    });
    return `${run.stdout}${run.stderr}`;
  };

  it('renders the installer\'s own record as [directive] with no flag at all', () => {
    commitRecord(INSTALLER, RECORD);
    seedTrustedAuthor(repo);

    // No `--trusted-author`. This is exactly what CLAUDE_HOOK_COMMAND runs.
    expect(cli(['inject', '--path', 'session.ts'], repo)).toMatch(/\[directive\]\s+r-trust01/);
  });

  it('still renders another author\'s record as [claim] through the same path', () => {
    commitRecord(OUTSIDER, RECORD);
    seedTrustedAuthor(repo);

    expect(cli(['inject', '--path', 'session.ts'], repo)).toMatch(/\[claim\]\s+r-trust01/);
  });

  it('grades claim when nothing is configured and no flag is given', () => {
    commitRecord(INSTALLER, RECORD);

    expect(cli(['inject', '--path', 'session.ts'], repo)).toMatch(/\[claim\]\s+r-trust01/);
  });

  it('lets an explicit flag override an empty configuration', () => {
    commitRecord(INSTALLER, RECORD);

    const out = cli(['inject', '--path', 'session.ts', '--trusted-author', INSTALLER], repo);
    expect(out).toMatch(/\[directive\]\s+r-trust01/);
  });

  it('answers the same on the query route as on the hook route', () => {
    // query.ts carried the sentence "the two routes must answer alike, or the
    // grade means one thing on the hook and another on the terminal" while the
    // two routes did in fact disagree: `inject` fell back to the configured
    // authors and `context` did not. A comment asserting a property is not the
    // property.
    commitRecord(INSTALLER, RECORD);
    seedTrustedAuthor(repo);

    expect(cli(['inject', '--path', 'session.ts'], repo)).toMatch(/\[directive\]\s+r-trust01/);
    expect(cli(['context', 'session.ts'], repo)).toMatch(/r-trust01\s+\S+\s+\[directive\]/);
  });

  it('keeps the two routes agreeing when nothing is configured', () => {
    commitRecord(INSTALLER, RECORD);

    expect(cli(['inject', '--path', 'session.ts'], repo)).toMatch(/\[claim\]\s+r-trust01/);
    expect(cli(['context', 'session.ts'], repo)).toMatch(/r-trust01\s+\S+\s+\[claim\]/);
  });

  it('keeps the two routes at claim for an unsigned configured author in signature mode', () => {
    commitRecord(INSTALLER, RECORD);
    seedTrustedAuthor(repo);
    execGit(['config', '--local', REQUIRE_SIGNED_DIRECTIVE_KEY, 'true'], { cwd: repo });

    expect(cli(['inject', '--path', 'session.ts'], repo)).toMatch(/\[claim\]\s+r-trust01/);
    expect(cli(['context', 'session.ts'], repo)).toMatch(/r-trust01\s+\S+\s+\[claim\]/);
  });
});
