/**
 * The `policy-overlay` doctor check (#709).
 *
 * `.commitlore-policy.local.json` wins per key over the committed
 * `.commitlore-policy.json`. That precedence is what lets one machine differ
 * without carrying a permanently modified tracked file, and it is also the
 * thing the single-location design was avoiding: a reader who opens the
 * committed file now sees a policy that may not be the one that ran.
 *
 * A stated precedence nobody can see is the ambiguous case in disguise, so the
 * condition attached to allowing the overlay was that `doctor` names both
 * files, both values and the effective one. This check is that condition.
 *
 * It reports `ok` when the two disagree. Disagreement is the feature working —
 * the operator wrote the overlay on purpose — and a warning that fires forever
 * on a correctly configured machine teaches people to ignore the surface that
 * carries the real ones. What warrants a warning is an overlay the resolver
 * cannot use, because then neither file's values are in force.
 */

import {
  POLICY_FILE_NAME,
  POLICY_KEYS,
  POLICY_LOCAL_FILE_NAME,
  resolvePolicy,
} from '../../../core/capture-policy.js';
import { check, type Category, type DoctorCheck, type DoctorContext } from '../model.js';

const id = 'policy-overlay';
const title = 'capture policy overlay';
const category: Category = 'capture';

export const checkPolicyOverlay = (ctx: DoctorContext): DoctorCheck => {
  const cwd = ctx.opts.cwd ?? process.cwd();
  const resolution = resolvePolicy(cwd);

  if (!resolution.ok) {
    // Which file is broken decides which one the operator opens. When the
    // overlay is the one that exists, the committed file's values are not in
    // force either — the resolver falls back to the built-in defaults — and
    // saying so is the difference between a fixable report and a puzzle.
    const rejected = resolution.localPath !== null ? POLICY_LOCAL_FILE_NAME : POLICY_FILE_NAME;
    return check(
      id,
      category,
      title,
      'warn',
      `${rejected} is rejected, so neither file's values are in force — capture is running on the built-in defaults`,
      'commitlore auto status',
      false,
      undefined,
      {
        evidence: {
          state: 'rejected',
          rejected,
          policy_error: resolution.error ?? 'unknown',
          in_force: 'built-in defaults',
        },
      },
    );
  }

  if (resolution.localPath === null) {
    return check(
      id,
      category,
      title,
      'ok',
      resolution.path === null
        ? `no policy file and no ${POLICY_LOCAL_FILE_NAME} — the built-in defaults apply and nothing overrides them`
        : `${POLICY_FILE_NAME} applies as written; no ${POLICY_LOCAL_FILE_NAME} overrides it`,
      null,
      false,
      undefined,
      {
        evidence: {
          state: 'no-overlay',
          policy_file: resolution.path ?? 'absent',
          overlay: 'absent',
          source: resolution.source,
        },
      },
    );
  }

  const beneathName = resolution.path === null ? 'the built-in defaults' : POLICY_FILE_NAME;

  if (resolution.overridden.length === 0) {
    return check(
      id,
      category,
      title,
      'ok',
      `${POLICY_LOCAL_FILE_NAME} is present and agrees with ${beneathName} on every key — it changes nothing`,
      null,
      false,
      undefined,
      {
        evidence: {
          state: 'overlay-agrees',
          policy_file: resolution.path ?? 'absent',
          overlay: resolution.localPath,
          overridden: 'none',
        },
      },
    );
  }

  // Both values and the effective one, per key. `beneath` is what applied
  // before the overlay, so the pair is a real before/after rather than a guess
  // about which file a value came from.
  const differences = resolution.overridden.map(
    (key) => `${key}: ${JSON.stringify(resolution.beneath[key])} in ${beneathName}, ${JSON.stringify(resolution.policy[key])} here — ${JSON.stringify(resolution.policy[key])} applies`,
  );

  const evidence: Record<string, string> = {
    state: 'overlay-overrides',
    policy_file: resolution.path ?? 'absent',
    overlay: resolution.localPath,
    overridden: resolution.overridden.join(','),
  };
  for (const key of POLICY_KEYS) {
    if (!resolution.overridden.includes(key)) continue;
    evidence[`${key}_repository`] = JSON.stringify(resolution.beneath[key]);
    evidence[`${key}_effective`] = JSON.stringify(resolution.policy[key]);
  }

  return check(
    id,
    category,
    title,
    'ok',
    `${resolution.localPath} overrides ${beneathName} — ${differences.join('; ')}`,
    null,
    false,
    undefined,
    { evidence },
  );
};
