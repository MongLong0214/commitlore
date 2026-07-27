/**
 * `commitlore inject` (T-402): the push side of consumption (ADR-0006).
 *
 *   commitlore inject --path <p>            the projection, as text
 *   commitlore inject --path <p> --json     the projection, with its cache key
 *   commitlore inject --hook-input          read a PreToolUse payload on stdin
 *   commitlore inject install-claude-hook   wire it into a Claude settings.json
 *
 * The engine is `core/inject.ts` and every decision lives there; this file is
 * the impure shell — argument parsing, stdin, and the two output shapes.
 *
 * Exit status is 0 when a path has nothing to say, and the output is empty. A
 * hook that fired on a file with no records must cost the agent nothing, and a
 * non-zero exit would turn "nothing to know here" into a failed tool call on
 * most of a repository (SPEC §4: a commit that recorded nothing is not an
 * error). Exit 2 is reserved for the other thing an empty answer could mean —
 * a usage error, where the command never managed to ask the question at all.
 */
import type { Command } from 'commander';
import { type InjectOptions } from '../core/inject.js';
/**
 * The whole hook path except reading stdin, so it can be exercised with a
 * payload rather than with a file descriptor. Invalid input is diagnosed on
 * stderr while a valid path with no records remains silent on both streams.
 */
export interface HookResult {
    stdout: string;
    stderr: string;
    exitCode: 0;
}
export declare const hookResult: (raw: string, base: Omit<InjectOptions, "path"> & {
    cwd: string;
}) => HookResult;
export declare const hookResponse: (raw: string, base: Omit<InjectOptions, "path"> & {
    cwd: string;
}) => string;
export declare const register: (program: Command) => void;
