/**
 * `commitlore commit-guard --hook-input` — the gate, wired to a real repository.
 *
 * The decision lives in `core/commit-guard.ts` and is pure. This is the impure
 * half: reading the hook payload, answering git, and turning a verdict into the
 * two things a `PreToolUse` hook can say.
 *
 * **Exit 2 refuses; everything else allows.** Claude Code reads an exit-2
 * hook's stderr back to the agent and blocks the call, which is exactly the
 * shape this needs — the agent hears why and what to do instead, and the
 * developer is not prompted. Exit 1 is deliberately never produced: its stderr
 * goes to the developer rather than the agent, so a crash would become noise a
 * person has to read instead of the silence a fail-open should be.
 *
 * Every question asked of git is asked only after the command is known to
 * contain a commit, so the ordinary Bash call — which is most of them — costs a
 * substring search and no subprocess at all.
 */
import type { Command } from 'commander';
import { type GuardWorld } from '../core/commit-guard.js';
export interface HookCall {
    readonly command: string;
    readonly cwd: string;
}
/**
 * The command and the directory, or null when this payload is not a Bash call
 * this gate should read.
 *
 * Null for everything it does not understand, which is an allow: a payload
 * shape that changed, a tool that is not Bash, a call with no command. The gate
 * has no business refusing what it cannot read.
 */
export declare const hookCall: (raw: string, fallbackCwd: string) => HookCall | null;
/** The real world: git, the policy file and the consideration on disk. */
export declare const liveWorld: () => GuardWorld;
export declare const register: (program: Command) => void;
