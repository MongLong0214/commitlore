/**
 * T-302 acceptance: a squash merge must not be able to destroy a branch's
 * records (PRD-F3 AC 1·2, ADR-0004).
 *
 * The first test is the D3 reproduction script turned into an assertion — the
 * experiment that falsified "records are permanent" in the first place. It sets
 * the defect up before fixing it, so a regression that silently stops
 * reproducing D3 fails here rather than passing quietly.
 *
 * Every repository is a throwaway under `os.tmpdir()`. Nothing in this file
 * touches a network or the repository the suite runs in.
 */

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runSquashPreserve } from '../src/commands/squash-preserve.js';
import { execGit } from '../src/core/git.js';
import { listRecordShas, readRecord } from '../src/core/notes.js';
import { validateRecord } from '../src/core/schema.js';
import {
  INHERITED_FROM_KEY,
  collectRange,
  planSquash,
  renderMessage,
  type CollectedRecord,
} from '../src/core/squash.js';
import { parseCommitMessage } from '../src/core/trailers.js';
import type { Trailer } from '../src/core/types.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** `realpathSync` because macOS reports `/var` for a `/private/var` tmpdir. */
const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-${label}-`));
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

const initRepo = (label: string): string => {
  const dir = tempDir(label);
  return createTestRepo({ path: dir });
};

const head = (repo: string): string => git(repo, ['rev-parse', 'HEAD']).trim();

const commitFile = (repo: string, path: string, content: string, message: string): string => {
  writeFileSync(join(repo, path), content);
  git(repo, ['add', '--', path]);
  git(repo, ['commit', '--quiet', '-F', '-'], message);
  return head(repo);
};

const messageOf = (repo: string, sha: string): string =>
  git(repo, ['log', '-1', '--format=%B', sha, '--']);

const values = (trailers: Trailer[], key: string): string[] =>
  trailers.filter((trailer) => trailer.key === key).map((trailer) => trailer.value);

const value = (trailers: Trailer[], key: string): string | undefined => values(trailers, key)[0];

/**
 * The branch of the D3 experiment: three commits on one path, each recording
 * something, two of them under their own `Record-Id`.
 */
const BRANCH: { path: string; content: string; message: string }[] = [
  {
    path: 'queue.ts',
    content: 'export const workers = 3;\n',
    message:
      'add the worker pool\n\n' +
      'Limit: the vendor caps us at 3 concurrent workers\n' +
      'Certainty: firm\n' +
      'Record-Id: r-aaa111\n',
  },
  {
    path: 'queue.ts',
    content: 'export const workers = 3;\nexport const retries = 2;\n',
    message:
      'retry on 429\n\n' +
      'Warn: do not raise the retry ceiling without re-reading the vendor quota\n' +
      'Ruled-out: exponential backoff | the vendor resets the window on every request\n' +
      'Blast: local\n' +
      'Record-Id: r-bbb222\n',
  },
  {
    path: 'queue.ts',
    content: 'export const workers = 3;\nexport const retries = 2;\nexport const drain = true;\n',
    message:
      'drain the queue on shutdown\n\n' +
      'Verified: drained under SIGTERM in a local run\n' +
      'Blast: module\n' +
      'Undo: costly\n',
  },
];

/** GitHub's squash message: subjects as a bulleted list, every trailer gone. */
const GITHUB_DRAFT =
  'Add the worker pool (#7)\n\n' +
  '* add the worker pool\n' +
  '* retry on 429\n' +
  '* drain the queue on shutdown\n';

interface Fixture {
  repo: string;
  base: string;
  branchShas: string[];
  range: string;
}

const squashFixture = (label: string): Fixture => {
  const repo = initRepo(label);
  writeFileSync(join(repo, 'README.md'), 'seed\n');
  git(repo, ['add', '--', 'README.md']);
  git(repo, ['commit', '--quiet', '-m', 'seed']);
  const base = head(repo);

  git(repo, ['checkout', '--quiet', '-b', 'feature']);
  const branchShas = BRANCH.map((step) => commitFile(repo, step.path, step.content, step.message));

  git(repo, ['checkout', '--quiet', 'main']);
  return { repo, base, branchShas, range: `${base}..feature` };
};

/** Stages the branch exactly as a local squash merge would. */
const stageSquash = (repo: string): void => {
  git(repo, ['merge', '--squash', 'feature']);
};

const draftFile = (repo: string, text: string): string => {
  const path = join(repo, 'MERGE_DRAFT.txt');
  writeFileSync(path, text);
  return path;
};

const record = (sha: string, block: string): CollectedRecord => {
  const trailers = parseCommitMessage(`synthetic subject\n\n${block}`);
  const recordId = value(trailers, 'Record-Id');
  return { sha, trailers, ...(recordId === undefined ? {} : { recordId }) };
};

describe('squash-preserve', () => {
  it(
    'reproduces D3 and then repairs it: the branch records reach the merge commit',
    () => {
      const { repo, branchShas, range } = squashFixture('squash-d3');

      // --- D3, reproduced ------------------------------------------------
      stageSquash(repo);
      const draft = draftFile(repo, GITHUB_DRAFT);
      expect(parseCommitMessage(readFileSync(draft, 'utf8'))).toEqual([]);

      // --- the repair ----------------------------------------------------
      const outcome = runSquashPreserve({ range, messageFile: draft, cwd: repo });
      expect(outcome.code).toBe(0);

      git(repo, ['commit', '--quiet', '-F', draft]);
      const mergeSha = head(repo);
      const trailers = parseCommitMessage(messageOf(repo, mergeSha));

      expect(values(trailers, 'Limit')).toEqual([
        'the vendor caps us at 3 concurrent workers',
      ]);
      expect(values(trailers, 'Warn')).toEqual([
        'do not raise the retry ceiling without re-reading the vendor quota',
      ]);
      expect(values(trailers, 'Ruled-out')).toEqual([
        'exponential backoff | the vendor resets the window on every request',
      ]);
      expect(values(trailers, 'Verified')).toEqual(['drained under SIGTERM in a local run']);
      expect(value(trailers, 'Undo')).toBe('costly');
      expect(value(trailers, 'Provenance')).toBe(`inherited ${branchShas[2] ?? ''}`);

      // The prose the merge arrived with is still there.
      expect(messageOf(repo, mergeSha)).toContain('* retry on 429');

      // PRD-F3 AC 1 in protocol terms: the path-scoped walk that
      // `commitlore limits -- queue.ts` performs now reaches the record. Only
      // the merge commit touches this path on main, so the walk is one message.
      const pathScoped = git(repo, ['log', '--format=%B', '--', 'queue.ts']);
      expect(values(parseCommitMessage(pathScoped), 'Limit')).toEqual([
        'the vendor caps us at 3 concurrent workers',
      ]);
    },
    30_000,
  );

  it(
    'attaches the inherited record to the merge commit in the notes mirror',
    () => {
      const { repo, branchShas, range } = squashFixture('squash-notes');

      stageSquash(repo);
      git(repo, ['commit', '--quiet', '-F', '-'], GITHUB_DRAFT);
      const mergeSha = head(repo);

      // The merge commit's own message records nothing — this is the notes path.
      expect(parseCommitMessage(messageOf(repo, mergeSha))).toEqual([]);

      const outcome = runSquashPreserve({ range, target: mergeSha, cwd: repo });
      expect(outcome.code).toBe(0);

      const mirrored = readRecord(mergeSha, { cwd: repo });
      expect(values(mirrored, 'Limit')).toEqual(['the vendor caps us at 3 concurrent workers']);
      expect(value(mirrored, 'Provenance')).toBe(`inherited ${branchShas[2] ?? ''}`);

      // Per-source provenance: one line per original, ids where they existed.
      expect(values(mirrored, INHERITED_FROM_KEY)).toEqual([
        `r-aaa111 ${branchShas[0] ?? ''}`,
        `r-bbb222 ${branchShas[1] ?? ''}`,
        branchShas[2] ?? '',
      ]);

      // A second run does not quietly replace what the first one wrote.
      const again = runSquashPreserve({ range, target: mergeSha, cwd: repo });
      expect(again.code).toBe(2);
      expect(again.stderr).toMatch(/exists|existing/i);
      expect(readRecord(mergeSha, { cwd: repo })).toEqual(mirrored);

      expect(runSquashPreserve({ range, target: mergeSha, force: true, cwd: repo }).code).toBe(0);
    },
    30_000,
  );

  it(
    'survives a rebase -i that rewrites the merge commit, through the mirror',
    () => {
      const { repo, range } = squashFixture('squash-rebase');

      stageSquash(repo);
      git(repo, ['commit', '--quiet', '-F', '-'], GITHUB_DRAFT);
      const mergeSha = head(repo);

      expect(runSquashPreserve({ range, target: mergeSha, cwd: repo }).code).toBe(0);

      // git copies notes across a rewrite only for the refs named here; without
      // it the mirror stays on the original object and nothing else.
      git(repo, ['config', 'notes.rewriteRef', 'refs/notes/commitlore']);

      writeFileSync(join(repo, 'README.md'), 'seed\ntouched\n');
      git(repo, ['add', '--', 'README.md']);
      git(repo, ['commit', '--quiet', '-m', 'touch up the readme']);

      // `rebase -i` with a todo that squashes the second pick into the first —
      // a real interactive rebase, driven by config instead of an editor.
      const editor = join(tempDir('squash-rebase-editor'), 'squash-todo.mjs');
      writeFileSync(
        editor,
        [
          "import { readFileSync, writeFileSync } from 'node:fs';",
          'const [, , todo] = process.argv;',
          'let seen = 0;',
          "const lines = readFileSync(todo, 'utf8').split('\\n').map((line) => {",
          "  if (!line.startsWith('pick ')) return line;",
          '  seen += 1;',
          "  return seen === 2 ? line.replace('pick ', 'squash ') : line;",
          '});',
          "writeFileSync(todo, lines.join('\\n'));",
          '',
        ].join('\n'),
      );

      git(repo, [
        '-c',
        `sequence.editor=node ${editor}`,
        '-c',
        'core.editor=true',
        'rebase',
        '-i',
        'HEAD~2',
      ]);

      const rewritten = head(repo);
      expect(rewritten).not.toBe(mergeSha);
      expect(git(repo, ['rev-list', 'HEAD'])).not.toContain(mergeSha);

      // The message channel died in the rewrite: the squashed message ends with
      // the second commit's prose, so the trailer block is gone (SPEC §2.1 B2).
      expect(parseCommitMessage(messageOf(repo, rewritten))).toEqual([]);

      // The mirror did not. Both on the original object, which is now
      // unreachable, and on the commit that replaced it.
      expect(values(readRecord(mergeSha, { cwd: repo }), 'Limit')).toEqual([
        'the vendor caps us at 3 concurrent workers',
      ]);
      expect(values(readRecord(rewritten, { cwd: repo }), 'Limit')).toEqual([
        'the vendor caps us at 3 concurrent workers',
      ]);
    },
    60_000,
  );

  it('collapses a Record-Id declared by several commits into one record', () => {
    const repo = initRepo('squash-dedupe');
    writeFileSync(join(repo, 'README.md'), 'seed\n');
    git(repo, ['add', '--', 'README.md']);
    git(repo, ['commit', '--quiet', '-m', 'seed']);
    const base = head(repo);

    const block = 'Limit: the vendor caps us at 3 concurrent workers\nRecord-Id: r-ddd444\n';
    commitFile(repo, 'a.ts', 'a\n', `first\n\n${block}`);
    commitFile(repo, 'a.ts', 'aa\n', `second\n\n${block}`);
    commitFile(repo, 'a.ts', 'aaa\n', `third\n\n${block}`);

    const plan = planSquash(collectRange(`${base}..HEAD`, { cwd: repo }));

    expect(plan.sources).toHaveLength(3);
    expect(values(plan.merged, 'Limit')).toEqual([
      'the vendor caps us at 3 concurrent workers',
    ]);
    expect(values(plan.merged, 'Record-Id')).toEqual(['r-ddd444']);
    // Restating a record is not a conflict — only changing it is.
    expect(plan.conflicts).toEqual([]);
    expect(plan.provenance.map((entry) => entry.recordId)).toEqual([
      'r-ddd444',
      'r-ddd444',
      'r-ddd444',
    ]);
  });

  it('reports a contradicted Record-Id, keeps the latest, and warns', () => {
    const repo = initRepo('squash-conflict');
    writeFileSync(join(repo, 'README.md'), 'seed\n');
    git(repo, ['add', '--', 'README.md']);
    git(repo, ['commit', '--quiet', '-m', 'seed']);
    const base = head(repo);

    const older = commitFile(
      repo,
      'a.ts',
      'a\n',
      'first\n\nLimit: the quota is 3\nExpires: when the vendor ships v3\nRecord-Id: r-eee555\n',
    );
    const newer = commitFile(
      repo,
      'a.ts',
      'aa\n',
      'second\n\nLimit: the quota is 5\nExpires: when the vendor ships v4\nRecord-Id: r-eee555\n',
    );

    const range = `${base}..HEAD`;
    const plan = planSquash(collectRange(range, { cwd: repo }));

    expect(plan.conflicts).toEqual([{ recordId: 'r-eee555', kept: newer, dropped: [older] }]);
    // Both claims survive on a repeatable key; the single-valued one resolves.
    expect(values(plan.merged, 'Limit')).toEqual(['the quota is 3', 'the quota is 5']);
    expect(value(plan.merged, 'Expires')).toBe('when the vendor ships v4');

    const outcome = runSquashPreserve({ range, cwd: repo });
    expect(outcome.code).toBe(0);
    expect(outcome.stderr).toContain('conflict on r-eee555');
    expect(outcome.stderr).toContain(newer.slice(0, 8));
    expect(outcome.stderr).toContain(older.slice(0, 8));
  });

  it('keeps the most conservative value of every single-valued risk key', () => {
    const plan = planSquash([
      record('1111111111111111111111111111111111111111', 'Blast: local\nUndo: easy\nCertainty: firm\n'),
      record('2222222222222222222222222222222222222222', 'Blast: system\nUndo: permanent\nCertainty: guess\n'),
      record('3333333333333333333333333333333333333333', 'Blast: local\nUndo: easy\nCertainty: firm\n'),
    ]);

    // The latest source says `local`/`easy`/`firm`. The approval gate reads
    // these, so the merge must not collapse toward the optimistic answer.
    expect(value(plan.merged, 'Blast')).toBe('system');
    expect(value(plan.merged, 'Undo')).toBe('permanent');
    expect(value(plan.merged, 'Certainty')).toBe('guess');
  });

  it('produces a record that passes validate on both channels', () => {
    const { repo, range } = squashFixture('squash-valid');

    stageSquash(repo);
    const draft = draftFile(repo, GITHUB_DRAFT);
    expect(runSquashPreserve({ range, messageFile: draft, cwd: repo }).code).toBe(0);
    git(repo, ['commit', '--quiet', '-F', draft]);
    const mergeSha = head(repo);

    expect(runSquashPreserve({ range, target: mergeSha, cwd: repo }).code).toBe(0);

    expect(validateRecord(parseCommitMessage(messageOf(repo, mergeSha)))).toEqual([]);
    expect(validateRecord(readRecord(mergeSha, { cwd: repo }))).toEqual([]);

    // Rewriting an already-rewritten draft replaces the block rather than
    // appending a second one, which B2 would turn into prose.
    const once = readFileSync(draft, 'utf8');
    const plan = planSquash(collectRange(range, { cwd: repo }));
    expect(renderMessage(once, plan)).toBe(once);
  });

  it('changes nothing when neither --message-file nor --target is given', () => {
    const { repo, range } = squashFixture('squash-dry');

    stageSquash(repo);
    const draft = draftFile(repo, GITHUB_DRAFT);
    const before = {
      head: head(repo),
      status: git(repo, ['status', '--porcelain']),
      draft: readFileSync(draft, 'utf8'),
    };

    const outcome = runSquashPreserve({ range, cwd: repo });

    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain('Limit: the vendor caps us at 3 concurrent workers');
    expect(outcome.stderr).toContain('plan only');

    const asJson = runSquashPreserve({ range, json: true, cwd: repo });
    expect(asJson.code).toBe(0);
    const payload: {
      range: string;
      sources: { sha: string }[];
      merged: Trailer[];
      applied: { messageFile: string | null; target: string | null };
    } = JSON.parse(asJson.stdout);
    expect(payload.range).toBe(range);
    expect(payload.sources).toHaveLength(3);
    expect(value(payload.merged, 'Undo')).toBe('costly');
    expect(payload.applied).toEqual({ messageFile: null, target: null });

    expect(head(repo)).toBe(before.head);
    expect(git(repo, ['status', '--porcelain'])).toBe(before.status);
    expect(readFileSync(draft, 'utf8')).toBe(before.draft);
    expect(listRecordShas({ cwd: repo })).toEqual([]);
  });

  it('exits 2 for an empty range, a non-range, and a range that names nothing', () => {
    const { repo, base, range } = squashFixture('squash-bad-range');

    const empty = runSquashPreserve({ range: `${base}..${base}`, cwd: repo });
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain('holds no commits');

    const notARange = runSquashPreserve({ range: 'feature', cwd: repo });
    expect(notARange.code).toBe(2);
    expect(notARange.stderr).toContain('expected a range');

    const unknown = runSquashPreserve({ range: 'nope..alsonope', cwd: repo });
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('cannot walk range');

    // Nothing was written on any of those paths.
    expect(listRecordShas({ cwd: repo })).toEqual([]);
    expect(runSquashPreserve({ range, cwd: repo }).code).toBe(0);
  });

  it('exits 0 and writes nothing when the range recorded nothing', () => {
    const repo = initRepo('squash-no-records');
    writeFileSync(join(repo, 'README.md'), 'seed\n');
    git(repo, ['add', '--', 'README.md']);
    git(repo, ['commit', '--quiet', '-m', 'seed']);
    const base = head(repo);
    commitFile(repo, 'a.ts', 'a\n', 'a trivial change\n');

    const draft = draftFile(repo, GITHUB_DRAFT);
    const outcome = runSquashPreserve({
      range: `${base}..HEAD`,
      messageFile: draft,
      cwd: repo,
    });

    expect(outcome.code).toBe(0);
    expect(outcome.stderr).toContain('nothing to preserve');
    expect(readFileSync(draft, 'utf8')).toBe(GITHUB_DRAFT);
  });
});
