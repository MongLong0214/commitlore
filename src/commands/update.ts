/**
 * `commitlore upgrade` (T-1603, #742). This ticket ships the read-only half.
 *
 * The file is `update.ts` and the command is `upgrade`; F16 owns both names
 * and they deliberately differ. The verb changed from `update` after a review
 * round: `brew update` fetches an index, `npm update` updates a project's
 * dependencies, and `rustup update` updates toolchains -- two of the three
 * precedents for calling this `update` do not replace the tool that runs them.
 * `deno upgrade` and `bun upgrade` do, and they are called upgrade.
 *
 * **The acting form is T-1606's and is not reachable from here.** The
 * read-only half ships first so the reporting is trustworthy before anything
 * acts on it, and a test asserts this command starts no process other than
 * the `git ls-remote` the check owns. ADR-0037 is enforced rather than
 * described: a comment saying the CLI does not replace itself is not a guard.
 *
 * **Exit 0 whether or not an update exists.** A version query has no violation
 * to report -- `commitlore auto` settled the shape ("the answer is not a
 * finding") and `stale` exits 0 even when it finds something. Scripts branch
 * on `--json`. Non-zero stays reserved for a check that could not run at all.
 *
 * **It answers inside CI and off a terminal.** That is not an oversight in the
 * suppression rules: the notice has context gates and this command must not
 * share them, or the one scriptable form would be silent in the one place
 * scripts run.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import { latestRelease, sourceUrl, type CheckOutcome } from '../core/latest-release.js';
import { packageVersion, readInstalledFile } from '../core/paths.js';
import { isNewerRelease } from '../core/release-version.js';

/**
 * The install command, read from the README rather than restated.
 *
 * The two drifting apart is a known shape here (#727), and a literal copy in
 * this file is exactly how that starts. The README pins a version; an upgrade
 * names the tag it is upgrading to, so the shape is taken and the tag
 * replaced.
 */
export const installCommand = (tag: string, platform: string = process.platform): string => {
  const readme = readInstalledFile('README.md');
  const script = platform === 'win32' ? 'install.ps1' : 'install.sh';
  const line = readme
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.includes(script) && (l.startsWith('curl ') || l.startsWith('& (')));
  if (line === undefined) return '';
  // Naming a command that cannot work is the failure `gh` sidesteps by
  // printing a URL. We only earn the more helpful form by getting it right.
  return line.replace(/v\d+\.\d+\.\d+/g, tag);
};

export interface UpgradeReport {
  readonly current: string;
  readonly latest: string | null;
  readonly updateAvailable: boolean;
  readonly command: string;
  readonly source: string;
  readonly checkedAt: string;
  /** Present when there is no answer, so "unknown" never reads as "current". */
  readonly unknown?: string;
}

const describe = (outcome: CheckOutcome): string => {
  switch (outcome.kind) {
    case 'disabled':
      return `checking is disabled by ${outcome.by}`;
    case 'unreachable':
      return `the release list could not be reached (${outcome.detail})`;
    case 'refused':
      return `the remote declined the request (${outcome.detail})`;
    case 'no-tag-matched':
      return `no release tag was found (${outcome.detail})`;
    case 'resolved':
      return '';
  }
};

export const buildReport = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<UpgradeReport> => {
  const current = packageVersion();
  const { outcome, checkedAt } = await latestRelease({ env });
  const latest = outcome.kind === 'resolved' ? outcome.tag : null;
  const unknown = describe(outcome);
  return {
    current,
    latest,
    // "We could not look" is not "you are up to date", and only one of them is
    // true. `updateAvailable` stays false either way; `unknown` is what
    // separates them.
    updateAvailable: latest !== null && isNewerRelease(latest, current),
    command: installCommand(latest ?? `v${current}`),
    source: sourceUrl(env),
    checkedAt: new Date(checkedAt).toISOString(),
    ...(unknown === '' ? {} : { unknown }),
  };
};

const render = (report: UpgradeReport): string => {
  const lines = [`installed  ${report.current}`];
  if (report.unknown !== undefined) {
    lines.push(`latest     unknown — ${report.unknown}`);
    return `${lines.join('\n')}\n`;
  }
  lines.push(`latest     ${report.latest ?? 'unknown'}`);
  lines.push(
    report.updateAvailable
      ? `\na newer release is available. To upgrade:\n\n  ${report.command}`
      : '\nthis is the newest release.',
  );
  return `${lines.join('\n')}\n`;
};

export const register = (program: Command): void => {
  program
    .command('upgrade')
    .description('report the installed and newest CommitLore release')
    .option('--check', 'report only; make no change (the default in this build)')
    .option('--json', 'the same answer as JSON')
    .option('--force', 'act even when the newest release is not newer than this one')
    .addHelpText(
      'after',
      '\nExit codes: 0 the check ran, whether or not a newer release exists (SPEC §10).',
    )
    .action(async (options: { json?: boolean; check?: boolean; force?: boolean }) => {
      const report = await buildReport();
      const readOnly = options.json === true || options.check === true;
      if (readOnly) {
        // The read-only form stays read-only, asserted separately from the
        // acting form: these two must not be one code path with a flag.
        process.stdout.write(
          options.json === true ? `${JSON.stringify(report, null, 2)}\n` : render(report),
        );
        return;
      }

      process.stdout.write(render(report));
      if (report.latest === null) return;

      // A typo must not silently downgrade a machine.
      if (!report.updateAvailable && options.force !== true) return;

      const blocked = process.env['COMMITLORE_NO_AUTO_UPDATE'];
      if (blocked !== undefined && blocked !== '') {
        // Stops the action and not the report: it says what it would have done
        // and exits 0, because declining automatic action is not an error.
        process.stdout.write(
          `\nCOMMITLORE_NO_AUTO_UPDATE is set, so nothing was changed. This would have run:\n\n  ${report.command}\n`,
        );
        return;
      }

      const outcome = performUpgrade(report.latest, {
        env: process.env,
        platform: process.platform,
        runInstaller: (script, tag) =>
          spawnSync(process.platform === 'win32' ? 'powershell' : 'sh', [script, tag], {
            stdio: 'inherit',
          }),
      });
      for (const line of outcome.lines) process.stdout.write(`${line}\n`);
      if (outcome.code !== 0) process.exitCode = outcome.code;
    });
};

// ---------------------------------------------------------------------------
// The upgrade itself (T-1606, ADR-0038)
// ---------------------------------------------------------------------------

/** Matches `install.sh:448`. */
export const dataRoot = (env: NodeJS.ProcessEnv = process.env): string => {
  const xdg = env['XDG_DATA_HOME'];
  const base = xdg !== undefined && xdg !== '' ? xdg : join(env['HOME'] ?? homedir(), '.local', 'share');
  return join(base, 'commitlore');
};

const installerName = (platform: string): string =>
  platform === 'win32' ? 'install.ps1' : 'install.sh';

/**
 * What `current` points at, or `null`.
 *
 * On Windows `install.ps1` writes no `current` symlink at all -- activation is
 * a `.cmd` shim whose last line names the versioned `dist\commitlore.mjs`. So
 * the same question is asked of the shim's contents there. ADR-0038 calls this
 * "expressed the way that platform allows"; reading a link that is never
 * created would report every Windows upgrade as failed.
 */
export const resolvedCurrent = (
  root: string,
  platform: string = process.platform,
): string | null => {
  try {
    if (platform === 'win32') {
      const shim = join(root, 'bin', 'commitlore.cmd');
      const text = readFileSync(shim, 'utf8');
      const match = /([^\s"']*[/\\]v\d+\.\d+\.\d+)[/\\]/.exec(text);
      return match?.[1] ?? null;
    }
    return realpathSync(join(root, 'current'));
  } catch {
    return null;
  }
};

/** Step 2 and step 4: *is it the target*, not *did it move*. */
export const pointsAtTarget = (root: string, tag: string, platform?: string): boolean => {
  const resolved = resolvedCurrent(root, platform);
  if (resolved === null) return false;
  // `realpath` may differ from the literal path by symlinked parents, so the
  // comparison is on the final segment the installer names.
  return resolved.split(/[/\\]/).pop() === tag;
};

export interface UpgradeOutcome {
  readonly code: 0 | 1 | 2;
  readonly lines: readonly string[];
  /** Which installers were invoked, in order. Asserted by a test. */
  readonly invoked: readonly string[];
}

export interface UpgradeDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: string;
  /** Runs one installer. Injected so a test can supply a #735 fixture. */
  readonly runInstaller: (script: string, tag: string) => { status: number | null };
}

/**
 * ADR-0038's four steps.
 *
 * Step 1 runs the installer already on disk, which may be old. Its clone is
 * sound regardless: `install.sh` takes a version argument and clones that tag
 * directly, never reading `current`. Step 3 exists for exactly one named
 * defect -- the #735 move that reported success while leaving `current`
 * behind -- and reruns the installer the first step just downloaded, which
 * carries the fix.
 *
 * This is a retry across one defect, not a general recovery. A release whose
 * *own* move is broken is not saved by anything here, which is why step 4
 * fails loudly with a command that comes from neither failed installer.
 */
export const performUpgrade = (tag: string, deps: UpgradeDeps): UpgradeOutcome => {
  const root = dataRoot(deps.env);
  const script = installerName(deps.platform);
  const invoked: string[] = [];
  const lines: string[] = [];

  const step1 = join(root, 'current', script);
  invoked.push(step1);
  deps.runInstaller(step1, tag);

  if (pointsAtTarget(root, tag, deps.platform)) {
    lines.push(`upgraded to ${tag}`);
    return { code: 0, lines, invoked };
  }

  // Not "the link did not move" -- a move to some other installed version
  // changes it and still leaves the machine wrong. Revision 1 said the former
  // and the retry would never have fired.
  lines.push(`the installer on disk did not leave ${tag} in place; retrying with the one it just downloaded`);
  const step3 = join(root, tag, script);
  invoked.push(step3);
  deps.runInstaller(step3, tag);

  if (pointsAtTarget(root, tag, deps.platform)) {
    lines.push(`upgraded to ${tag}`);
    return { code: 0, lines, invoked };
  }

  // The canonical one-liner, fetched fresh -- not the local script, which is
  // the bytes that just failed twice.
  lines.push(
    `could not upgrade to ${tag}: ${join(root, 'current')} still does not resolve to it.`,
    `Install it directly:\n\n  ${installCommand(tag, deps.platform)}`,
    `Then run: commitlore doctor — a link that is right over a checkout that is wrong is beyond what this command can see.`,
  );
  return { code: 1, lines, invoked };
};
