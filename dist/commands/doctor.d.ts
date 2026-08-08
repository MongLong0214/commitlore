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
/**
 * The subsystem a check speaks for (PRD §2.1). A row that cannot name one
 * cannot be selected, grouped or rolled up, so it is supplied at construction
 * rather than looked up from the id afterwards — a lookup gives a new check a
 * silent default, and this makes omitting one a type error.
 */
export type Category = 'runtime' | 'transport' | 'capture' | 'delivery' | 'history' | 'index';
/**
 * Display-grade ordering only. **Never drives the exit code** (ADR-0032 §3).
 *
 * Derived from `status` at the single factory below and impossible to supply:
 * two axes that can disagree make every consumer resolve the disagreement, and
 * deriving at one chokepoint makes the inconsistency unrepresentable rather
 * than merely discouraged.
 */
export type Severity = 'error' | 'warning' | 'info';
/**
 * Why a check did not run, from a closed set (PRD §1.2). A skip whose reason is
 * free text is a skip nothing can act on. The union grows one member at a time
 * as sites are mapped.
 */
export type SkipReason = 'command_unrecognized' | 'hook_not_installed' | 'probe_path_unavailable' | 'version_unreadable' | 'unborn_head' | 'nothing_applicable';
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
    category: Category;
    /** Derived from `status`; never passed in, never read by the exit code. */
    severity: Severity;
    /**
     * The observation behind the conclusion. A row without one cannot explain
     * why its status is trustworthy, so construction rejects empty evidence.
     */
    evidence: Record<string, string>;
    /** No shipping check is optional at introduction (PRD §1.4). */
    optional: boolean;
    /** Absence preserves the additive JSON contract for findings that stand alone. */
    blockedBy?: string;
    /** Present only on `skipped`. Omitted, never null. */
    skipReason?: SkipReason;
    /**
     * Wall time for this check, whole milliseconds, never negative. Stamped by
     * the runner from a monotonic clock — PRD §10's budget is an assertion until
     * something measures it.
     */
    durationMs?: number;
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
    category: Category;
    title: string;
    executable: string;
    path: string;
    fix: string;
    unavailableFix: string;
}) => DoctorCheck;
/**
 * What a check is given. `memo` exists for the one dependency this file has
 * always had: `commit-msg-hook` consumes `hook-runtime`'s result, and both are
 * rows. The runner emits in registry order — where `commit-msg-hook` presents
 * first — so the dependency cannot be satisfied by running earlier entries and
 * reading their output. Memoising the computation keeps "each check runs
 * exactly once" true without reordering the report.
 */
export interface DoctorContext {
    readonly opts: DoctorOptions;
    /** Monotonic, for `durationMs`. A wall clock can go backwards. */
    readonly now: () => bigint;
    readonly memo: Map<string, DoctorCheck>;
}
/**
 * A check as data rather than a position in a hand-written array.
 *
 * What that buys, and why it is worth the indirection (ADR-0032 §4): ordering
 * becomes something a test can assert, `--only`/`--category` become filters
 * over data instead of new code paths, each `run` is testable in isolation, and
 * the dependencies that exist implicitly today get a declared place.
 */
export interface CheckDefinition {
    readonly id: string;
    readonly title: string;
    readonly category: Category;
    /** Ids of entries that appear earlier in this registry (PRD §2 req 2). */
    readonly dependencies: readonly string[];
    readonly optional: boolean;
    readonly run: (ctx: DoctorContext, dependencies: ReadonlyMap<string, DoctorCheck>) => DoctorCheck;
}
/**
 * The registry. **Order is the report's order**, frozen to the array
 * `runDoctor` shipped with, because PRD §9.1 holds the text byte-identical
 * until the rendering ticket.
 *
 * `commit-msg-hook → hook-runtime` stays in the runner's memo because the
 * frozen presentation order puts the consumer first. Declaring it backwards
 * would make the registry claim an ordering guarantee it cannot keep.
 */
export declare const CHECK_REGISTRY: readonly CheckDefinition[];
export declare const runDoctor: (opts?: DoctorOptions) => DoctorReport;
export declare const formatReport: (report: DoctorReport) => string;
export declare const register: (program: Command) => void;
