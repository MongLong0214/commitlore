/**
 * The `unattended-initiator` doctor check.
 *
 * The capture policy authorises an unattended run; it is not a trigger. This
 * check owns the deliberately separate question of whether an ordinary Git
 * commit can begin that run.
 */

import { POLICY_FILE_NAME, resolvePolicy } from '../../../core/capture-policy.js';
import {
  MCP_REGISTRATION_FILE,
  registeredMcpCommand,
  registeredMcpLaunch,
  registersCommitloreMcpServer,
  registrationIsOurs,
} from '../../../core/mcp-registration.js';
import { isMcpProbeFailure, probeMcpSync } from '../../../core/mcp-probe.js';
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

  const launch = registeredMcpLaunch(cwd);
  if (launch !== null && registersCommitloreMcpServer(cwd)) {
    const command = registeredMcpCommand(cwd);
    const ours = registrationIsOurs(cwd);
    const probe = probeMcpSync(launch.command, launch.args);
    if (isMcpProbeFailure(probe)) {
      // A timeout is an observation about this attempt, not a verdict about
      // the registration (#640). Measured on a Windows runner: a *passing*
      // probe consumed 4478ms of its 5000ms budget, because the chain is
      // doctor -> sidecar node -> cmd.exe -> the server's own node, three
      // process starts before a byte is exchanged. On a slower machine the
      // same healthy registration reports the same silence — and saying "it is
      // unhealthy, repair it" sends an operator to fix something that works.
      const unverified = probe.reason === 'initialize-timed-out';
      return check(
        id,
        category,
        title,
        'warn',
        unverified
          ? `${MCP_REGISTRATION_FILE} registers ${JSON.stringify(command)} under commitlore, and it did not answer in time to be verified: ${probe.detail}. This does not say the registration is broken — a cold start on a loaded machine can outlast the probe.`
          : `${MCP_REGISTRATION_FILE} registers ${JSON.stringify(command)} under commitlore, but it is unhealthy: ${probe.detail}`,
        unverified
          ? `rerun commitlore doctor when the machine is quieter; if it keeps timing out, start ${JSON.stringify(command)} by hand and check that it answers an MCP initialize`
          : `repair ${JSON.stringify(command)} so it answers as a CommitLore MCP server, or remove the entry and run commitlore init`,
        false,
        undefined,
        {
          evidence: {
            policy: 'unattended',
            ordinary_git_commit: 'cannot-initiate',
            initiator: unverified ? 'registered-command-unverified' : 'registered-command-unhealthy',
            command: command ?? '',
            probe: probe.reason,
          },
        },
      );
    }
    if (probe.kind === 'read-delivery') {
      return check(
        id,
        category,
        title,
        'warn',
        `${MCP_REGISTRATION_FILE} registers a live CommitLore read-delivery server${ours ? '' : ' through a custom wrapper'}, but it does not advertise all three capture tools, so it is not an unattended capture initiator`,
        'register a CommitLore MCP server that advertises commitlore_prepare_capture, commitlore_verify_capture, and commitlore_stage_capture',
        false,
        undefined,
        {
          evidence: {
            policy: 'unattended',
            ordinary_git_commit: 'cannot-initiate',
            initiator: 'read-delivery-only',
            registration: ours ? 'installer-owned' : 'custom-preserved',
            verified: 'identity-and-read-tools',
            capture_tools: 'not-complete',
          },
        },
      );
    }
    return check(
      id,
      category,
      title,
      'ok',
      `${MCP_REGISTRATION_FILE} registers a live CommitLore MCP server${ours ? '' : ' through a custom wrapper'} that advertises the required read and capture tools; ` +
        'this verifies identity and tool set, not asset readiness — required assets such as SPEC.md can still be missing and make prepare fail; an ordinary git commit outside that host still cannot initiate capture',
      null,
      false,
      undefined,
      {
        evidence: {
          policy: 'unattended',
          ordinary_git_commit: 'cannot-initiate',
          initiator: 'capture-tools-advertised',
          registration: ours ? 'installer-owned' : 'custom-preserved',
          verified: 'identity-and-read-and-capture-tools',
          asset_readiness: 'not-verified',
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
