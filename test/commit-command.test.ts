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
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { runCapture } from '../src/commands/capture.js';
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
  });

  it('commit: false really does not commit', () => {
    // Its own case, against a HEAD read before the call. The assertion this
    // replaces compared `head(cwd)` with `head(cwd)` and was true whatever the
    // code did -- it would have passed with `commit: false` inverted.
    const { cwd } = repo('no-commit');
    const before = head(cwd);

    const outcome = runCommit({ cwd, message: 'chore: tidy', commit: false });

    expect(outcome.outcome).toBe('staged');
    expect(outcome.commit).toBeNull();
    expect(head(cwd)).toBe(before);
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

  it('when asked to stage a record in a repository whose hook cannot apply it', () => {
    const { cwd, transcript, draft } = repo('no-hook', { hooks: false });
    const outcome = runCommit({ cwd, message: 'x', transcript, draft, commit: false });
    expect(outcome.outcome).toBe('error');
    expect(outcome.lines.join('\n')).toContain('hooks install');
  });

  it('but not when there is no record for that hook to apply', () => {
    // The control. Refusing a caller that is recording nothing and wants to run
    // the commit itself refuses a correct call -- the over-refusal this whole
    // feature exists to avoid, one layer in.
    const { cwd } = repo('no-hook-no-draft', { hooks: false });
    expect(runCommit({ cwd, message: 'x', commit: false }).outcome).toBe('staged');
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

describe('the defects an adversarial review found', () => {
  it('works from a linked worktree, where --git-path answers with an absolute path', () => {
    // `join(cwd, absolutePath)` produced `<worktree>/<absolute path>`, so the
    // hook check failed in exactly the repositories that have a hook: the
    // command refused every call from a worktree, and a call carrying records
    // staged a transaction and then abandoned it.
    const { cwd } = repo('worktree-main');
    const linked = join(cwd, '..', `linked-${String(Date.now())}`);
    git(cwd, ['worktree', 'add', '--quiet', '-b', 'side', linked]);
    try {
      writeFileSync(join(linked, 'a.txt'), 'one\ntwo\nthree\n');
      git(linked, ['add', '-A']);

      const outcome = runCommit({ cwd: linked, message: 'chore: from a worktree', commit: false });

      expect(outcome.outcome).toBe('staged');
      expect(readConsideration(linked)?.outcome).toBe('empty');
    } finally {
      git(cwd, ['worktree', 'remove', '--force', linked]);
    }
  });

  it('does not report `empty` when a record staged before the call lands anyway', () => {
    // The five-step flow and this command share one hook, so a transaction
    // staged by the old route is applied by a commit made through the new one.
    // Reporting `empty` there describes a commit carrying `Record-Id:` as
    // carrying nothing -- and writes a binding saying the same.
    const { cwd, transcript, draft } = repo('pre-staged');
    const staged = runCommit({ cwd, message: 'feat: staged first', transcript, draft, commit: false });
    expect(staged.outcome).toBe('staged');

    const outcome = runCommit({ cwd, message: 'feat: committed second' });

    expect(headBody(cwd)).toContain('Record-Id:');
    expect(outcome.outcome).toBe('recorded');
    expect(outcome.records).toBe(1);
  });

  it('a commit that happened is not reported as failed, however loud a post-commit hook is', () => {
    // Judged by HEAD rather than by exit status. With the 1 MiB default buffer
    // a chatty `post-commit` made a real commit report `commit_failed` with
    // `commit: null`, and cleared the binding under it.
    const { cwd } = repo('loud-post-commit');
    writeFileSync(
      join(cwd, '.git', 'hooks', 'post-commit'),
      '#!/bin/sh\nhead -c 2000000 /dev/zero | tr "\\0" "x"\nexit 0\n',
      { mode: 0o755 },
    );
    const before = head(cwd);

    const outcome = runCommit({ cwd, message: 'chore: noisy' });

    expect(head(cwd)).not.toBe(before);
    expect(outcome.outcome).toBe('empty');
    expect(outcome.commit).toBe(head(cwd));
    expect(readConsideration(cwd)).not.toBeNull();
  });

  it('a hook of ours that cannot run is "no hook", not "ours"', () => {
    // git runs only executable hooks. Reading the file alone cannot tell an
    // installed hook from an inert one, and the inert one silently drops every
    // record it was supposed to apply.
    const { cwd, transcript, draft } = repo('inert-hook');
    chmodSync(join(cwd, '.git', 'hooks', 'prepare-commit-msg'), 0o644);

    const outcome = runCommit({ cwd, message: 'chore: x', transcript, draft, commit: false });

    expect(outcome.outcome).toBe('error');
    expect(outcome.lines.join('\n')).toContain('hooks install');
  });

  it('--all says that a refusal leaves the index staged, which git commit -a does not', () => {
    const { cwd, transcript } = repo('all-refused');
    writeFileSync(join(cwd, 'a.txt'), 'one\ntwo\nthree\n');

    const outcome = runCommit({
      cwd,
      message: 'feat: x',
      all: true,
      transcript,
      draft: draftWith('nowhere in the transcript', 'r-commitcmd05'),
    });

    expect(outcome.outcome).toBe('refused');
    expect(outcome.lines.join('\n')).toContain('still staged');
    expect(git(cwd, ['status', '--porcelain']).trim().startsWith('M ')).toBe(true);
  });
});

/**
 * The five-step flow must satisfy the gate, because it is the flow this
 * product's own instructions prescribe.
 *
 * Before the consideration was written in the shared core, it was not: an agent
 * that ran prepare, verify and stage -- as the MCP `instructions` and the
 * commit skill both tell it to -- had its commit refused with "this staged tree
 * has not been considered", and was advised to pass `records: []`. That advice
 * would have discarded the record it had just verified. A gate that destroys
 * records by following its own instruction is worse than no gate.
 *
 * These drive `runCapture`, the same function the CLI and the MCP handler both
 * reach, so the binding is asserted on the route rather than on the caller.
 */
describe('the five-step flow satisfies the gate', () => {
  it('a staged record binds the tree it was staged for', () => {
    const { cwd, transcript, draft } = repo('five-recorded');

    const capture = runCapture({ cwd, transcript, draft });

    expect(capture.outcome).toBe('staged');
    expect(readConsideration(cwd)?.outcome).toBe('recorded');
  });

  it('a draft that submitted nothing binds too — that is a complete answer', () => {
    const { cwd, transcript } = repo('five-empty');

    const capture = runCapture({ cwd, transcript, draft: JSON.stringify({ records: [] }) });

    expect(capture.outcome).toBe('empty');
    expect(readConsideration(cwd)?.outcome).toBe('empty');
  });

  it('a draft whose every record was refused binds nothing', () => {
    // The control that keeps the two apart. If a refusal bound the tree, a bad
    // draft would reach the same state as a real consideration, and the gate
    // would pass anything that failed verification.
    const { cwd, transcript } = repo('five-refused');

    const capture = runCapture({
      cwd,
      transcript,
      draft: draftWith('nowhere in this transcript at all', 'r-fivestep99'),
    });

    expect(capture.outcome).toBe('rejected');
    expect(readConsideration(cwd)).toBeNull();
  });
});
