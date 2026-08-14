/**
 * #638: which commit operations count as an amend, pinned by measurement.
 *
 * `commit-msg` cannot tell an amend from an ordinary commit — git hands it
 * nothing that differs. `prepare-commit-msg` can: git passes `commit` as the
 * source and HEAD as the sha. That asymmetry is the whole basis of the fix, and
 * it was found by running the hooks rather than by reading the documentation,
 * after two rounds of reasoning reached the opposite conclusion.
 *
 * The table below is that measurement. It is here because the next version of
 * git can change it silently, and because `rebase -i` reword produces byte-
 * identical arguments to an amend — the two are told apart only by a rebase
 * being in progress, which is the kind of fact that stops being true without
 * anyone noticing.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const LOG = 'prepare.log';

/** A repository whose prepare-commit-msg records the arguments git hands it. */
const repoRecordingHookArguments = (label: string): string => {
  const dir = createTestRepo({ path: mkdtempSync(join(tmpdir(), `cl-amend-${label}-`)) });
  scratch.push(dir);
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
  const hook = join(dir, '.git', 'hooks', 'prepare-commit-msg');
  writeFileSync(
    hook,
    [
      '#!/bin/sh',
      'op=""',
      'for name in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG sequencer; do',
      '  path="$(git rev-parse --git-path "$name")"',
      '  if [ -e "$path" ]; then op="$op$name "; fi',
      'done',
      `echo "src=\${2} op=\${op}" >> "$(git rev-parse --show-toplevel)/${LOG}"`,
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(hook, 0o755);
  return dir;
};

const git = (cwd: string, args: string[]): void => {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
};

const commitFile = (cwd: string, name: string, message: string): void => {
  writeFileSync(join(cwd, name), `${name}\n`, 'utf8');
  git(cwd, ['add', name]);
  git(cwd, ['commit', '--quiet', '--no-verify', '-m', message]);
};

const recorded = (cwd: string): string[] =>
  readFileSync(join(cwd, LOG), 'utf8').split('\n').filter((line) => line !== '');

describe('#638 what prepare-commit-msg is told, per commit operation', () => {
  it('gives an amend a source of commit with no operation in progress', () => {
    const repo = repoRecordingHookArguments('amend');
    commitFile(repo, 'a.txt', 'first');
    git(repo, ['commit', '--quiet', '--amend', '--no-edit']);

    const [ordinary, amend] = recorded(repo);
    expect(ordinary, 'an ordinary commit is not an amend').toBe('src=message op=');
    expect(amend, 'and this is the one signal that says it is').toBe('src=commit op=');
  });

  // The case that makes `source` alone unusable. Identical arguments to an
  // amend; only the rebase directory separates them.
  it('gives a rebase reword the same source and sha as an amend', () => {
    const repo = repoRecordingHookArguments('reword');
    commitFile(repo, 'a.txt', 'first');
    commitFile(repo, 'b.txt', 'second');
    execFileSync('git', ['rebase', '-i', 'HEAD~1'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GIT_SEQUENCE_EDITOR: "sed -i.bak 's/^pick/reword/'", GIT_EDITOR: 'true' },
    });

    const reword = recorded(repo).at(-1);
    expect(reword, 'source and sha cannot tell this from an amend').toContain('src=commit');
    expect(reword, 'the operation in progress is what can').toContain('rebase-merge');
  });

  it('gives cherry-pick and revert a source that is not commit', () => {
    const repo = repoRecordingHookArguments('pick');
    commitFile(repo, 'a.txt', 'first');
    git(repo, ['checkout', '--quiet', '-b', 'side']);
    commitFile(repo, 's.txt', 'side');
    git(repo, ['checkout', '--quiet', '-']);
    commitFile(repo, 'b.txt', 'second');

    git(repo, ['cherry-pick', 'side']);
    const pick = recorded(repo).at(-1);
    git(repo, ['revert', '--no-edit', 'HEAD']);
    const revert = recorded(repo).at(-1);

    expect(pick, 'cherry-pick carries its own head marker, not a commit source').toBe(
      'src=message op=CHERRY_PICK_HEAD ',
    );
    expect(revert, 'revert reaches the hook as an ordinary message').toBe('src=message op=');
  });

  it('gives a merge its own source', () => {
    const repo = repoRecordingHookArguments('merge');
    commitFile(repo, 'a.txt', 'first');
    git(repo, ['checkout', '--quiet', '-b', 'side']);
    commitFile(repo, 's.txt', 'side');
    git(repo, ['checkout', '--quiet', '-']);
    commitFile(repo, 'b.txt', 'second');
    git(repo, ['merge', '--no-ff', '--no-edit', 'side']);

    expect(recorded(repo).at(-1)).toBe('src=merge op=MERGE_HEAD ');
  });
});
