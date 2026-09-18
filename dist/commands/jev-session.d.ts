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
import type { Command } from 'commander';
import type { ClaudeHookKind } from '../hooks/claude-settings.js';
/** The event the hook is installed under. */
export declare const JEV_SESSION_HOOK_EVENT = "SessionStart";
/** How our entry is recognised in someone else's settings file. */
export declare const JEV_SESSION_HOOK_MARKER = "# commitlore-jev-session-hook";
export declare const JEV_SESSION_HOOK_COMMAND = "commitlore jev-session --hook-input # commitlore-jev-session-hook";
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
export declare const JEV_SESSION_HOOK: ClaudeHookKind;
export interface JevSessionResult {
    readonly code: 0;
    readonly stdout: string;
    readonly stderr: string;
}
export interface RunJevSessionInput {
    /** The raw hook payload. */
    readonly payload: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    /** Overrides the payload's own `cwd`; tests use it, hooks do not. */
    readonly cwd?: string;
    readonly verbose?: boolean;
}
/**
 * Registers one session, or says why it did not.
 *
 * The payload's `cwd` is used rather than the process's: a `SessionStart` hook
 * may run from anywhere, and the field is what the host says the session is
 * working in. A payload that names no cwd is not guessed at.
 */
export declare const runJevSession: (input: RunJevSessionInput) => JevSessionResult;
export declare const register: (program: Command) => void;
