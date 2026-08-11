/**
 * The `notes-refspec` doctor check.
 *
 * It owns the reversible fetch-configuration diagnosis and fix because no
 * sibling check may alter transport configuration on its behalf.
 */

import {
  NOTES_REF,
  NOTES_REFSPEC,
  coversNotes,
  forcesNotes,
  listRemotes,
  fetchRefspecs,
  notesAbsenceEvidenceKey,
} from '../../../core/notes.js';
import { check, evidenceKey, gitOptions, type DoctorCheck, type DoctorContext } from '../model.js';

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

const firstLine = (output: string): string => output.trim().split('\n')[0] ?? '';

/** A stale absence observation must never survive an unsuccessful verification. */
const clearAbsenceEvidence = (remote: string, ctx: DoctorContext): boolean =>
  ctx.git(['config', '--local', '--unset-all', notesAbsenceEvidenceKey(remote)], gitOptions(ctx.opts)).code === 0;

/**
 * Store precisely what made an absent-mirror answer safe: this remote name was
 * checked while it resolved to this URL, and it advertised no notes ref.
 */
const recordAbsenceEvidence = (remote: string, ctx: DoctorContext): boolean => {
  const url = ctx.git(['config', '--get', `remote.${remote}.url`], gitOptions(ctx.opts));
  if (url.code !== 0 || url.stdout.trim() === '') return false;

  const key = notesAbsenceEvidenceKey(remote);
  const current = ctx.git(['config', '--local', '--get', key], gitOptions(ctx.opts));
  if (current.code === 0 && current.stdout.trim() === url.stdout.trim()) return false;

  return ctx.git(['config', '--local', '--replace-all', key, url.stdout.trim()], gitOptions(ctx.opts)).code === 0;
};

export const checkRefspec = (ctx: DoctorContext): DoctorCheck => {
  const { opts, git } = ctx;
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
        const replaced = git(
          ['config', '--replace-all', key, NOTES_REFSPEC, EXACT_NOTES_REFSPEC_PATTERN],
          gitOptions(opts),
        );
        fixed = replaced.code === 0 || fixed;
      } else if (configured.some(forcesNotes)) {
        // #417: a forced refspec overwrites the local mirror on every fetch.
        // Each forced entry is replaced individually rather than the whole key
        // rewritten, so a remote's other refspecs survive untouched.
        for (const entry of configured.filter(forcesNotes)) {
          const replaced = git(
            ['config', '--replace-all', key, NOTES_REFSPEC, `^${escapeConfigValuePattern(entry)}$`],
            gitOptions(opts),
          );
          fixed = replaced.code === 0 || fixed;
        }
      } else if (!configured.some(coversNotes)) {
        const added = git(['config', '--add', key, NOTES_REFSPEC], gitOptions(opts));
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
    .map((remote) => ({ remote, result: git(['fetch', '--dry-run', remote], gitOptions(opts)) }))
    .filter(({ result }) => result.code !== 0);
  if (failed.length > 0) {
    // A previous observation says nothing about a remote that cannot be
    // verified now. `--fix` removes it so the read path returns to fail-closed.
    if (opts.fix === true) failed.forEach(({ remote }) => clearAbsenceEvidence(remote, ctx));
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

  const local = git(['rev-parse', '--verify', '--quiet', NOTES_REF], gitOptions(opts));
  if (local.code === 0) {
    return check(
      'notes-refspec', 'transport',
      title,
      'ok',
      `git fetch succeeds for ${remotes.join(', ')} and covers ${NOTES_REF}`,
      null,
      fixed,
      undefined,
      { evidence: { ...remoteEvidence, local_sha: local.stdout.trim() || 'unknown' } },
    );
  }

  const advertised = remotes.map((remote) => ({
    remote,
    result: git(['ls-remote', remote, NOTES_REF], gitOptions(opts)),
  }));
  const unavailable = advertised.filter(({ result }) => result.code !== 0);
  if (unavailable.length > 0) {
    if (opts.fix === true) unavailable.forEach(({ remote }) => clearAbsenceEvidence(remote, ctx));
    return check(
      'notes-refspec', 'transport',
      title,
      'warn',
      `could not verify whether ${NOTES_REF} exists upstream (${unavailable
        .map(({ remote, result }) => `${remote}: ${firstLine(result.stderr) || 'git ls-remote failed'}`)
        .join('; ')})`,
      unavailable.map(({ remote }) => `git fetch ${remote}`).join('\n'),
      fixed,
      undefined,
      {
        evidence: {
          ...remoteEvidence,
          ...Object.fromEntries(
            unavailable.map(({ remote, result }) => [
              `ls_remote_exit_code_${evidenceKey(remote)}`,
              String(result.code),
            ]),
          ),
        },
      },
    );
  }

  const withNotes = advertised.filter(({ result }) => result.stdout.trim() !== '');
  if (withNotes.length > 0) {
    if (opts.fix === true) withNotes.forEach(({ remote }) => clearAbsenceEvidence(remote, ctx));
    return check(
      'notes-refspec', 'transport',
      title,
      'warn',
      `${withNotes.map(({ remote }) => remote).join(', ')} advertises ${NOTES_REF}, but it is not fetched here`,
      withNotes.map(({ remote }) => `git fetch ${remote}`).join('\n'),
      fixed,
      undefined,
      {
        evidence: {
          ...remoteEvidence,
          ...Object.fromEntries(withNotes.map(({ remote, result }) => [
            `remote_sha_${evidenceKey(remote)}`,
            result.stdout.trim().split(/\s+/)[0] ?? 'unknown',
          ])),
        },
      },
    );
  }

  let recorded = false;
  if (opts.fix === true) {
    recorded = remotes.map((remote) => recordAbsenceEvidence(remote, ctx)).some(Boolean);
    fixed = fixed || recorded;
  }

  // The remote probe found no mirror. Only `--fix` stores that fact for query
  // routes, which must remain read-only and must not perform this probe.
  return check(
    'notes-refspec', 'transport',
    title,
    'ok',
    opts.fix === true
      ? `${remotes.join(', ')} advertises no ${NOTES_REF}; there is nothing to fetch`
      : `${remotes.join(', ')} advertises no ${NOTES_REF}; run commitlore doctor --fix to record that for queries`,
    opts.fix === true ? null : 'commitlore doctor --fix',
    fixed,
    undefined,
    { evidence: { ...remoteEvidence, remote_advertises: 'false' } },
  );
};
