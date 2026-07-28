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
export declare const runDoctor: (opts?: DoctorOptions) => DoctorReport;
export declare const formatReport: (report: DoctorReport) => string;
export declare const register: (program: Command) => void;
