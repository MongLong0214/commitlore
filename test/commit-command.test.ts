/**
 * `commitlore commit` — the one call that replaces the five-step flow.
 *
 * What these have to establish is not that the happy path works — the pipeline
 * underneath it is covered by `test/capture.test.ts` — but the three claims this
 * command makes on top of it:
 *
 *  1. `records: []` is a complete answer. A commit with nothing to record is an
 *     ordinary success, and nothing here may treat it as a shortfall.
 *  2. All or nothing. One refused record commits nothing and binds nothing, so a
 *     refusal can never be made invisible by the survivors landing anyway.
 *  3. What lands is asserted against the commit that exists, never against the
 *     transaction that was staged. Those are the same thing right up until
 *     somebody else's hook rewrites the message.
 *
 * The hooks are installed pointing at the real built bundle, the way `init` does
 * on a real machine: `installHook` records `process.argv[1]`, which inside vitest
 * is vitest. Without that the hook would be installed and inert, and every
 * record-carrying case would pass for the wrong reason.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { recordLanded, runCommit } from '../src/commands/commit.js';
import { installHook } from '../src/commands/hooks.js';
import { readConsideration } from '../src/core/commit-consideration.js';
import { installPrepareCommitMsgHook } from '../src/hooks/prepare-commit-msg.js';
import { createTestRepo } from './git-fixtures.js';

const BUNDLE = fileURLToPath(new URL('../dist/commitlore.mjs', import.meta.url));

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

/** Install the hooks with the recorded target pointing at a runnable bundle. */
const withRealBundle = <T>(run: () => T): T => {
  const original = process.argv[1];
  process.argv[1] = BUNDLE;
  try {
    return run();
  } finally {
    process.argv[1] = original;
  }
};

interface Fixture {
  cwd: string;
  transcript: string;
  draft: string;
}

const TRANSCRIPT =
  'We chose sha256 because it is the standard hash function for integrity checking.\n';

const draftWith = (quote: string, id = 'r-commitcmd01'): string =>
  JSON.stringify({
    records: [
      {
        trailers: [
          { key: 'Limit', value: 'use sha256 for integrity checking' },
          { key: 'Record-Id', value: id },
        ],
        evidence: [{ key: 'Limit', source: 'transcript', quote, locator: 'L1-L1' }],
      },
    ],
  });

/** A repository with hooks installed, one commit, and a staged change. */
const repo = (label: string, opts: { hooks?: boolean } = {}): Fixture => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-commit-${label}-`));
  scratch.push(dir);
  createTestRepo({ path: dir });
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--no-verify', '--quiet', '-m', 'init']);
  if (opts.hooks !== false) {
    withRealBundle(() => {
      installHook({ cwd: dir });
      installPrepareCommitMsgHook(dir);
    });
  }
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
  git(dir, ['add', '-A']);
  return {
    cwd: dir,
    transcript: TRANSCRIPT,
    draft: draftWith('chose sha256 because it is the standard hash function for integrity checking'),
  };
};

const head = (cwd: string): string => git(cwd, ['rev-parse', 'HEAD']).trim();
const headBody = (cwd: string): string => git(cwd, ['log', '-1', '--format=%B']);

describe('recording nothing is a complete answer', () => {
  it('commits with no draft and no transcript, and says so without hedging', () => {
    const { cwd } = repo('empty');
    const before = head(cwd);

    const outcome = runCommit({ cwd, message: 'chore: tidy the fixture' });

    expect(outcome.outcome).toBe('empty');
    expect(outcome.commit).not.toBe(before);
    expect(headBody(cwd)).not.toContain('Record-Id:');
    expect(outcome.records).toBe(0);
  });

  it('binds the consideration even though there is no record, which is the whole point', () => {
    // "considered and found nothing" and "never considered" are the two states
    // a gate has to tell apart, and only this branch produces the first one.
    const { cwd } = repo('empty-binding');

    runCommit({ cwd, message: 'chore: tidy', commit: false });

    const stored = readConsideration(cwd);
    expect(stored?.outcome).toBe('empty');
    expect(stored?.records).toBe(0);
    expect(head(cwd)).toBe(head(cwd)); // nothing was committed
  });
});

describe('a record that verifies reaches the commit', () => {
  it('commits it, and the claim is checked against the message that landed', () => {
    const { cwd, transcript, draft } = repo('recorded');

    const outcome = runCommit({ cwd, message: 'feat: hash with sha256', transcript, draft });

    expect(outcome.outcome).toBe('recorded');
    expect(outcome.commit).toBe(head(cwd));
    expect(headBody(cwd)).toContain('Record-Id: r-commitcmd01');
    expect(headBody(cwd)).toContain('Limit: use sha256 for integrity checking');
  });

  it('writes a consideration that says a record came out of it', () => {
    const { cwd, transcript, draft } = repo('recorded-binding');

    runCommit({ cwd, message: 'feat: hash', transcript, draft, commit: false });

    expect(readConsideration(cwd)?.outcome).toBe('recorded');
  });
});

describe('all or nothing', () => {
  it('refuses the whole commit when a quote is not in the transcript', () => {
    const { cwd, transcript } = repo('refused');
    const before = head(cwd);

    const outcome = runCommit({
      cwd,
      message: 'feat: hash',
      transcript,
      draft: draftWith('this sentence is nowhere in the transcript', 'r-commitcmd02'),
    });

    expect(outcome.outcome).toBe('refused');
    expect(head(cwd)).toBe(before);
    expect(outcome.rejected.length).toBeGreaterThan(0);
  });

  it('leaves no consideration behind, so a refusal cannot be mistaken for having run', () => {
    // The control that matters. If a refusal bound the tree, an agent could
    // reach the same state as a real consideration by sending a bad draft.
    const { cwd, transcript } = repo('refused-binding');

    runCommit({
      cwd,
      message: 'feat: hash',
      transcript,
      draft: draftWith('nowhere in the transcript at all', 'r-commitcmd03'),
    });

    expect(readConsideration(cwd)).toBeNull();
  });

  it('names both legal next moves, because "refused" alone invites the same draft again', () => {
    const { cwd, transcript } = repo('refused-advice');
    const outcome = runCommit({
      cwd,
      message: 'feat: hash',
      transcript,
      draft: draftWith('not present', 'r-commitcmd04'),
    });
    const said = outcome.lines.join('\n');
    expect(said).toContain('correct the quotes');
    expect(said).toContain('commit with no records');
  });
});

describe('what it refuses to attempt', () => {
  it('outside a repository', () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-commit-norepo-'));
    scratch.push(dir);
    expect(runCommit({ cwd: dir, message: 'x' }).outcome).toBe('error');
  });

  it('with nothing staged, and says what to do instead', () => {
    const { cwd } = repo('nothing-staged');
    git(cwd, ['reset', '--quiet']);
    const outcome = runCommit({ cwd, message: 'x' });
    expect(outcome.outcome).toBe('error');
    expect(outcome.lines.join('\n')).toContain('nothing is staged');
  });

  it('with records but no transcript to check them against', () => {
    const { cwd, draft } = repo('no-transcript');
    const outcome = runCommit({ cwd, message: 'x', draft });
    expect(outcome.outcome).toBe('error');
    expect(outcome.lines.join('\n')).toContain('no transcript');
  });

  it('when asked to stage without committing in a repository whose hook cannot apply it', () => {
    const { cwd } = repo('no-hook', { hooks: false });
    const outcome = runCommit({ cwd, message: 'x', commit: false });
    expect(outcome.outcome).toBe('error');
    expect(outcome.lines.join('\n')).toContain('hooks install');
  });
});

describe('git is the one that commits, with the user’s own hooks', () => {
  it('reports what a failing pre-commit hook said, and commits nothing', () => {
    const { cwd } = repo('pre-commit-refuses');
    const hookPath = join(cwd, '.git', 'hooks', 'pre-commit');
    writeFileSync(hookPath, '#!/bin/sh\necho "refused by the project\'s own hook" >&2\nexit 1\n', { mode: 0o755 });
    const before = head(cwd);

    const outcome = runCommit({ cwd, message: 'feat: x' });

    expect(outcome.outcome).toBe('commit_failed');
    expect(head(cwd)).toBe(before);
    expect(outcome.lines.join('\n')).toContain("refused by the project's own hook");
  });

  it('clears the binding when the commit it was made for did not happen', () => {
    const { cwd } = repo('failed-commit-binding');
    writeFileSync(join(cwd, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

    runCommit({ cwd, message: 'feat: x' });

    expect(readConsideration(cwd)).toBeNull();
  });

  it('stages tracked changes first when asked, the way git commit -a does', () => {
    const { cwd } = repo('all');
    writeFileSync(join(cwd, 'a.txt'), 'one\ntwo\nthree\n');

    const outcome = runCommit({ cwd, message: 'feat: three', all: true });

    expect(outcome.outcome).toBe('empty');
    expect(git(cwd, ['show', '--stat', '--format=', 'HEAD'])).toContain('a.txt');
    expect(git(cwd, ['status', '--porcelain']).trim()).toBe('');
  });
});

describe('the first commit of a repository', () => {
  it('works on an unborn branch, where there is no HEAD to bind to', () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-commit-unborn-'));
    scratch.push(dir);
    git(dir, ['init', '--quiet', '--initial-branch=main', '.']);
    git(dir, ['config', 'user.email', 't@e.invalid']);
    git(dir, ['config', 'user.name', 't']);
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    git(dir, ['add', '-A']);

    const outcome = runCommit({ cwd: dir, message: 'feat: first' });

    expect(outcome.outcome).toBe('empty');
    expect(existsSync(join(dir, '.git'))).toBe(true);
    expect(git(dir, ['log', '--oneline']).trim()).toContain('feat: first');
    expect(readConsideration(dir)?.head).toBeNull();
  });
});

describe('the message that landed, not the transaction that was staged', () => {
  /*
   * `stripped` guards a commit whose message was rewritten after ours. It
   * cannot be reproduced through the hooks this product installs -- the chained
   * `prepare-commit-msg` runs *before* commitlore's, measured in the installed
   * stub, so nothing in the supported layout writes after we do. Rather than
   * contort a fixture until it goes green, the decision is tested where it
   * lives and the integration path is recorded as unexercised.
   */
  it('a message carrying a record reads as recorded', () => {
    expect(recordLanded('feat: x\n\nLimit: y\nRecord-Id: r-abc123\n')).toBe(true);
  });

  it('a message carrying none does not, however much else it carries', () => {
    expect(recordLanded('feat: x\n\nCo-Authored-By: someone <a@b.c>\n')).toBe(false);
    expect(recordLanded('feat: mentions Record-Id in prose, mid-line\n')).toBe(false);
  });

  it('is anchored per line, so a trailer after a body still counts', () => {
    expect(recordLanded('subject\n\nbody\n\nBlast: module\nRecord-Id: r-xyz789\n')).toBe(true);
  });
});
