/**
 * The `cli-runtime` doctor check.
 *
 * It owns the installation artifact probe because that verdict is independent
 * of every other check; shared report construction remains in the model seam.
 */

import { existsSync } from 'node:fs';

import { installedPath } from '../../../core/paths.js';
import { boundedExcerpt, check, gitOptions, streamEvidence, type Category, type DoctorCheck, type DoctorContext } from '../model.js';

/**
 * Whether the CLI this installation actually uses runs.
 *
 * **Which artifact is the installation is the whole question.** A git clone —
 * the documented distribution (ADR-0011) — ships `dist/commitlore.mjs`, a bundle
 * that needs no `node_modules`. A development checkout also has `dist/cli.js`,
 * the `tsc` output, which imports its dependencies and cannot run without them.
 * A compiled single-executable build (#39) is neither — it has no `dist/`
 * beside it at all, by design, and the question this check exists to answer
 * ("does the CLI this installation uses actually run") already has its answer
 * the moment this process is that binary and got far enough to ask.
 *
 * The first version of this check probed `dist/cli.js` unconditionally. On a
 * fresh clone that is a file that exists and cannot run, so the check invented a
 * failure in the one installation it was written to protect, and turned CI red
 * for three commits. A health check that reports the supported path as broken is
 * worse than no health check.
 *
 * `--version` is the cheapest thing the CLI can be asked to do that still forces
 * the runtime to resolve, the bundle to load, and its imports to resolve.
 */
export const checkRuntime = (ctx: DoctorContext): DoctorCheck => {
  const title = 'cli runtime';
  const id = 'cli-runtime';
  const category: Category = 'runtime';

  // The bundle first: it is what a clone has and what the plugin invokes. The
  // tsc output is the fallback for a checkout that has not been bundled.
  const candidates = ['dist/commitlore.mjs', 'dist/cli.js'].map((rel) => installedPath(rel));
  const entry = candidates.find((path) => existsSync(path));
  if (entry === undefined) {
    return check(
      id,
      category,
      title,
      'fail',
      `no built CLI at ${candidates.join(' or ')} — this checkout has not been built`,
      'npm install && npm run build',
      false,
      undefined,
      {
        evidence: {
          entry: candidates.join(' or '),
          exit_code: 'not_run',
          ...streamEvidence('stderr', ''),
        },
      },
    );
  }

  const run = ctx.spawn(process.execPath, [entry, '--version'], {
    shell: false,
    encoding: 'utf8',
    ...gitOptions(ctx.opts),
  });

  if (run.error !== undefined) {
    return check(
      id,
      category,
      title,
      'fail',
      `could not run ${entry}: ${run.error.message}`,
      null,
      false,
      undefined,
      {
        evidence: {
          entry,
          exit_code: String(run.status ?? 'unavailable'),
          error: run.error.message,
          ...streamEvidence('stderr', run.stderr),
        },
      },
    );
  }
  if (run.status !== 0) {
    const detail = `${run.stderr ?? ''}`.trim().split('\n')[0] ?? `exit ${String(run.status)}`;
    return check(
      id,
      category,
      title,
      'fail',
      `${entry} exits ${String(run.status)}: ${detail}`,
      'npm install',
      false,
      undefined,
      {
        evidence: {
          entry,
          exit_code: String(run.status),
          ...streamEvidence('stderr', run.stderr),
        },
      },
    );
  }

  return check(
    id,
    category,
    title,
    'ok',
    `${entry} runs (${run.stdout.trim()})`,
    null,
    false,
    undefined,
    {
      evidence: {
        entry,
        version: boundedExcerpt(run.stdout).firstLine,
        ...streamEvidence('stdout', run.stdout),
      },
    },
  );
};
