/**
 * `commitlore demo` — T-1011 (#203).
 *
 * Creates a temporary Git repository, populates it with the fixture scenario
 * from T-1010, runs init + a path query showing lifecycle filtering, prints the
 * result, and removes the temporary directory.
 *
 * Safety properties:
 * - Never writes into the user's repository (all git ops use explicit cwd)
 * - Removes its temporary directory even on failure or interrupt
 * - Needs no network and no model
 * - On unsupported platforms, prints a reason and exits non-zero
 */
import type { Command } from 'commander';
export interface DemoOptions {
    cwd?: string;
    /**
     * Directory the temporary repository is created under. Defaults to the
     * process-wide temp dir, which is what the CLI uses. A caller that needs to
     * assert the temporary directory was removed passes a root it owns: read
     * against the shared tmpdir, that assertion answers for every process on the
     * machine, not for this call (#364).
     */
    tmpRoot?: string;
    /** For testing: override the detected platform. */
    platformOverride?: string;
    /** For testing: throw mid-execution to verify cleanup. */
    crashTest?: boolean;
}
export interface DemoResult {
    exitCode: number;
    output: string;
}
/**
 * Runs the demo scenario in a temporary repository.
 *
 * The function is async-shaped for future flexibility but executes
 * synchronously today (no network, no model).
 */
export declare const runDemo: (opts?: DemoOptions) => Promise<DemoResult>;
export declare const register: (program: Command) => void;
