/**
 * `pre-push` hook — #416: the half of the notes round trip that was missing.
 *
 * `doctor --fix` writes the fetch refspec, so a clone *receives* the mirror on
 * any `git fetch`. Nothing ever sent one. This hook is where the other half
 * goes, and the choice of hook is the decision worth stating:
 *
 * **The mirror rides an operation the user already started.** Pushing notes on
 * every commit would put a network call, and a possible failure, into an
 * operation that had none — on a machine that may be offline, in a repository
 * whose remote the user was not ready to write to. `pre-push` fires exactly
 * when the user has decided to publish, and carries the records with the code
 * they describe.
 *
 * **It cannot fail a push.** git aborts a push when `pre-push` exits non-zero,
 * so every path here ends in 0. A notes ref that will not sync is a
 * synchronisation problem; a code push refused because of one is a worse
 * problem that this hook would have caused. Anything worth knowing goes to
 * stderr, where git shows it without acting on it.
 *
 * git passes the remote name as the first argument, so only the remote actually
 * being pushed to is synced — not every remote the repository happens to have.
 */

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Command } from 'commander';

import { execGit } from '../core/git.js';
import { syncNotes, type SyncResult } from '../core/sync.js';
import { CHAINED_SUFFIX, HOOK_MODE, captureHookStub } from './commit-msg.js';

export const PRE_PUSH_HOOK_MARKER = '# commitlore:pre-push:v1';
export const PRE_PUSH_HOOK_NAME = 'pre-push';
export const PRE_PUSH_CHAINED_HOOK_NAME = `${PRE_PUSH_HOOK_NAME}${CHAINED_SUFFIX}`;

/**
 * A notes mirror is auxiliary to a branch push, so two seconds is enough to
 * fail a stalled transport without making an offline push feel stuck.
 */
export const PRE_PUSH_NOTES_SYNC_TIMEOUT_MS = 2_000;

export interface PrePushHookResult {
  readonly code: 0 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

const hookSuccess = (line: string): PrePushHookResult => ({ code: 0, stdout: `${line}\n`, stderr: '' });
const hookFailure = (line: string): PrePushHookResult => ({ code: 2, stdout: '', stderr: `commitlore: ${line}\n` });

/**
 * The stub, from the same shared body as the other hooks.
 *
 * `captureHookStub()` is the ending that lets the operation through, which is
 * the required one here: see the module comment.
 */
export const prePushStub = (): string =>
  captureHookStub()
    .replaceAll('commit-msg', PRE_PUSH_HOOK_NAME)
    .replaceAll('validate --message-file "$1"', 'pre-push "$@"');

/** Written through a temporary name so a hook is never half-written. */
const writePrePushHook = (path: string): void => {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, prePushStub(), { mode: HOOK_MODE });
  chmodSync(temporary, HOOK_MODE);
  renameSync(temporary, path);
};

export const installPrePushHook = (cwd = process.cwd()): PrePushHookResult => {
  let hookPath: string;
  try {
    const result = execGit(['rev-parse', '--git-path', `hooks/${PRE_PUSH_HOOK_NAME}`], { cwd });
    if (result.code !== 0) return hookFailure(result.stderr.trim() || 'not a git repository');
    hookPath = resolve(cwd, result.stdout.trim());
    mkdirSync(resolve(hookPath, '..'), { recursive: true });
  } catch (error) {
    return hookFailure(error instanceof Error ? error.message : String(error));
  }

  try {
    if (existsSync(hookPath)) {
      const current = readFileSync(hookPath, 'utf8');
      if (!current.includes(PRE_PUSH_HOOK_MARKER)) {
        return hookFailure(`${hookPath} is not a commitlore hook — left in place`);
      }
      if (current === prePushStub()) {
        return hookSuccess(`${PRE_PUSH_HOOK_NAME} hook already installed: ${hookPath} (unchanged)`);
      }
      writePrePushHook(hookPath);
      return hookSuccess(`updated ${PRE_PUSH_HOOK_NAME} hook: ${hookPath}`);
    }
    writePrePushHook(hookPath);
    return hookSuccess(`installed ${PRE_PUSH_HOOK_NAME} hook: ${hookPath}`);
  } catch (error) {
    return hookFailure(
      `could not install the ${PRE_PUSH_HOOK_NAME} hook: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/** A child-process diagnostic must not turn one hook warning into many lines. */
const oneLine = (detail: string): string => detail.replace(/\s+/g, ' ').trim();

/**
 * The transport budget is ours, so its expiry has to be reported as ours.
 *
 * `spawnSync` reports a timeout as `spawnSync git ETIMEDOUT`, and that reached
 * operators unchanged: it names the call that returned and not the thing that
 * happened, so it reads as git failing rather than as this hook declining to
 * wait. Measured while pushing a release tag — the line said `ETIMEDOUT` and
 * the records were fine, needing only `commitlore sync`, which the rest of the
 * sentence already said. #746 is the same shape in the commit-msg hook: a
 * message accurate about the mechanism and wrong about the situation costs
 * more than a vague one, because it sends somebody looking.
 *
 * The budget is interpolated rather than written out, so the sentence cannot
 * drift from `PRE_PUSH_NOTES_SYNC_TIMEOUT_MS`.
 */
const saidWhy = (detail: string): string =>
  /\bETIMEDOUT\b/.test(detail)
    ? `the ${PRE_PUSH_NOTES_SYNC_TIMEOUT_MS / 1000}s this hook waits for the remote ran out`
    : oneLine(detail);

/**
 * One fail-open line per unsuccessful remote. Successful sync stays quiet.
 *
 * The line has to answer what the operator will actually ask, which is not
 * "what went wrong" but "where are my records now, and do I have to do
 * something" (#632). It also has to answer it differently for the two
 * outcomes, because their answers are opposite: a failed push is transient and
 * the next push retries it — `syncNotes` keeps no state and recompares the
 * refs every time — while a divergence is two mirrors neither of which
 * fast-forwards, and retrying that forever changes nothing.
 *
 * Saying only "branch push continues" reported the half the operator could
 * already see and left the half they were asking about unstated.
 */
export const describeSync = (results: readonly SyncResult[]): string[] =>
  results
    .filter((result) => result.outcome === 'failed' || result.outcome === 'diverged')
    .map((result) =>
      result.outcome === 'diverged'
        ? `commitlore: notes mirror (${result.remote}) diverged: ${oneLine(result.detail)}. The branch was pushed. Your records and the remote's both exist and neither one fast-forwards, so a later push will not settle it — run "commitlore sync" to merge them.`
        : `commitlore: notes mirror (${result.remote}) failed: ${saidWhy(result.detail)}. The branch was pushed; the records for these commits are still only local. The next push retries this automatically, or run "commitlore sync" to send them now.`,
    );

/**
 * Git itself must not prompt, and the default SSH command refuses interactive
 * authentication. A caller's SSH wrapper is preserved because it may carry
 * required corporate routing or key-selection settings.
 */
const nonInteractiveGitEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
});

export const register = (program: Command): void => {
  program
    .command(PRE_PUSH_HOOK_NAME)
    .argument('[remote]', 'the remote git is pushing to')
    .argument('[url]', 'its URL, as git passes it')
    .description('internal hook command: publish the notes mirror alongside a push')
    .action((remote?: string) => {
      try {
        const results = syncNotes({
          ...(remote === undefined || remote === '' ? {} : { remotes: [remote] }),
          transport: {
            env: nonInteractiveGitEnv(),
            timeout: PRE_PUSH_NOTES_SYNC_TIMEOUT_MS,
          },
        });
        for (const line of describeSync(results)) process.stderr.write(`${line}\n`);
      } catch (error: unknown) {
        // A push must never fail because the mirror could not be published —
        // and the line must still say where the records ended up, for the same
        // reason `describeSync` does (#632).
        process.stderr.write(
          `commitlore: notes mirror failed: ${saidWhy(error instanceof Error ? error.message : String(error))}. The branch was pushed; the records for these commits are still only local. The next push retries this automatically, or run "commitlore sync" to send them now.\n`,
        );
      }
    });
};
