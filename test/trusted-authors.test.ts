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

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { buildInjection } from '../src/core/inject.js';
import {
  TRUSTED_AUTHOR_KEY,
  configuredTrustedAuthors,
  seedTrustedAuthor,
} from '../src/core/trusted-authors.js';
import { createTestRepo } from './git-fixtures.js';

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
});
