/**
 * The `git-trailers` doctor check.
 *
 * It owns the runtime capability probe because only this check judges Git's
 * trailer parser; the probe message and report factory remain shared model data.
 */
import { type DoctorCheck, type DoctorOptions } from '../model.js';
/**
 * Runs the real parse path once. Trailer boundaries are git's to decide
 * (SPEC §2), so a git that cannot do this makes every other answer suspect —
 * the one condition that fails the command.
 *
 * The probe runs in the process's own directory rather than `cwd`: it tests
 * the git binary on `PATH` and this codebase's parse path, neither of which is
 * a property of the repository being inspected.
 */
export declare const checkGit: (opts: DoctorOptions) => DoctorCheck;
