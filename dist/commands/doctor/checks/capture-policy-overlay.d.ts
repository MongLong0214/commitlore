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
import { type DoctorCheck, type DoctorContext } from '../model.js';
export declare const checkPolicyOverlay: (ctx: DoctorContext) => DoctorCheck;
