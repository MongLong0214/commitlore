/**
 * `commitlore auto` — read and write the unattended-capture setting so nobody
 * opens the JSON (#511 added the switch; this is what makes it usable).
 *
 * The command writes the same policy file `resolvePolicy` reads — there is no
 * second source of truth — and it cannot produce a file the resolver rejects:
 * enabling sets `mode: "auto"` beside `unattended: true`, because a consent
 * the mode cannot honour is a configuration error by design (ADR-0030, #511).
 *
 * Exit codes follow SPEC §10 and are documented in `--help`: `status` answers
 * with 0 whether the setting is on or off (the answer is not a finding), and
 * uses 1 only when a policy file exists that the resolver rejects — a
 * configuration error the caller can branch on. `on`/`off` use 0 for a write
 * that happened or a state that was already in effect, and 2 when the command
 * could not run: no repository, a rejected policy file it will not overwrite,
 * or a write that failed.
 */

import type { Command } from 'commander';

import {
  POLICY_FILE_NAME,
  capturePolicyPath,
  resolvePolicy,
  setUnattendedCapture,
  type CaptureMode,
} from '../core/capture-policy.js';

// ---------------------------------------------------------------------------
// Core logic — separated from registration for testability
// ---------------------------------------------------------------------------

export interface AutoStatusResult {
  /** False when a policy file exists but the resolver rejects it. */
  ok: boolean;
  /** The unattended setting in effect, or null when the file is rejected. */
  unattended: boolean | null;
  /** The mode in effect, or null when the file is rejected. */
  mode: CaptureMode | null;
  /** Where the setting lives: defaults (no file) or the repository file. */
  source: 'defaults' | 'repository';
  /** Absolute path of the policy file, or null outside a repository. */
  path: string | null;
  /** The resolver's named reason when the file is rejected; null otherwise. */
  error: string | null;
  /**
   * Whether unattended capture can start from the ordinary Git commit the
   * operator is about to make. A policy can authorise unattended capture, but
   * it cannot produce the host transcript that prepare requires.
   */
  unattendedStart: 'disabled' | 'agent-host-required' | 'unknown';
}

export interface AutoSetResult {
  ok: boolean;
  /** False when the requested state was already in effect and nothing was written. */
  changed: boolean;
  /** Absolute path of the policy file, or null outside a repository. */
  path: string | null;
  mode: CaptureMode | null;
  /** The mode before the change — named when `on` had to move it to `auto`. */
  previousMode: CaptureMode | null;
  error: string | null;
}

/** `auto status` — what is set now, and where the file is. Never writes. */
export const runAutoStatus = (cwd: string): AutoStatusResult | { outsideRepository: true } => {
  const path = capturePolicyPath(cwd);
  if (path === null) return { outsideRepository: true };

  const resolution = resolvePolicy(cwd);
  if (resolution.path !== null && !resolution.ok) {
    return {
      ok: false,
      unattended: null,
      mode: null,
      source: 'repository',
      path,
      error: resolution.error,
      unattendedStart: 'unknown',
    };
  }
  return {
    ok: true,
    unattended: resolution.policy.unattended,
    mode: resolution.policy.mode,
    source: resolution.path !== null ? 'repository' : 'defaults',
    path,
    error: null,
    unattendedStart: resolution.policy.unattended ? 'agent-host-required' : 'disabled',
  };
};

/** `auto on` / `auto off` — write the setting coherently, or say why not. */
export const runAutoSet = (cwd: string, enabled: boolean): AutoSetResult | { outsideRepository: true } => {
  const result = setUnattendedCapture(cwd, enabled);
  if (!result.ok) {
    if (result.path === null) return { outsideRepository: true };
    return { ok: false, changed: false, path: result.path, mode: null, previousMode: null, error: result.error };
  }
  return {
    ok: true,
    changed: result.changed,
    path: result.path,
    mode: result.policy.mode,
    previousMode: result.previous.mode,
    error: null,
  };
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const printStatus = (result: AutoStatusResult | { outsideRepository: true }, json: boolean): void => {
  if ('outsideRepository' in result) {
    process.stderr.write('commitlore auto: no git repository found here — run this inside a repository\n');
    process.exitCode = 2;
    return;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (!result.ok) {
    process.stdout.write(`unattended capture: unknown — ${POLICY_FILE_NAME} exists but is rejected\n`);
    process.stdout.write(`  ${result.error}\n`);
    process.stdout.write('  fix or remove the file and re-run; until then capture runs on the defaults\n');
    process.stdout.write('  unattended start: unknown — a rejected policy cannot authorise an agent host\n');
  } else if (result.source === 'defaults') {
    process.stdout.write(`unattended capture: off\n`);
    process.stdout.write(`  no ${POLICY_FILE_NAME} — the defaults apply (mode "auto", unattended false)\n`);
    process.stdout.write('  enable with: commitlore auto on\n');
    process.stdout.write('  unattended start: disabled by policy\n');
  } else {
    process.stdout.write(
      `unattended capture: ${result.unattended === true ? 'on — policy permits host-driven capture' : 'off'}\n`,
    );
    process.stdout.write(`  policy file: ${result.path} (mode "${result.mode}")\n`);
    if (result.unattended) {
      process.stdout.write('  unattended start: an agent host must initiate capture; init installs no initiator\n');
      process.stdout.write(
        '  ordinary git commits only apply a staged transaction — configure the host to call commitlore_prepare_capture with its session transcript before commit\n',
      );
    } else {
      process.stdout.write('  unattended start: disabled by policy\n');
    }
  }
  if (!result.ok) process.exitCode = 1;
};

const printSet = (result: AutoSetResult | { outsideRepository: true }, enabled: boolean, json: boolean): void => {
  if ('outsideRepository' in result) {
    process.stderr.write('commitlore auto: no git repository found here — run this inside a repository\n');
    process.exitCode = 2;
    return;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 2;
    return;
  }
  if (!result.ok) {
    process.stderr.write(`commitlore auto: ${result.error}\n`);
    process.exitCode = 2;
    return;
  }
  const word = enabled ? 'on' : 'off';
  if (!result.changed) {
    process.stdout.write(`unattended capture policy: ${word} — already set, nothing changed\n`);
    if (enabled) {
      process.stdout.write(
        '  an agent host must still initiate capture with its session transcript; an ordinary git commit cannot start it\n',
      );
    }
    return;
  }
  process.stdout.write(`unattended capture policy: ${word}\n`);
  process.stdout.write(`  wrote ${result.path}\n`);
  if (enabled && result.previousMode !== null && result.previousMode !== 'auto') {
    process.stdout.write(
      `  mode moved from "${result.previousMode}" to "auto" — unattended capture is honoured only in auto mode\n`,
    );
  }
  if (enabled) {
    process.stdout.write('  the file is committed with the repository — it applies to everyone who clones it\n');
    process.stdout.write(
      '  an agent host must still initiate capture with its session transcript; an ordinary git commit cannot start it\n',
    );
  }
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const register = (program: Command): void => {
  const auto = program
    .command('auto')
    .description(`read and write the unattended-capture setting (${POLICY_FILE_NAME})`)
    .option('--json', 'emit structured JSON output (bare `auto` reports status)')
    .addHelpText(
      'after',
      '\nUnattended capture authorises an agent host to prepare, verify and stage a record ' +
        'with nobody in the loop (ADR-0030, #511). It does not make ordinary `git commit` start ' +
        'capture: the host must invoke `commitlore_prepare_capture` with its session transcript first. ' +
        'The setting lives in ' + POLICY_FILE_NAME +
        ' at the repository root — the same file `resolvePolicy` reads; this command is the only ' +
        'writer. Enabling sets mode "auto" beside it, because the setting is honoured in auto mode ' +
        'only and a file the resolver would reject is never produced. The file is committed with ' +
        'the repository: turning it on applies to everyone who clones it.' +
        '\n\nExit codes (SPEC §10): `status` — 0 the state was reported (on or off), 1 a policy ' +
        'file exists but the resolver rejects it, 2 could not run (no repository). `on`/`off` — 0 ' +
        'written, or already in that state and unchanged, 2 could not run (no repository, a ' +
        'rejected policy file that will not be overwritten, or the write failed).',
    )
    .action((options: { json?: boolean }) => {
      printStatus(runAutoStatus(process.cwd()), options.json === true);
    });

  auto
    .command('status')
    .description('report the current setting and where the file is')
    .option('--json', 'emit structured JSON output')
    .addHelpText(
      'after',
      '\nExit codes (SPEC §10): 0 the state was reported (on or off), 1 a policy file exists but ' +
        'the resolver rejects it, 2 could not run (no repository).',
    )
    .action((options: { json?: boolean }) => {
      printStatus(runAutoStatus(process.cwd()), options.json === true);
    });

  auto
    .command('on')
    .description('enable unattended capture (writes mode "auto" and unattended true)')
    .option('--json', 'emit structured JSON output')
    .addHelpText(
      'after',
      '\nExit codes (SPEC §10): 0 written, or already on and unchanged, 2 could not run (no ' +
        'repository, a rejected policy file that will not be overwritten, or the write failed).',
    )
    .action((options: { json?: boolean }) => {
      printSet(runAutoSet(process.cwd(), true), true, options.json === true);
    });

  auto
    .command('off')
    .description('disable unattended capture (keeps the mode the repository chose)')
    .option('--json', 'emit structured JSON output')
    .addHelpText(
      'after',
      '\nExit codes (SPEC §10): 0 written, or already off and unchanged, 2 could not run (no ' +
        'repository, a rejected policy file that will not be overwritten, or the write failed).',
    )
    .action((options: { json?: boolean }) => {
      printSet(runAutoSet(process.cwd(), false), false, options.json === true);
    });

  // cli.ts applies exitOverride to top-level commands only; without this a bad
  // flag on a nested subcommand exits 1 (commander's default) instead of the
  // SPEC §10 usage code 2.
  for (const subcommand of auto.commands) subcommand.exitOverride();
};
