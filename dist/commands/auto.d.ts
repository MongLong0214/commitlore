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
import type { Command } from 'commander';
import { type CaptureMode, type PolicyKey } from '../core/capture-policy.js';
export interface AutoStatusResult {
    /** False when a policy file exists but the resolver rejects it. */
    ok: boolean;
    /** The unattended setting in effect, or null when the file is rejected. */
    unattended: boolean | null;
    /** The mode in effect, or null when the file is rejected. */
    mode: CaptureMode | null;
    /**
     * Which layer had the last word: the built-in defaults (no file), the
     * committed file, or this machine's overlay (#709).
     */
    source: 'defaults' | 'repository' | 'local';
    /** Absolute path of the committed policy file, or null outside a repository. */
    path: string | null;
    /** Absolute path of the overlay when one exists; null when none does. */
    localPath: string | null;
    /**
     * Keys where the overlay differs from the committed file. Empty without an
     * overlay, and empty with one that restates what it overlays — a reader
     * comparing two files needs the disagreement, not the list of keys set.
     */
    overridden: readonly PolicyKey[];
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
    /** Absolute path of the file that was written, or null outside a repository. */
    path: string | null;
    /** Which file that is: the committed policy, or this machine's overlay (#709). */
    scope: 'repository' | 'local';
    mode: CaptureMode | null;
    /** The mode before the change — named when `on` had to move it to `auto`. */
    previousMode: CaptureMode | null;
    error: string | null;
}
/** `auto status` — what is set now, and where the file is. Never writes. */
export declare const runAutoStatus: (cwd: string) => AutoStatusResult | {
    outsideRepository: true;
};
/** `auto on` / `auto off` — write the setting coherently, or say why not. */
export declare const runAutoSet: (cwd: string, enabled: boolean, opts?: {
    local?: boolean;
}) => AutoSetResult | {
    outsideRepository: true;
};
export declare const register: (program: Command) => void;
