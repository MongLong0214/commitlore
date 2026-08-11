/**
 * The `unattended-initiator` doctor check.
 *
 * The capture policy authorises an unattended run; it is not a trigger. This
 * check owns the deliberately separate question of whether an ordinary Git
 * commit can begin that run.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
/**
 * #527: a policy file said unattended capture was enabled, while normal Git
 * commits never made a pending transaction.
 *
 * The policy must not stand in for an initiator. `prepare-commit-msg` can only
 * apply a staged transaction and `post-commit` can only finalise one; neither
 * sees the host conversation that `prepare` hashes. The pre-edit integration
 * is not one either: it injects context before an edit and never invokes a
 * capture tool.
 *
 * There is no repository-owned host registration surface to probe. Host skill
 * selection and host MCP calls happen outside Git and are intentionally not
 * fabricated from a diff (ADR-0028). So when the policy is on, doctor reports
 * the missing prerequisite instead of using the policy, an MCP lifecycle log,
 * or the injection hook as a proxy for it.
 */
export declare const checkUnattendedCaptureInitiator: (ctx: DoctorContext) => DoctorCheck;
