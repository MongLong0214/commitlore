/**
 * The `unattended-initiator` doctor check.
 *
 * The capture policy authorises an unattended run; it is not a trigger. This
 * check owns the deliberately separate question of whether an ordinary Git
 * commit can begin that run.
 */
import { POLICY_FILE_NAME, resolvePolicy } from '../../../core/capture-policy.js';
import { check } from '../model.js';
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
export const checkUnattendedCaptureInitiator = (ctx) => {
    const id = 'unattended-initiator';
    const title = 'unattended capture initiator';
    const category = 'capture';
    const cwd = ctx.opts.cwd ?? process.cwd();
    const resolution = resolvePolicy(cwd);
    if (!resolution.ok) {
        return check(id, category, title, 'warn', `${POLICY_FILE_NAME} is rejected, so doctor cannot determine whether an agent host may start unattended capture`, 'commitlore auto status', false, undefined, {
            evidence: {
                policy: 'rejected',
                policy_error: resolution.error ?? 'unknown',
                ordinary_git_commit: 'cannot-initiate',
            },
        });
    }
    if (!resolution.policy.unattended) {
        return check(id, category, title, 'ok', 'unattended capture is off; no host initiator is required', null, false, undefined, {
            evidence: {
                policy: 'off',
                ordinary_git_commit: 'cannot-initiate',
                initiator: 'not-applicable',
            },
        });
    }
    return check(id, category, title, 'warn', 'unattended capture is authorised, but an ordinary git commit cannot start it: the installed hooks only apply or finalise an already staged transaction', 'configure an agent host to call commitlore_prepare_capture with its session transcript before git commit', false, undefined, {
        evidence: {
            policy: 'unattended',
            ordinary_git_commit: 'cannot-initiate',
            initiator: 'agent-host-required',
        },
    });
};
//# sourceMappingURL=capture-unattended-initiator.js.map