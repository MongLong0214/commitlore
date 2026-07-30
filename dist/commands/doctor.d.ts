/**
 * `commitlore doctor` — is this repository able to carry and share records?
 *
 * The mirror in `refs/notes/commitlore` (ADR-0004) only reaches a teammate if
 * their clone is configured to fetch it, which git does not do by default. A
 * clone that skips that step reads an empty mirror and reports "no record" for
 * commits that have one — a silent wrong answer, the most expensive kind here.
 * doctor exists to turn that into a visible, fixable finding.
 *
 * Two boundaries are deliberate:
 *
 * - `--fix` only writes reversible local config (`remote.<name>.fetch`).
 *   Pushing notes is a network write to a shared ref, so doctor prints the
 *   command and lets a human run it.
 * - The commit-msg hook is *reported*, never installed. `commitlore hooks
 *   install` (T-202) owns that file; doctor only reads it.
 *
 * `checkSquashConservation` (ADR-0014, bug-issue-60 finding 1) is the same
 * shape of problem one route over: nothing runs `squash-preserve`
 * automatically, and a squash that happened without it silently drops
 * records the same way an unfetched mirror silently drops them. It is a
 * `doctor` check rather than a CI step because it runs at the moment the
 * mistake is still local and cheap to fix — see the check's own doc comment
 * for the full "Ruled-out" reasoning.
 */
import { type SpawnSyncReturns } from 'node:child_process';
import type { Command } from 'commander';
/**
 * `skipped` is a check that exists but has nothing to inspect yet — it is not
 * a pass. `fail` means the tool cannot work correctly here; `warn` means the
 * setup is incomplete but nothing gives a wrong answer locally.
 */
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped';
export interface DoctorCheck {
    id: string;
    title: string;
    status: CheckStatus;
    needsAttention: boolean;
    detail: string;
    /** What makes this check `ok`, or `null` when nothing needs doing. */
    fix: string | null;
    /** Whether this run's `--fix` changed something for this check. */
    fixed: boolean;
}
export interface DoctorReport {
    checks: DoctorCheck[];
    /** 0 unless some check is `fail` — warnings do not fail the command (SPEC §10: 1 is a finding). */
    exitCode: number;
}
export interface DoctorOptions {
    cwd?: string;
    /** Apply the reversible local config fixes. */
    fix?: boolean;
}
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
    title: string;
    executable: string;
    path: string;
    fix: string;
    unavailableFix: string;
}) => DoctorCheck;
export declare const runDoctor: (opts?: DoctorOptions) => DoctorReport;
export declare const formatReport: (report: DoctorReport) => string;
export declare const register: (program: Command) => void;
