/**
 * The `notes-push` doctor check.
 *
 * It owns the shared-reference observation because pushing is deliberately a
 * human action; no other check may perform or depend on that write.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { NOTES_REF, listRemotes } from '../../../core/notes.js';
import { check, gitOptions, streamEvidence, type DoctorCheck, type DoctorContext } from '../model.js';

/**
 * Pushing is never automatic: `git push` writes to a ref other people read,
 * which is not something a diagnostic command gets to decide.
 */
export const checkPush = (ctx: DoctorContext): DoctorCheck => {
  const { opts, git } = ctx;
  const title = 'notes push';
  const remotes = listRemotes(opts);
  const remote = remotes[0] ?? 'origin';
  const command = `git push ${remote} ${NOTES_REF}`;
  const local = git(['rev-parse', '--verify', '--quiet', NOTES_REF], gitOptions(opts));
  const localEvidence = {
    remote,
    local_sha: local.code === 0 ? local.stdout.trim() || 'unknown' : 'none',
  };

  if (local.code !== 0) {
    return check(
      'notes-push', 'transport',
      title,
      'ok',
      `no local mirror yet — nothing to push (${command}, once there is)`,
      null,
      false,
      undefined,
      { evidence: { ...localEvidence, remote_sha: 'not_queried' } },
    );
  }

  const advertised = git(['ls-remote', remote, NOTES_REF], gitOptions(opts));
  if (advertised.code !== 0) {
    return check(
      'notes-push', 'transport',
      title,
      'warn',
      `could not verify (${remote}: ${advertised.stderr.trim().split('\n')[0] ?? 'git ls-remote failed'})`,
      command,
      false,
      undefined,
      {
        evidence: {
          ...localEvidence,
          ls_remote_exit_code: String(advertised.code),
          ...streamEvidence('ls_remote_stderr', advertised.stderr),
        },
      },
    );
  }
  const remoteSha = advertised.stdout.split(/\s/)[0] ?? '';
  if (remoteSha === local.stdout.trim()) {
    return check(
      'notes-push',
      'transport',
      title,
      'ok',
      `${remote} has the current ${NOTES_REF}`,
      null,
      false,
      undefined,
      { evidence: { ...localEvidence, remote_sha: remoteSha || 'none' } },
    );
  }

  /*
   * Which way the two refs differ, not merely that they do.
   *
   * The row compared shas and called any difference 'local records nobody pushes'.
   * A clone that is *behind* -- its mirror an ancestor of the remote's -- has
   * nothing to push and was told to push anyway; following that is how #890's
   * duplicate note gets written. And `no command pushes them for you` stopped
   * being true when the pre-push hook shipped: it mirrors the ref on every push
   * of the branch.
   */
  const behind =
    remoteSha !== '' &&
    git(['merge-base', '--is-ancestor', local.stdout.trim(), remoteSha], gitOptions(opts)).code === 0;
  if (behind) {
    return check(
      'notes-push',
      'transport',
      title,
      'ok',
      `${remote} carries everything this clone has in ${NOTES_REF}, and more — this checkout is ` +
        `behind, which a fetch settles. Nothing here is waiting to be pushed`,
      null,
      false,
      undefined,
      { evidence: { ...localEvidence, remote_sha: remoteSha, direction: 'behind' } },
    );
  }

  const prePush = existsSync(
    resolve(
      opts.cwd ?? process.cwd(),
      git(['rev-parse', '--git-path', 'hooks/pre-push'], gitOptions(opts)).stdout.trim(),
    ),
  );
  return check(
    'notes-push', 'transport',
    title,
    'warn',
    `this clone has records in ${NOTES_REF} that ${remote} does not` +
      (prePush
        ? `. The installed pre-push hook mirrors them the next time you push this branch, so this ` +
          `usually settles itself; the command below does it now`
        : `, and with no pre-push hook installed nothing sends them for you`),
    command,
    false,
    undefined,
    { evidence: { ...localEvidence, remote_sha: remoteSha || 'none' } },
  );
};
