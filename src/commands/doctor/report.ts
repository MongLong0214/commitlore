/**
 * Doctor command registration and output selection.
 *
 * This boundary owns Commander integration and choosing JSON versus the text
 * renderer, leaving diagnosis and formatting independently testable.
 *
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
 *
 * `checkSquashConservation` (ADR-0014, bug-issue-60 finding 1) is the same
 * shape of problem one route over: nothing runs `squash-preserve`
 * automatically, and a squash that happened without it silently drops
 * records the same way an unfetched mirror silently drops them. It is a
 * `doctor` check rather than a CI step because it runs at the moment the
 * mistake is still local and cheap to fix — see the check's own doc comment
 * for the full "Ruled-out" reasoning.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import type { Command } from 'commander';

import { PACKAGE_ROOT, installedPath, packageVersion } from '../../core/paths.js';
import type { DoctorCheck, DoctorReport, DoctorStatus, InstallSource } from './model.js';
import { formatReport } from './render.js';
import { runDoctor } from './runner.js';

/**
 * The actionable root causes, in the order a user should address them.
 *
 * Filtering happens here; remediation-text deduplication belongs to the text
 * renderer, where it can retain one line for every independently failing row.
 */
export const computeFixPlan = (checks: readonly DoctorCheck[]): string[] => [
  ...checks.filter((check) => check.status === 'fail' && check.blockedBy === undefined),
  ...checks.filter((check) => check.status === 'warn' && check.blockedBy === undefined),
].map((check) => check.id);

const headlineWithoutAction = (status: DoctorStatus): string => {
  if (status === 'ok') return 'Doctor is healthy.';
  if (status === 'degraded') return 'Doctor is usable; some checks could not be verified.';
  return 'Doctor failed; no actionable checks are available.';
};

export const deriveHeadline = (args: {
  checks: readonly DoctorCheck[];
  fixPlan: readonly string[];
  status: DoctorStatus;
}): string => {
  const nextId = args.fixPlan[0];
  if (nextId === undefined) return headlineWithoutAction(args.status);

  const next = args.checks.find((check) => check.id === nextId);
  if (next === undefined) return headlineWithoutAction(args.status);

  return `Next action [${next.id}]: ${next.detail}${next.fix === null ? '' : ` — ${next.fix}`}`;
};

/**
 * The report's only status derivation.
 *
 * This must receive the runner's final row set, after containment has turned a
 * thrown check into a failed row. Otherwise a crash could leave the envelope
 * looking healthy even though its checks say it was not fully examined.
 */
export const deriveStatus = (checks: readonly DoctorCheck[]): DoctorStatus => {
  const required = checks.filter((check) => !check.optional);
  if (required.some((check) => check.status === 'fail')) return 'failed';
  if (required.some((check) => check.status === 'warn' || check.status === 'skipped')) {
    return 'degraded';
  }
  return 'ok';
};

/**
 * Classify the installation from paths and the plugin environment only. This
 * deliberately spawns nothing: doctor reports the channel, it does not ask it
 * whether an update exists.
 */
export const deriveInstallSource = (
  {
    entryPath = installedPath('dist', 'commitlore.mjs'),
    packageRoot = PACKAGE_ROOT,
    pluginRoot = process.env['CLAUDE_PLUGIN_ROOT'],
  }: {
    entryPath?: string;
    packageRoot?: string;
    pluginRoot?: string;
  } = {},
): InstallSource => {
  if (pluginRoot !== undefined && pluginRoot !== '') return 'plugin';

  const segments = resolve(entryPath).split(sep);
  if (segments.includes('_npx')) return 'npx';
  if (segments.includes('node_modules')) return 'npm';

  try {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      name?: unknown;
    };
    if (manifest.name === 'commitlore' && existsSync(join(packageRoot, '.git'))) return 'source';
  } catch {
    // A malformed package manifest cannot license a source classification.
  }
  return 'unknown';
};

const summarize = (checks: readonly DoctorCheck[]): DoctorReport['summary'] => {
  const summary: DoctorReport['summary'] = {
    total: checks.length,
    ok: 0,
    warn: 0,
    fail: 0,
    skipped: 0,
    durationMs: 0,
  };
  for (const check of checks) {
    summary[check.status] += 1;
    summary.durationMs += check.durationMs ?? 0;
  }
  return summary;
};

/**
 * The final JSON envelope constructor. `selection` is intentionally absent:
 * this command has no filter surface yet, and the additive contract reserves
 * absence rather than a null placeholder for it.
 */
export const buildReport = (checks: DoctorCheck[]): DoctorReport => {
  const status = deriveStatus(checks);
  const fixPlan = computeFixPlan(checks);
  return {
    schema: 'commitlore_doctor.v2',
    version: packageVersion(),
    status,
    installSource: deriveInstallSource(),
    headline: deriveHeadline({ checks, fixPlan, status }),
    summary: summarize(checks),
    fixPlan,
    checks,
    exitCode: checks.some((check) => !check.optional && check.status === 'fail') ? 1 : 0,
  };
};

export const register = (program: Command): void => {
  program
    .command('doctor')
    .description('check that this repository can carry and share CommitLore records')
    .option('--fix', 'apply the reversible local config fixes (notes fetch refspec)')
    .option('--json', 'emit the report as JSON')
    .addHelpText(
      'after',
      '\nExit codes: 0 no non-optional check failed, 1 a non-optional check failed, 2 usage error (SPEC §10).',
    )
    .action((options: { fix?: boolean; json?: boolean }) => {
      const report = runDoctor({ fix: options.fix === true });
      process.stdout.write(
        options.json === true ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report),
      );
      process.exitCode = report.exitCode;
    });
};
