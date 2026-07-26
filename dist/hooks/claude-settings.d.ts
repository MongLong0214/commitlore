/**
 * The Claude Code side of the injection hook (T-402, ADR-0006 decision 1):
 * writing a `PreToolUse` entry into a `settings.json` so that opening or
 * editing a file delivers that path's active records first.
 *
 * This module edits a file somebody else owns, and that governs every rule in
 * it:
 *
 * - **It never overwrites what it cannot read.** A `settings.json` that does
 *   not parse is a file with something valuable in it that this build does not
 *   understand. Installing over it would destroy a configuration to add a
 *   convenience, so a parse failure stops the install and says so.
 * - **It merges, it does not replace.** Every other key, every other hook, and
 *   every unknown field inside the entries it does touch survive untouched.
 * - **It is idempotent.** Our entry is identified by a fixed marker inside the
 *   command string, so installing twice leaves exactly one — "ours" is a fact
 *   about the file, not a guess about how many times somebody ran the command.
 *
 * The marker lives in the command rather than in a field of its own because
 * `settings.json` is validated against a schema this project does not control:
 * a trailing `# commitlore-inject-hook` is a shell comment to the runner, an
 * unambiguous identity to us, and a field nobody's validator has to know about.
 */
/** The hook event that fires before a tool runs (PRD-F4 requirement 2). */
export declare const CLAUDE_HOOK_EVENT = "PreToolUse";
/** The tools that touch a path, and therefore the tools worth injecting for. */
export declare const CLAUDE_HOOK_MATCHER = "Read|Edit|Write";
/** How our entry is recognised. A shell comment to the runner, identity to us. */
export declare const CLAUDE_HOOK_MARKER = "# commitlore-inject-hook";
/** The command the hook runs. `--hook-input` reads the event payload on stdin. */
export declare const CLAUDE_HOOK_COMMAND = "commitlore inject --hook-input # commitlore-inject-hook";
/** Where the command writes when the caller names no file. */
export declare const claudeSettingsPath: (cwd: string) => string;
/**
 * `installed` — our entry, current. `outdated` — our entry, different command
 * (an older build, or a `--command` override). `conflicting` — more than one of
 * ours, which only a hand-edit produces and which an install collapses back to
 * one. `unreadable` — the file exists but this build will not touch it.
 */
export type ClaudeHookState = 'absent' | 'installed' | 'outdated' | 'conflicting' | 'unreadable';
export interface ClaudeHookStatus {
    settingsPath: string;
    state: ClaudeHookState;
    /** Entries carrying our marker. */
    entries: number;
    /** The commands currently installed under our marker, in file order. */
    commands: string[];
    /** Why the file is `unreadable`. */
    problem?: string;
}
export interface ClaudeHookInput {
    settingsPath: string;
    /** Overrides the installed command. Must carry `CLAUDE_HOOK_MARKER`. */
    command?: string;
    matcher?: string;
}
export interface ClaudeHookResult {
    code: 0 | 2;
    stdout: string;
    stderr: string;
    status?: ClaudeHookStatus;
    /** Whether the file on disk changed. */
    changed: boolean;
}
export declare const readClaudeHookStatus: (settingsPath: string, command?: string) => ClaudeHookStatus;
export declare const installClaudeHook: (input: ClaudeHookInput) => ClaudeHookResult;
export declare const uninstallClaudeHook: (input: ClaudeHookInput) => ClaudeHookResult;
export declare const claudeHookStatus: (input: ClaudeHookInput) => ClaudeHookResult;
