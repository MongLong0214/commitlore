/**
 * `commitlore doctor` — is this repository able to carry and share records?
 *
 * The mirror in `refs/notes/commitlore` (ADR-0004) only reaches a teammate if
 * their clone is configured to fetch it, which git does not do by default. A
 * clone that skips that step reads an empty mirror and reports "no record" for
 * commits that have one — a silent wrong answer, the most expensive kind here.
 * doctor exists to turn that into a visible, fixable finding.
 *
 * Two boundaries are deliberate:
 *
 * - `--fix` only writes reversible local config (`remote.<name>.fetch`).
 *   Pushing notes is a network write to a shared ref, so doctor prints the
 *   command and lets a human run it.
 * - The commit-msg hook is *reported*, never installed. `commitlore hooks
 *   install` (T-202) owns that file; doctor only reads it.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Command } from 'commander';

import { execGit } from '../core/git.js';
import { NOTES_REF, NOTES_REFSPEC } from '../core/notes.js';
import { parseCommitMessage } from '../core/trailers.js';
import { HOOK_MARKER } from '../hooks/commit-msg.js';

/**
 * `skipped` is a check that exists but has nothing to inspect yet — it is not
 * a pass. `fail` means the tool cannot work correctly here; `warn` means the
 * setup is incomplete but nothing gives a wrong answer locally.
 */
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped';

export interface DoctorCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  /** What makes this check `ok`, or `null` when nothing needs doing. */
  fix: string | null;
  /** Whether this run's `--fix` changed something for this check. */
  fixed: boolean;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** 0 unless some check is `fail` — warnings do not fail the command. */
  exitCode: number;
}

export interface DoctorOptions {
  cwd?: string;
  /** Apply the reversible local config fixes. */
  fix?: boolean;
}

/** Probe message for the git capability check — one trailer of each shape. */
const PROBE_MESSAGE = 'commitlore doctor probe\n\nLimit: probe\nBlast: local\n';

const gitOptions = (opts: DoctorOptions) => (opts.cwd === undefined ? {} : { cwd: opts.cwd });

const check = (
  id: string,
  title: string,
  status: CheckStatus,
  detail: string,
  fix: string | null = null,
  fixed = false,
): DoctorCheck => ({ id, title, status, detail, fix, fixed });

const listRemotes = (opts: DoctorOptions): string[] => {
  const result = execGit(['remote'], gitOptions(opts));
  if (result.code !== 0) return [];
  return result.stdout.split('\n').filter((line) => line.length > 0);
};

const fetchRefspecs = (remote: string, opts: DoctorOptions): string[] => {
  // Exit 1 means "key not set", which is an answer, not a failure.
  const result = execGit(['config', '--get-all', `remote.${remote}.fetch`], gitOptions(opts));
  if (result.code !== 0) return [];
  return result.stdout.split('\n').filter((line) => line.length > 0);
};

/**
 * Whether a configured refspec lands the mirror where we read it. The exact
 * `NOTES_REFSPEC` is what `--fix` writes, but a repository that already fetches
 * `refs/notes/*` (or all of `refs/*`) is equally configured and must not be
 * told to add a redundant line.
 */
const coversNotes = (refspec: string): boolean => {
  const [, destination = ''] = refspec.replace(/^\+/, '').split(':');
  if (destination === NOTES_REF) return true;
  return destination.endsWith('/*') && NOTES_REF.startsWith(destination.slice(0, -1));
};

const checkRefspec = (opts: DoctorOptions): DoctorCheck => {
  const title = 'notes fetch refspec';
  const remotes = listRemotes(opts);

  if (remotes.length === 0) {
    return check(
      'notes-refspec',
      title,
      'warn',
      'no remote is configured, so records cannot be shared with anyone',
      'add a remote, then rerun: commitlore doctor --fix',
    );
  }

  let missing = remotes.filter(
    (remote) => !fetchRefspecs(remote, opts).some(coversNotes),
  );
  let fixed = false;

  if (missing.length > 0 && opts.fix === true) {
    const applied: string[] = [];
    for (const remote of missing) {
      const result = execGit(
        ['config', '--add', `remote.${remote}.fetch`, NOTES_REFSPEC],
        gitOptions(opts),
      );
      if (result.code === 0) applied.push(remote);
    }
    fixed = applied.length > 0;
    missing = missing.filter((remote) => !applied.includes(remote));
  }

  if (missing.length > 0) {
    return check(
      'notes-refspec',
      title,
      'warn',
      `${missing.join(', ')} does not fetch ${NOTES_REF}, so records pushed by others stay invisible here`,
      missing.map((remote) => `git config --add remote.${remote}.fetch '${NOTES_REFSPEC}'`).join('\n'),
    );
  }

  return check(
    'notes-refspec',
    title,
    'ok',
    `${remotes.join(', ')} ${remotes.length === 1 ? 'fetches' : 'fetch'} ${NOTES_REF}`,
    null,
    fixed,
  );
};

const hasLocalNotes = (opts: DoctorOptions): boolean =>
  execGit(['rev-parse', '--verify', '--quiet', NOTES_REF], gitOptions(opts)).code === 0;

/**
 * Pushing is never automatic: `git push` writes to a ref other people read,
 * which is not something a diagnostic command gets to decide.
 */
const checkPush = (opts: DoctorOptions): DoctorCheck => {
  const title = 'notes push';
  const remotes = listRemotes(opts);
  const remote = remotes[0] ?? 'origin';
  const command = `git push ${remote} ${NOTES_REF}`;

  if (!hasLocalNotes(opts)) {
    return check(
      'notes-push',
      title,
      'ok',
      `no local mirror yet — nothing to push (${command}, once there is)`,
    );
  }

  return check(
    'notes-push',
    title,
    'warn',
    `this clone has local records in ${NOTES_REF}; no command pushes them for you`,
    command,
  );
};

/**
 * Installation belongs to `commitlore hooks install` (T-202). This reads.
 *
 * The marker is imported from the stub rather than restated, so that doctor
 * can never disagree with the installer about what "installed" means.
 */
const checkHook = (opts: DoctorOptions): DoctorCheck => {
  const title = 'commit-msg hook';
  const id = 'commit-msg-hook';
  const install = 'commitlore hooks install';

  // --git-path, not a hardcoded .git/: worktrees and submodules keep hooks
  // somewhere else entirely.
  const located = execGit(['rev-parse', '--git-path', 'hooks/commit-msg'], gitOptions(opts));
  if (located.code !== 0) {
    return check(id, title, 'warn', 'not inside a git repository', install);
  }

  const path = resolve(opts.cwd ?? process.cwd(), located.stdout.trim());
  if (!existsSync(path)) {
    return check(id, title, 'warn', `no commit-msg hook at ${path}`, install);
  }

  const contents = readFileSync(path, 'utf8');
  if (!contents.includes(HOOK_MARKER)) {
    return check(
      id,
      title,
      'warn',
      `a commit-msg hook exists at ${path} but does not invoke commitlore`,
      install,
    );
  }

  return check(id, title, 'ok', `installed at ${path}`);
};

/**
 * Runs the real parse path once. Trailer boundaries are git's to decide
 * (SPEC §2), so a git that cannot do this makes every other answer suspect —
 * the one condition that fails the command.
 *
 * The probe runs in the process's own directory rather than `cwd`: it tests
 * the git binary on `PATH` and this codebase's parse path, neither of which is
 * a property of the repository being inspected.
 */
const checkGit = (opts: DoctorOptions): DoctorCheck => {
  const title = 'git interpret-trailers';
  const id = 'git-trailers';
  const version = execGit(['--version'], gitOptions(opts)).stdout.trim();
  const upgrade = 'install a git that supports interpret-trailers --parse (git >= 2.9)';

  let trailers;
  try {
    trailers = parseCommitMessage(PROBE_MESSAGE);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return check(id, title, 'fail', `${version || 'git'} could not parse a probe: ${reason}`, upgrade);
  }

  const parsed = trailers.map((trailer) => `${trailer.key}: ${trailer.value}`).join(', ');
  if (parsed !== 'Limit: probe, Blast: local') {
    return check(id, title, 'fail', `${version} parsed the probe as [${parsed}]`, upgrade);
  }

  return check(id, title, 'ok', `${version} parses trailers as the spec expects`);
};

/** Placeholder until the index lands (T-203); reported, never guessed at. */
const checkIndex = (): DoctorCheck =>
  check('index-health', 'index health', 'skipped', 'the index is not implemented yet (T-203)');

export const runDoctor = (opts: DoctorOptions = {}): DoctorReport => {
  const checks = [checkRefspec(opts), checkPush(opts), checkHook(opts), checkGit(opts), checkIndex()];
  return {
    checks,
    exitCode: checks.some((entry) => entry.status === 'fail') ? 1 : 0,
  };
};

const STATUS_WIDTH = 8;

export const formatReport = (report: DoctorReport): string => {
  const lines = report.checks.flatMap((entry) => {
    const head = `${entry.status.padEnd(STATUS_WIDTH)}${entry.title} — ${entry.detail}`;
    const fixed = entry.fixed ? [`${' '.repeat(STATUS_WIDTH)}fixed by --fix`] : [];
    const fix =
      entry.fix === null
        ? []
        : entry.fix.split('\n').map((line) => `${' '.repeat(STATUS_WIDTH)}fix: ${line}`);
    return [head, ...fixed, ...fix];
  });
  return `${lines.join('\n')}\n`;
};

export const register = (program: Command): void => {
  program
    .command('doctor')
    .description('check that this repository can carry and share CommitLore records')
    .option('--fix', 'apply the reversible local config fixes (notes fetch refspec)')
    .option('--json', 'emit the report as JSON')
    .action((options: { fix?: boolean; json?: boolean }) => {
      const report = runDoctor({ fix: options.fix === true });
      process.stdout.write(
        options.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report),
      );
      process.exitCode = report.exitCode;
    });
};
