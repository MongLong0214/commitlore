/**
 * The `release-freshness` doctor check (T-1605, #742).
 *
 * **Why this is not the notice.** `doctor` already reports a hook interpreter
 * running a different version from the CLI, and that report is what found
 * #735; a newer release existing is the same kind of fact. Leaving it in
 * neither class had teeth: the notice is silent for every `--json`
 * invocation, so the one structured contract anybody consumes could not carry
 * staleness and the notice could not appear there either. It would have been
 * invisible in the output built for programs to read.
 *
 * **It ignores `CI` and the terminal**, unlike the notice and like the
 * command. A report that omits part of itself when piped lies to whatever is
 * reading it.
 *
 * **The status never changes an exit code.** A newer release is not a
 * violation -- the same reasoning that makes `upgrade --check` exit 0 -- so
 * this reports `ok` with the fact in its detail rather than `warn`.
 */

import { latestReleaseSync } from '../../../core/latest-release.js';
import { packageVersion } from '../../../core/paths.js';
import { isNewerRelease } from '../../../core/release-version.js';
import { check, type Category, type DoctorCheck, type DoctorContext } from '../model.js';

export const checkReleaseFreshness = (ctx: DoctorContext): DoctorCheck => {
  const id = 'release-freshness';
  const title = 'release freshness';
  const category: Category = 'runtime';
  const current = packageVersion();
  const { outcome, cached } = latestReleaseSync({ env: ctx.env });

  const evidence = (extra: Record<string, string>): Record<string, string> => ({
    installed: current,
    checked: cached ? 'cache' : 'remote',
    ...extra,
  });

  if (outcome.kind === 'disabled') {
    // "Checking is switched off" is a different fact from "you are current",
    // and reporting the second one here would be a lie the operator asked for.
    return check(id, category, title, 'skipped', `not checked: ${outcome.by} is set`, null, false, false, {
      evidence: evidence({ latest: 'not_checked', disabled_by: outcome.by }),
      skipReason: 'nothing_applicable',
    });
  }

  if (outcome.kind !== 'resolved') {
    return check(id, category, title, 'skipped', `not checked: ${outcome.detail}`, null, false, false, {
      evidence: evidence({ latest: 'unknown', problem: outcome.detail }),
      skipReason: 'version_unreadable',
    });
  }

  if (!isNewerRelease(outcome.tag, current)) {
    return check(id, category, title, 'ok', `${current} is the newest release`, null, false, false, {
      evidence: evidence({ latest: outcome.tag }),
    });
  }

  return check(
    id,
    category,
    title,
    'ok',
    `${outcome.tag} is available; this machine runs ${current}`,
    'commitlore upgrade',
    false,
    false,
    { evidence: evidence({ latest: outcome.tag, update_available: 'true' }) },
  );
};
