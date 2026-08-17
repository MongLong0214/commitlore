/**
 * `commitlore auto` — read and write the unattended-capture setting so nobody
 * opens the JSON (#511 added the switch; this is what makes it usable).
 *
 * The command writes the same files `resolvePolicy` reads — there is no second
 * source of truth — and it cannot produce a file the resolver rejects: enabling
 * sets `mode: "auto"` beside `unattended: true`, because a consent the mode
 * cannot honour is a configuration error by design (ADR-0030, #511).
 *
 * Which file it writes is the overlay when one exists or `--local` asks for it,
 * and the committed policy otherwise (#709). Existence is the signal because
 * creating the overlay is a decision: an `auto off` that silently created one
 * would stop the tracked file being the answer without anyone choosing that.
 *
 * Exit codes follow SPEC §10 and are documented in `--help`: `status` answers
 * with 0 whether the setting is on or off (the answer is not a finding), and
 * uses 1 only when a policy file exists that the resolver rejects — a
 * configuration error the caller can branch on. `on`/`off` use 0 for a write
 * that happened or a state that was already in effect, and 2 when the command
 * could not run: no repository, a rejected policy file it will not overwrite,
 * or a write that failed.
 */
import { POLICY_FILE_NAME, capturePolicyPath, POLICY_LOCAL_FILE_NAME, resolvePolicy, setUnattendedCapture, } from '../core/capture-policy.js';
/** `auto status` — what is set now, and where the file is. Never writes. */
export const runAutoStatus = (cwd) => {
    const path = capturePolicyPath(cwd);
    if (path === null)
        return { outsideRepository: true };
    const resolution = resolvePolicy(cwd);
    if (!resolution.ok) {
        return {
            ok: false,
            unattended: null,
            mode: null,
            // Which file was rejected, so the reader opens the right one.
            source: resolution.localPath !== null ? 'local' : 'repository',
            path,
            localPath: resolution.localPath,
            overridden: [],
            error: resolution.error,
            unattendedStart: 'unknown',
        };
    }
    return {
        ok: true,
        unattended: resolution.policy.unattended,
        mode: resolution.policy.mode,
        source: resolution.source,
        path,
        localPath: resolution.localPath,
        overridden: resolution.overridden,
        error: null,
        unattendedStart: resolution.policy.unattended ? 'agent-host-required' : 'disabled',
    };
};
/** `auto on` / `auto off` — write the setting coherently, or say why not. */
export const runAutoSet = (cwd, enabled, opts = {}) => {
    const result = setUnattendedCapture(cwd, enabled, opts);
    if (!result.ok) {
        if (result.path === null)
            return { outsideRepository: true };
        return { ok: false, changed: false, path: result.path, scope: result.scope, mode: null, previousMode: null, error: result.error };
    }
    return {
        ok: true,
        changed: result.changed,
        path: result.path,
        scope: result.scope,
        mode: result.policy.mode,
        previousMode: result.previous.mode,
        error: null,
    };
};
// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const printStatus = (result, json) => {
    if ('outsideRepository' in result) {
        process.stderr.write('commitlore auto: no git repository found here — run this inside a repository\n');
        process.exitCode = 2;
        return;
    }
    if (json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    else if (!result.ok) {
        process.stdout.write(`unattended capture: unknown — ${result.source === 'local' ? POLICY_LOCAL_FILE_NAME : POLICY_FILE_NAME} exists but is rejected\n`);
        process.stdout.write(`  ${result.error}\n`);
        process.stdout.write('  fix or remove the file and re-run; until then capture runs on the defaults\n');
        process.stdout.write('  unattended start: unknown — a rejected policy cannot authorise an agent host\n');
    }
    else if (result.source === 'defaults') {
        process.stdout.write(`unattended capture: off\n`);
        process.stdout.write(`  no ${POLICY_FILE_NAME} — the defaults apply (mode "auto", unattended false)\n`);
        process.stdout.write('  enable with: commitlore auto on\n');
        process.stdout.write('  unattended start: disabled by policy\n');
    }
    else {
        process.stdout.write(
        // Not "on" (#550, #527). A bare `on` is true of the policy and read as
        // true of the system, in the position where a reader stops. The lines
        // below already say nothing initiates capture on its own; a headline that
        // contradicts them is the one people believe.
        `unattended capture: ${result.unattended === true
            ? 'policy permits host-driven capture — nothing initiates it on its own'
            : 'off'}\n`);
        process.stdout.write(`  policy file: ${result.path} (mode "${result.mode}")\n`);
        if (result.localPath !== null) {
            // Two files decided this, so both are named and the override is spelled
            // out. A precedence nobody can see is the ambiguous case in disguise,
            // which is what the single-location design was avoiding (#709). Which
            // value each key holds is `doctor`'s policy-overlay check; here it is
            // enough to say the overlay exists and what it is deciding.
            process.stdout.write(`  local overlay: ${result.localPath} — wins per key, untracked by convention\n`);
            process.stdout.write(result.overridden.length === 0
                ? '  the overlay changes nothing the repository already says\n'
                : `  overridden here: ${result.overridden.join(', ')} — run commitlore doctor for the values\n`);
        }
        if (result.unattended) {
            process.stdout.write('  unattended start: an agent host must initiate capture; init installs no initiator\n');
            process.stdout.write('  ordinary git commits only apply a staged transaction — configure the host to call commitlore_prepare_capture with its session transcript before commit\n');
        }
        else {
            process.stdout.write('  unattended start: disabled by policy\n');
        }
    }
    if (!result.ok)
        process.exitCode = 1;
};
const printSet = (result, enabled, json) => {
    if ('outsideRepository' in result) {
        process.stderr.write('commitlore auto: no git repository found here — run this inside a repository\n');
        process.exitCode = 2;
        return;
    }
    if (json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (!result.ok)
            process.exitCode = 2;
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
            process.stdout.write('  an agent host must still initiate capture with its session transcript; an ordinary git commit cannot start it\n');
        }
        return;
    }
    process.stdout.write(`unattended capture policy: ${word}\n`);
    process.stdout.write(`  wrote ${result.path}\n`);
    if (enabled && result.previousMode !== null && result.previousMode !== 'auto') {
        process.stdout.write(`  mode moved from "${result.previousMode}" to "auto" — unattended capture is honoured only in auto mode\n`);
    }
    if (enabled) {
        process.stdout.write(result.scope === 'local'
            ? `  ${POLICY_LOCAL_FILE_NAME} is this machine's own — it applies to nobody else, and ${POLICY_FILE_NAME} is untouched\n`
            : '  the file is committed with the repository — it applies to everyone who clones it\n');
        process.stdout.write('  an agent host must still initiate capture with its session transcript; an ordinary git commit cannot start it\n');
    }
};
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
export const register = (program) => {
    const auto = program
        .command('auto')
        .description(`read and write the unattended-capture setting (${POLICY_FILE_NAME})`)
        .option('--json', 'emit structured JSON output (bare `auto` reports status)')
        .addHelpText('after', '\nUnattended capture authorises an agent host to prepare, verify and stage a record ' +
        'with nobody in the loop (ADR-0030, #511). It does not make ordinary `git commit` start ' +
        'capture: the host must invoke `commitlore_prepare_capture` with its session transcript first. ' +
        'The setting lives in ' + POLICY_FILE_NAME +
        ' at the repository root — the same file `resolvePolicy` reads. Enabling sets mode "auto" ' +
        'beside it, because the setting is honoured in auto mode only and a file the resolver ' +
        'would reject is never produced. That file is committed with the repository: turning it ' +
        'on applies to everyone who clones it. To differ on one machine without modifying it, ' +
        '`on --local` / `off --local` write ' + POLICY_LOCAL_FILE_NAME +
        ', which wins per key and is untracked by convention (#709); once it exists it is the ' +
        'file this command writes.' +
        '\n\nExit codes (SPEC §10): `status` — 0 the state was reported (on or off), 1 a policy ' +
        'file exists but the resolver rejects it, 2 could not run (no repository). `on`/`off` — 0 ' +
        'written, or already in that state and unchanged, 2 could not run (no repository, a ' +
        'rejected policy file that will not be overwritten, or the write failed).')
        .action((options) => {
        printStatus(runAutoStatus(process.cwd()), options.json === true);
    });
    auto
        .command('status')
        .description('report the current setting and where the file is')
        .option('--json', 'emit structured JSON output')
        .addHelpText('after', '\nExit codes (SPEC §10): 0 the state was reported (on or off), 1 a policy file exists but ' +
        'the resolver rejects it, 2 could not run (no repository).')
        .action((options) => {
        printStatus(runAutoStatus(process.cwd()), options.json === true);
    });
    auto
        .command('on')
        .description('enable unattended capture (writes mode "auto" and unattended true)')
        .option('--json', 'emit structured JSON output')
        .option('--local', `write ${POLICY_LOCAL_FILE_NAME} instead of the committed file`)
        .addHelpText('after', `\n--local writes ${POLICY_LOCAL_FILE_NAME}, which wins per key over the committed ` +
        'file and is untracked by convention — use it to differ from the repository without ' +
        'leaving a modified tracked file behind (#709). Once that file exists it is written ' +
        'by default, so --local is only needed to create it.' +
        '\n\nExit codes (SPEC §10): 0 written, or already on and unchanged, 2 could not run (no ' +
        'repository, a rejected policy file that will not be overwritten, or the write failed).')
        .action((options) => {
        printSet(runAutoSet(process.cwd(), true, { local: options.local === true }), true, options.json === true);
    });
    auto
        .command('off')
        .description('disable unattended capture (keeps the mode the repository chose)')
        .option('--json', 'emit structured JSON output')
        .option('--local', `write ${POLICY_LOCAL_FILE_NAME} instead of the committed file`)
        .addHelpText('after', '\nExit codes (SPEC §10): 0 written, or already off and unchanged, 2 could not run (no ' +
        'repository, a rejected policy file that will not be overwritten, or the write failed).')
        .action((options) => {
        printSet(runAutoSet(process.cwd(), false, { local: options.local === true }), false, options.json === true);
    });
    // cli.ts applies exitOverride to top-level commands only; without this a bad
    // flag on a nested subcommand exits 1 (commander's default) instead of the
    // SPEC §10 usage code 2.
    for (const subcommand of auto.commands)
        subcommand.exitOverride();
};
//# sourceMappingURL=auto.js.map