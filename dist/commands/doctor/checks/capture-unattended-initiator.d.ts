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
 * There is one repository-owned surface worth reading: a repository-scoped
 * `.mcp.json` registering this MCP server, which is what the plugin ships and
 * what a host loads to obtain `commitlore_prepare_capture` at all. Registration
 * is not proof that a host called it, and this check says so rather than
 * implying it — but the distinction between "wired, unobserved" and "not wired"
 * is the difference between a warning an operator can clear and one that fires
 * forever on a correctly configured repository. A permanent unclearable warning
 * teaches people to ignore the surface that carries the real ones.
 *
 * The policy file, an MCP lifecycle log and the injection hook are still not
 * proxies for it: consent is not a trigger, a past session is not this
 * repository's configuration, and the pre-edit integration never invokes a
 * capture tool.
 */
export declare const checkUnattendedCaptureInitiator: (ctx: DoctorContext) => DoctorCheck;
