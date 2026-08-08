/**
 * The `inject-runtime` doctor check.
 *
 * It owns the configured PreToolUse execution probe and its deterministic
 * result evaluation; version comparison remains a separate sibling check.
 */
import { type SpawnSyncReturns } from 'node:child_process';
import { type Category, type DoctorCheck, type DoctorOptions } from '../model.js';
/**
 * Turns a completed (or attempted) probe run into this check's verdict.
 *
 * Split out from `checkInjectRuntime` so the *decision* — not the race that
 * can accompany it — is what a test exercises directly with a synthetic
 * `spawnSync` result.
 *
 * `spawnSync`'s `input` option writes the probe payload to the child's stdin
 * after the child is already running. A child that never reads stdin (every
 * fixture here, and plenty of real hooks) routinely exits and closes that
 * pipe before Node finishes the write, which fails with EPIPE — on a shared,
 * contended runner far more often than on a quiet laptop, which is why this
 * was invisible locally and ~15-25% flaky in CI (reproduced against the
 * actual CI Node 22 and 24 images). Node still reports the real
 * `status`/`stdout`/`stderr` of a process that ran to completion on the same
 * result object that carries that `error` — the write failing is not the
 * same thing as the hook failing to run. Treating `run.error !== undefined`
 * as "could not run" discarded that real status and reported a working hook
 * as broken (and, for the two doctor.test.ts fixtures that *are* meant to
 * fail, reported the wrong reason).
 *
 * `run.status` is `null` only when no process was ever created (an ENOENT
 * from an unresolvable executable, a permissions failure, ...), which is the
 * one condition this function still treats as "could not run".
 *
 * Exported so a test can hand it a synthetic `SpawnSyncReturns` (a real
 * status alongside a real EPIPE error) and assert on the decision
 * deterministically, without depending on the race actually firing.
 */
export declare const evaluateInjectRun: (run: SpawnSyncReturns<string>, ctx: {
    id: string;
    category: Category;
    title: string;
    executable: string;
    path: string;
    fix: string;
    unavailableFix: string;
}) => DoctorCheck;
export declare const checkInjectRuntime: (opts: DoctorOptions) => DoctorCheck;
