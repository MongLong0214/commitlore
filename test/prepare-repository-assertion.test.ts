/**
 * #1030: prepare binds to the server's checkout, and now says so or refuses.
 *
 * The MCP server is registered against one working tree and answers from it. A
 * session whose working directory was a **linked worktree** of the same
 * repository called `prepare_capture` and got a transaction bound to the other
 * tree: `base_head` was the main checkout's HEAD, `staged_diff_hash` was the
 * SHA-256 of the empty string, and three files were staged in the caller's tree
 * at that moment. Nothing in the response was wrong — and nothing in it looked
 * wrong either, because `staged_diff_empty: true` is exactly what a caller sees
 * when they have staged nothing.
 *
 * ## Why an assertion rather than detection
 *
 * The server cannot discover the caller's working directory: MCP carries no such
 * field, and a guess from the process tree is wrong in precisely the
 * multi-worktree case this exists for. So the caller states the tree it means
 * and the server verifies the statement — the shape `--diff` already has on
 * `capture` (#877/#1023). The argument cannot change the binding, only assert
 * it, and a wrong assertion is a refusal rather than a silent rebinding.
 *
 * ## What is deliberately not changed
 *
 * The harvest prompt's `(no diff — nothing is staged)` is left alone.
 * `test/token-ledger.test.ts` prices every capture against a scaffold built with
 * an empty diff and asserts no real prompt is cheaper, so text that appears only
 * in the no-diff branch inflates the scaffold above a prompt carrying a real
 * diff — the regression `src/core/harvest.ts:671` already records having been
 * caught by. The response is where the reporter asked for the fact anyway.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { prepareCaptureContext } from '../src/core/capture-prepare.js';
import {
  assertRepositoryBinding,
  emptyStagedDiffNote,
} from '../src/core/repository-assertion.js';
import { startStub, type Stub } from './mcp-client.js';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(REPO_ROOT, 'dist', 'commitlore.mjs');

const scratch: string[] = [];
const running: Stub[] = [];
afterAll(async () => {
  for (const stub of running) await stub.close();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (dir: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });

const TRANSCRIPT =
  'We decided: Keep the retry ceiling at three attempts because more masks real failures.';

/** A repository plus a linked worktree of it, with a change staged in the worktree only. */
const repositoryWithWorktree = (): { main: string; tree: string } => {
  const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-wtbind-')));
  scratch.push(base);
  const main = join(base, 'main');
  mkdirSync(main, { recursive: true });
  git(main, ['init', '-q', '--initial-branch=main', '.']);
  git(main, ['config', 'user.email', 'wt@example.invalid']);
  git(main, ['config', 'user.name', 'WT']);
  mkdirSync(join(main, 'src'), { recursive: true });
  writeFileSync(join(main, 'src', 'app.js'), 'export const run = (x) => x;\n');
  git(main, ['add', '-A']);
  git(main, ['commit', '-q', '--no-verify', '-m', 'feat: initial']);

  const tree = join(base, 'linked');
  git(main, ['worktree', 'add', '-q', '-b', 'feat/branch', tree]);
  // A commit on the branch, so the two trees disagree about HEAD.
  writeFileSync(join(tree, 'src', 'app.js'), 'export const run = (x) => x ?? null;\n');
  git(tree, ['add', '-A']);
  git(tree, ['commit', '-q', '--no-verify', '-m', 'feat: branch']);
  // And something staged in the worktree that the main checkout cannot see.
  writeFileSync(join(tree, 'src', 'app.js'), 'export const run = (x) => (x == null ? null : x);\n');
  git(tree, ['add', '-A']);
  return { main, tree };
};

describe('#1030 the defect, reproduced', () => {
  it('binds to the server\'s tree with an empty diff while the caller has three files staged', () => {
    // The negative control for everything below. Without this, "the assertion
    // refuses" proves only that a string comparison works — not that there was
    // a wrong binding to prevent.
    const { main, tree } = repositoryWithWorktree();
    expect(git(tree, ['diff', '--cached', '--name-only']).trim()).toBe('src/app.js');

    const result = prepareCaptureContext({ cwd: main, transcript: TRANSCRIPT });

    expect(result.base_head).toBe(git(main, ['rev-parse', 'HEAD']).trim());
    expect(result.base_head, 'the two trees agreed on HEAD, so nothing was reproduced').not.toBe(
      git(tree, ['rev-parse', 'HEAD']).trim(),
    );
    // SHA-256 of the empty string — indistinguishable from "you staged nothing".
    expect(result.staged_diff_hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  }, 300_000);
});

describe('#1030 the assertion', () => {
  it('refuses a worktree of the same repository, naming both trees', () => {
    const { main, tree } = repositoryWithWorktree();

    let message = '';
    try {
      assertRepositoryBinding(tree, main);
      throw new Error('no refusal');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message, 'the mismatch was not refused').not.toBe('no refusal');
    expect(message).toContain(tree);
    expect(message).toContain(main);
    // Naming the shared repository is the point: told only that two paths
    // differ, a caller goes looking for a configuration error, when what
    // happened is that both trees are the same project on different branches.
    expect(message).toContain('worktrees of the same repository');
    expect(message).toContain('feat/branch');
  }, 300_000);

  it('accepts the tree the server is actually bound to', () => {
    // The control on the other side. A check that refused everything would pass
    // every assertion above and break every ordinary caller.
    const { main } = repositoryWithWorktree();
    expect(() => {
      assertRepositoryBinding(main, main);
    }).not.toThrow();
  }, 300_000);

  it('accepts a path that reaches the same tree by another name', () => {
    // macOS hands out `/tmp/x` and `/private/tmp/x` for one directory. Compared
    // as strings, a caller who did nothing wrong is told they named another
    // repository.
    const { main } = repositoryWithWorktree();
    const viaDot = join(main, 'src', '..');
    expect(() => {
      assertRepositoryBinding(viaDot, main);
    }).not.toThrow();
  }, 300_000);

  it('says "separate repositories" when they are', () => {
    const { main } = repositoryWithWorktree();
    const other = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-other-')));
    scratch.push(other);
    git(other, ['init', '-q', '--initial-branch=main', '.']);
    git(other, ['config', 'user.email', 'o@example.invalid']);
    git(other, ['config', 'user.name', 'O']);
    writeFileSync(join(other, 'a.txt'), 'a\n');
    git(other, ['add', '-A']);
    git(other, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'init']);

    expect(() => {
      assertRepositoryBinding(other, main);
    }).toThrow(/separate repositories/);
  }, 300_000);

  it('says so when the asserted path is not a working tree at all', () => {
    const { main } = repositoryWithWorktree();
    const notARepo = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-norepo-')));
    scratch.push(notARepo);

    expect(() => {
      assertRepositoryBinding(notARepo, main);
    }).toThrow(/is not a git working tree/);
  }, 300_000);
});

describe('#1030 the empty-diff note', () => {
  it('names the tree it inspected and the assertion that would have refused', () => {
    const note = emptyStagedDiffNote('/somewhere/main');
    expect(note).toContain('/somewhere/main');
    expect(note).toContain('repository');
    expect(note).toContain('refuse');
  }, 300_000);
});

describe('#1030 over MCP', () => {
  const connect = async (cwd: string): Promise<Stub> => {
    const stub = startStub(cwd, CLI, ['mcp']);
    running.push(stub);
    const initialized = await stub.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'bind', version: '1' },
    });
    expect(
      initialized.error,
      `initialize failed: ${JSON.stringify(initialized.error)}`,
    ).toBeUndefined();
    stub.notify('notifications/initialized');
    return stub;
  };

  const call = async (
    stub: Stub,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    const response = await stub.request('tools/call', { name, arguments: args });
    const content = (response.result as { content?: { text?: string }[] } | undefined)?.content;
    return content?.[0]?.text ?? JSON.stringify(response.error ?? {});
  };

  const pendingFiles = (dir: string): string[] => {
    const path = join(dir, '.git', 'commitlore', 'pending');
    return existsSync(path) ? readdirSync(path) : [];
  };

  it('refuses the mismatch and leaves no pending transaction behind', async () => {
    const { main, tree } = repositoryWithWorktree();
    spawnSync(process.execPath, [CLI, 'init', '--unattended'], { cwd: main, encoding: 'utf8' });
    const stub = await connect(main);

    const text = await call(stub, 'commitlore_prepare_capture', {
      transcript: TRANSCRIPT,
      repository: tree,
    });

    expect(text).toContain('different working tree');
    expect(text).not.toMatch(/"nonce"\s*:\s*"[0-9a-f]{32}"/);
    // A refusal that still cost a pending file would hand `capture gc` work for
    // a transaction that never existed — the placement #877 settled for `--diff`.
    expect(pendingFiles(main)).toEqual([]);
  }, 300_000);

  it('prepares when the assertion matches, and still reports the repository', async () => {
    // The premise. Without it the refusal above could describe a server that
    // rejects the argument outright.
    const { main } = repositoryWithWorktree();
    spawnSync(process.execPath, [CLI, 'init', '--unattended'], { cwd: main, encoding: 'utf8' });
    const stub = await connect(main);

    const text = await call(stub, 'commitlore_prepare_capture', {
      transcript: TRANSCRIPT,
      repository: main,
    });

    expect(text).toMatch(/"nonce"\s*:\s*"[0-9a-f]{32}"/);
    expect(text).toContain('"repository"');
  }, 300_000);

  it('explains an empty staged diff instead of only flagging it', async () => {
    // Nothing staged in the server's own tree: the response must distinguish
    // this from "I looked somewhere else" rather than leaving `repository` to be
    // spotted among sixteen fields.
    const { main } = repositoryWithWorktree();
    spawnSync(process.execPath, [CLI, 'init', '--unattended'], { cwd: main, encoding: 'utf8' });
    const stub = await connect(main);

    const text = await call(stub, 'commitlore_prepare_capture', { transcript: TRANSCRIPT });
    const body = JSON.parse(text) as {
      staged_diff_empty: boolean;
      staged_diff_empty_means: string | null;
    };

    expect(body.staged_diff_empty).toBe(true);
    expect(body.staged_diff_empty_means).toContain('linked worktree');
    expect(body.staged_diff_empty_means).toContain('repository');
  }, 300_000);
});
