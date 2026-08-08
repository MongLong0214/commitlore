/**
 * `commitlore sync` — publish and collect the notes mirror (#416).
 *
 * The `pre-push` hook runs this automatically, and that is how it is meant to
 * be reached: after `commitlore init`, a `git push` carries the records with
 * the code they describe and nobody types this command. It exists as a command
 * for the cases the hook cannot cover — a repository whose hooks were never
 * installed, a mirror that needs collecting without a push, and finding out
 * what would happen before it does.
 */
import type { Command } from 'commander';
interface SyncCommandOptions {
    cwd?: string;
    remote?: string[];
    fetchOnly?: boolean;
    dryRun?: boolean;
    json?: boolean;
}
/** Exit 2 when a remote needs a human. Everything else is 0. */
export declare const SYNC_ATTENTION_EXIT = 2;
export declare const runSync: (options?: SyncCommandOptions) => {
    code: number;
    stdout: string;
};
export declare const register: (program: Command) => void;
export {};
