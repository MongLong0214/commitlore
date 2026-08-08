/**
 * The `notes-push` doctor check.
 *
 * It owns the shared-reference observation because pushing is deliberately a
 * human action; no other check may perform or depend on that write.
 */

import { execGit } from '../../../core/git.js';
import { NOTES_REF, listRemotes } from '../../../core/notes.js';
import { check, gitOptions, streamEvidence, type DoctorCheck, type DoctorOptions } from '../model.js';

/**
 * Pushing is never automatic: `git push` writes to a ref other people read,
 * which is not something a diagnostic command gets to decide.
 */
export const checkPush = (opts: DoctorOptions): DoctorCheck => {
  const title = 'notes push';
  const remotes = listRemotes(opts);
  const remote = remotes[0] ?? 'origin';
  const command = `git push ${remote} ${NOTES_REF}`;
  const local = execGit(['rev-parse', '--verify', '--quiet', NOTES_REF], gitOptions(opts));
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

  const advertised = execGit(['ls-remote', remote, NOTES_REF], gitOptions(opts));
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

  return check(
    'notes-push', 'transport',
    title,
    'warn',
    `this clone has local records in ${NOTES_REF}; no command pushes them for you`,
    command,
    false,
    undefined,
    { evidence: { ...localEvidence, remote_sha: remoteSha || 'none' } },
  );
};
