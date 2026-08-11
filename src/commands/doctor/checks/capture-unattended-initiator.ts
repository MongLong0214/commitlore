/**
 * The `unattended-initiator` doctor check.
 *
 * The capture policy authorises an unattended run; it is not a trigger. This
 * check owns the deliberately separate question of whether an ordinary Git
 * commit can begin that run.
 */

import { POLICY_FILE_NAME, resolvePolicy } from '../../../core/capture-policy.js';
import { MCP_REGISTRATION_FILE, registersCommitloreMcpServer } from '../../../core/mcp-registration.js';
import { check, type Category, type DoctorCheck, type DoctorContext } from '../model.js';

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
export const checkUnattendedCaptureInitiator = (ctx: DoctorContext): DoctorCheck => {
  const id = 'unattended-initiator';
  const title = 'unattended capture initiator';
  const category: Category = 'capture';
  const cwd = ctx.opts.cwd ?? process.cwd();
  const resolution = resolvePolicy(cwd);

  if (!resolution.ok) {
    return check(
      id,
      category,
      title,
      'warn',
      `${POLICY_FILE_NAME} is rejected, so doctor cannot determine whether an agent host may start unattended capture`,
      'commitlore auto status',
      false,
      undefined,
      {
        evidence: {
          policy: 'rejected',
          policy_error: resolution.error ?? 'unknown',
          ordinary_git_commit: 'cannot-initiate',
        },
      },
    );
  }

  if (!resolution.policy.unattended) {
    return check(
      id,
      category,
      title,
      'ok',
      'unattended capture is off; no host initiator is required',
      null,
      false,
      undefined,
      {
        evidence: {
          policy: 'off',
          ordinary_git_commit: 'cannot-initiate',
          initiator: 'not-applicable',
        },
      },
    );
  }

  if (registersCommitloreMcpServer(cwd)) {
    return check(
      id,
      category,
      title,
      'ok',
      `${MCP_REGISTRATION_FILE} registers the capture server, so a host loading it can start unattended capture; ` +
        'an ordinary git commit outside that host still cannot',
      null,
      false,
      undefined,
      {
        evidence: {
          policy: 'unattended',
          ordinary_git_commit: 'cannot-initiate',
          initiator: 'mcp-server-registered',
          // Registration is configuration, not observation: nothing here
          // proves a host has ever called the tool.
          verified: 'registration-only',
        },
      },
    );
  }

  return check(
    id,
    category,
    title,
    'warn',
    'unattended capture is authorised, but an ordinary git commit cannot start it: the installed hooks only apply or finalise an already staged transaction',
    'configure an agent host to call commitlore_prepare_capture with its session transcript before git commit',
    false,
    undefined,
    {
      evidence: {
        policy: 'unattended',
        ordinary_git_commit: 'cannot-initiate',
        initiator: 'agent-host-required',
      },
    },
  );
};
