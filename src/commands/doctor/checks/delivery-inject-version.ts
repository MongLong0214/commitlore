/**
 * The `inject-version` doctor check.
 *
 * It owns comparison of the configured hook executable with this CLI, keeping
 * that freshness signal separate from the runtime check that establishes it runs.
 */

import { spawnSync } from 'node:child_process';

import { packageVersion } from '../../../core/paths.js';
import { CLAUDE_HOOK_COMMAND, CLAUDE_HOOK_MARKER, claudeSettingsPath, readClaudeHookStatus } from '../../../hooks/claude-settings.js';
import {
  blocked,
  boundedExcerpt,
  check,
  streamEvidence,
  type Category,
  type DoctorCheck,
  type DoctorOptions,
} from '../model.js';

/**
 * Whether the build the agent's hook runs is the build you are running (#433).
 *
 * These are separate installations and nothing keeps them in step. A plugin
 * cache found in the field held **0.4.0** while the CLI beside it was 0.6.0 —
 * four releases apart, with no signal to the user that anything was behind.
 * Everything fixed in between, including two security fixes, was invisible to
 * every agent edit in that repository, because the agent runs the hook and not
 * the CLI.
 *
 * Local and offline, like every other check here: the configured executable is
 * asked for its own version. `checkInjectRuntime` already spawns exactly this
 * command, so the cost is one more process and no new failure mode.
 *
 * A `warn`, not a `fail`. An older hook still delivers records; it delivers
 * them under older rules, which is worth saying and is not worth refusing to
 * run over.
 */
const SEMVER_ISH = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/;

export const checkInjectVersion = (
  opts: DoctorOptions,
  dependencies: ReadonlyMap<string, DoctorCheck>,
): DoctorCheck => {
  const title = 'PreToolUse hook version';
  const id = 'inject-version';
  const category: Category = 'delivery';
  const cwd = opts.cwd ?? process.cwd();
  const mine = packageVersion();
  const settings = readClaudeHookStatus(claudeSettingsPath(cwd));

  if (settings.state !== 'installed') {
    return check(
      id,
      category,
      title,
      'skipped',
      `no installed hook to compare against ${mine}`,
      null,
      false,
      false,
      {
        evidence: { executable: 'not_run', theirs: 'not_run', mine },
        skipReason: 'hook_not_installed',
      },
    );
  }
  const command = settings.commands[0];
  if (command !== CLAUDE_HOOK_COMMAND) {
    return check(
      id,
      category,
      title,
      'skipped',
      'not checked: the configured command is not recognised',
      null,
      false,
      false,
      {
        evidence: {
          executable: 'not_run',
          theirs: 'not_run',
          mine,
          configured_command: command ?? 'none',
        },
        skipReason: 'command_unrecognized',
      },
    );
  }

  const configured = command.replace(` ${CLAUDE_HOOK_MARKER}`, '');
  const executable = configured.slice(0, configured.indexOf(' '));
  const run = spawnSync(executable, ['--version'], {
    shell: false,
    encoding: 'utf8',
    cwd,
    env: {
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
      HOME: process.env['HOME'] ?? '',
    },
  });
  const reported = typeof run.stdout === 'string' ? run.stdout : '';
  const versionEvidence = {
    executable,
    theirs: boundedExcerpt(reported).firstLine || 'unavailable',
    mine,
    exit_code: String(run.status ?? 'unavailable'),
    ...streamEvidence('stdout', reported),
  };

  if (run.status !== 0 || typeof run.stdout !== 'string') {
    // `checkInjectRuntime` owns "the hook does not run at all" and reports it
    // with the remedy. Saying it twice would be noise.
    const skipped = check(
      id,
      category,
      title,
      'skipped',
      `${executable} did not report a version`,
      null,
      false,
      false,
      { evidence: versionEvidence, skipReason: 'version_unreadable' },
    );
    const runtime = dependencies.get('inject-runtime');
    return runtime === undefined || runtime.status === 'ok' ? skipped : blocked(runtime, skipped);
  }

  const theirs = run.stdout.trim();
  // Exit 0 is not the same as an answer. A wrapper that ignores its arguments
  // and prints a hook payload for any argv exits 0 too, and reading that as a
  // version reports a mismatch against something that was never a version.
  // Two builds cannot be compared unless both sides actually said one.
  if (!SEMVER_ISH.test(theirs)) {
    return check(
      id,
      category,
      title,
      'skipped',
      `${executable} answered --version with something that is not a version`,
        null,
    false,
    false,
    { evidence: versionEvidence, skipReason: 'version_unreadable' },
  );
  }
  if (theirs === mine) {
    return check(
      id,
      category,
      title,
      'ok',
      `the hook runs ${theirs}, the same build as this CLI`,
      null,
      false,
      undefined,
      { evidence: versionEvidence },
    );
  }

  return check(
    id,
      category,
    title,
    'warn',
    `the agent's hook runs ${theirs} but this CLI is ${mine} — every edit is graded by ${theirs}'s rules, not this one's`,
    'update the installation the hook resolves to (for the plugin: /plugin marketplace update commitlore), then rerun: commitlore doctor',
    false,
    undefined,
    { evidence: versionEvidence },
  );
};
