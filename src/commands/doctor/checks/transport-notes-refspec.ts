/**
 * The `notes-refspec` doctor check.
 *
 * It owns the reversible fetch-configuration diagnosis and fix because no
 * sibling check may alter transport configuration on its behalf.
 */

import { execGit } from '../../../core/git.js';
import { NOTES_REF, NOTES_REFSPEC, coversNotes, forcesNotes, listRemotes, fetchRefspecs } from '../../../core/notes.js';
import { check, evidenceKey, gitOptions, type DoctorCheck, type DoctorOptions } from '../model.js';

const EXACT_NOTES_REFSPEC = `+${NOTES_REF}:${NOTES_REF}`;
const EXACT_NOTES_REFSPEC_PATTERN = `^\\${EXACT_NOTES_REFSPEC}$`;

/**
 * `git config --replace-all` takes a **regular expression** for the value it
 * replaces, so a refspec passed through raw is not a literal: `refs/notes/*`
 * reads as "`refs/notes` then zero or more `/`", which does not match the
 * asterisk actually in the value. A pattern that matches nothing does not fail
 * — `--replace-all` appends instead, leaving the entry it was meant to remove
 * in place beside a new one.
 */
const escapeConfigValuePattern = (value: string): string =>
  value.replace(/[\\.*+?[\]^$(){}|]/g, (character) => `\\${character}`);

export const checkRefspec = (opts: DoctorOptions): DoctorCheck => {
  const title = 'notes fetch refspec';
  const remotes = listRemotes(opts);
  const remoteEvidence = { remotes: remotes.join(', ') || 'none' };

  if (remotes.length === 0) {
    return check(
      'notes-refspec', 'transport',
      title,
      'warn',
      'no remote is configured, so records cannot be shared with anyone',
      'add a remote, then rerun: commitlore doctor --fix',
      false,
      false,
      { evidence: remoteEvidence },
    );
  }

  let missing = remotes.filter((remote) => !fetchRefspecs(remote, opts).some(coversNotes));
  let forced = remotes.filter((remote) => fetchRefspecs(remote, opts).some(forcesNotes));
  let fixed = false;

  if (opts.fix === true) {
    for (const remote of remotes) {
      const key = `remote.${remote}.fetch`;
      const configured = fetchRefspecs(remote, opts);
      if (configured.includes(EXACT_NOTES_REFSPEC)) {
        const replaced = execGit(
          ['config', '--replace-all', key, NOTES_REFSPEC, EXACT_NOTES_REFSPEC_PATTERN],
          gitOptions(opts),
        );
        fixed = replaced.code === 0 || fixed;
      } else if (configured.some(forcesNotes)) {
        // #417: a forced refspec overwrites the local mirror on every fetch.
        // Each forced entry is replaced individually rather than the whole key
        // rewritten, so a remote's other refspecs survive untouched.
        for (const entry of configured.filter(forcesNotes)) {
          const replaced = execGit(
            ['config', '--replace-all', key, NOTES_REFSPEC, `^${escapeConfigValuePattern(entry)}$`],
            gitOptions(opts),
          );
          fixed = replaced.code === 0 || fixed;
        }
      } else if (!configured.some(coversNotes)) {
        const added = execGit(['config', '--add', key, NOTES_REFSPEC], gitOptions(opts));
        fixed = added.code === 0 || fixed;
      }
    }
    missing = remotes.filter((remote) => !fetchRefspecs(remote, opts).some(coversNotes));
    forced = remotes.filter((remote) => fetchRefspecs(remote, opts).some(forcesNotes));
  }

  if (forced.length > 0) {
    return check(
      'notes-refspec', 'transport',
      title,
      'warn',
      `${forced.join(', ')} fetches ${NOTES_REF} with a forced refspec, so an ordinary git fetch ` +
        'overwrites this clone\'s mirror — a record written here and not yet pushed is destroyed silently',
      forced
        .map((remote) => `git config --replace-all remote.${remote}.fetch '${NOTES_REFSPEC}' '^\\+refs/notes/'`)
        .join('\n'),
      fixed,
      undefined,
      { evidence: { ...remoteEvidence, forced: forced.join(', ') } },
    );
  }

  if (missing.length > 0) {
    return check(
      'notes-refspec', 'transport',
      title,
      'warn',
      `${missing.join(', ')} does not fetch ${NOTES_REF}, so records pushed by others stay invisible here`,
      missing.map((remote) => `git config --add remote.${remote}.fetch '${NOTES_REFSPEC}'`).join('\n'),
      false,
      undefined,
      { evidence: { ...remoteEvidence, missing: missing.join(', ') } },
    );
  }

  const failed = remotes
    .map((remote) => ({ remote, result: execGit(['fetch', '--dry-run', remote], gitOptions(opts)) }))
    .filter(({ result }) => result.code !== 0);
  if (failed.length > 0) {
    return check(
      'notes-refspec', 'transport',
      title,
      'warn',
      `could not verify (${failed
        .map(({ remote, result }) => `${remote}: ${result.stderr.trim().split('\n')[0] ?? 'git fetch failed'}`)
        .join('; ')})`,
      failed.map(({ remote }) => `git fetch ${remote}`).join('\n'),
      fixed,
      undefined,
      {
        evidence: {
          ...remoteEvidence,
          ...Object.fromEntries(
            failed.map(({ remote, result }) => [
              `fetch_exit_code_${evidenceKey(remote)}`,
              String(result.code),
            ]),
          ),
        },
      },
    );
  }

  // A refspec written by `--fix` has not been fetched through yet, and this
  // check is the last thing the operator reads before believing the mirror is
  // sorted. Without the second sentence `ok` plus `fixed by --fix` reads as
  // "repaired", while every query still answers from a mirror that was never
  // retrieved -- the configuration is right and the records are still missing.
  return check(
    'notes-refspec', 'transport',
    title,
    'ok',
    fixed
      ? `${NOTES_REF} is now covered for ${remotes.join(', ')} — nothing has been fetched through it yet`
      : `git fetch succeeds for ${remotes.join(', ')} and covers ${NOTES_REF}`,
    fixed ? `git fetch ${remotes[0] ?? 'origin'}` : null,
    fixed,
    undefined,
    { evidence: remoteEvidence },
  );
};
