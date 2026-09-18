/**
 * The `SessionStart` side of the one supported source — #1049.
 *
 * A Claude Code `SessionStart` hook runs `commitlore jev-session --hook-input`,
 * which reads the event payload on stdin and writes one small descriptor binding
 * this session id to this working tree and its transcript. That descriptor is
 * the only thing that lets a `commit-msg` hook, later and in a different
 * process, know which transcript belongs to the session that is committing.
 *
 * ## Activation is checked first, and that is the whole no-key guarantee
 *
 * Without a usable key, or with `COMMITLORE_JEV=off`, this exits 0 having
 * written nothing, read no transcript and printed nothing. A default
 * installation can have this hook wired and still be observably inert — which
 * matters because `init` may wire it, and a user who never sets a key must not
 * acquire files, warnings or transcript reads from that.
 *
 * ## Why it exits 0 on every failure
 *
 * It is a session hook, not a gate. A non-zero exit from a `SessionStart` hook
 * is noise in somebody's editor about an optional prototype that did not
 * register. The reason is printed only when the caller asks for it.
 */
import { readFileSync } from 'node:fs';
import { resolveJevActivation } from '../jev/activation.js';
import { registerClaudeSession } from '../jev/source-claude.js';
/** The event the hook is installed under. */
export const JEV_SESSION_HOOK_EVENT = 'SessionStart';
/** How our entry is recognised in someone else's settings file. */
export const JEV_SESSION_HOOK_MARKER = '# commitlore-jev-session-hook';
export const JEV_SESSION_HOOK_COMMAND = `commitlore jev-session --hook-input ${JEV_SESSION_HOOK_MARKER}`;
/**
 * The entry `init` installs, described for `claude-settings.ts`.
 *
 * Reuses that module's merge discipline rather than a second implementation of
 * it: an unreadable settings file still stops the install, every foreign hook
 * and unknown field still survives, and the marker still makes a second install
 * a no-op. Its matcher is `startup|resume` — the two transitions #1049 says
 * provide an unambiguous binding; a `clear`, `compact` or `fork` does not, and
 * one of those reports source unavailable rather than guessing.
 */
export const JEV_SESSION_HOOK = {
    event: JEV_SESSION_HOOK_EVENT,
    marker: JEV_SESSION_HOOK_MARKER,
    command: JEV_SESSION_HOOK_COMMAND,
    matcher: 'startup|resume',
    label: 'Jev source registration',
};
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const quiet = () => ({ code: 0, stdout: '', stderr: '' });
/**
 * Registers one session, or says why it did not.
 *
 * The payload's `cwd` is used rather than the process's: a `SessionStart` hook
 * may run from anywhere, and the field is what the host says the session is
 * working in. A payload that names no cwd is not guessed at.
 */
export const runJevSession = (input) => {
    const env = input.env ?? process.env;
    // Before any parse, any filesystem access and any print.
    if (!resolveJevActivation(env).enabled)
        return quiet();
    let parsed;
    try {
        parsed = JSON.parse(input.payload);
    }
    catch {
        return input.verbose === true
            ? { code: 0, stdout: '', stderr: 'commitlore: the SessionStart payload was not JSON\n' }
            : quiet();
    }
    if (!isRecord(parsed))
        return quiet();
    const sessionId = typeof parsed['session_id'] === 'string' ? parsed['session_id'].trim() : '';
    const transcript = typeof parsed['transcript_path'] === 'string' ? parsed['transcript_path'].trim() : '';
    const payloadCwd = typeof parsed['cwd'] === 'string' ? parsed['cwd'].trim() : '';
    const cwd = input.cwd ?? (payloadCwd === '' ? '' : payloadCwd);
    if (sessionId === '' || transcript === '' || cwd === '')
        return quiet();
    // A subagent's SessionStart carries the same shape and is not the root actor.
    // `agent_id`/`agent_type` are present only under `--agent` or inside a
    // subagent, which makes their absence the check rather than a name match.
    if (parsed['agent_id'] !== undefined || parsed['agent_type'] !== undefined)
        return quiet();
    const result = registerClaudeSession({ cwd, sessionId, transcriptPath: transcript });
    if (result.status === 'registered') {
        return input.verbose === true
            ? { code: 0, stdout: `commitlore: registered the Jev source for this session\n`, stderr: '' }
            : quiet();
    }
    return input.verbose === true
        ? { code: 0, stdout: '', stderr: `commitlore: no Jev source registered (${result.reason})\n` }
        : quiet();
};
const readStdin = () => {
    try {
        // `0` is stdin. A hook is handed its payload there and nowhere else, and a
        // read that fails is an empty payload rather than a thrown hook.
        return readFileSync(0, 'utf8');
    }
    catch {
        return '';
    }
};
export const register = (program) => {
    program
        .command('jev-session')
        .description('internal hook command: register this host session as an optional Jev source')
        .option('--hook-input', 'read the SessionStart payload from stdin')
        .option('--verbose', 'say what happened (a hook is silent by default)')
        .addHelpText('after', '\nWired as a Claude Code SessionStart hook. Inert without COMMITLORE_JEV_API_KEY:' +
        '\nwith no key it writes nothing, reads no transcript and prints nothing.')
        .action((flags) => {
        const result = runJevSession({
            payload: flags.hookInput === true ? readStdin() : '',
            ...(flags.verbose === undefined ? {} : { verbose: flags.verbose }),
        });
        if (result.stdout !== '')
            process.stdout.write(result.stdout);
        if (result.stderr !== '')
            process.stderr.write(result.stderr);
    });
};
//# sourceMappingURL=jev-session.js.map