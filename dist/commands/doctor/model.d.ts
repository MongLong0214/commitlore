/**
 * Doctor's model and construction seam.
 *
 * Check modules share the frozen report shapes, factory, and observation
 * helpers here so that each can own one diagnosis without reaching into a
 * sibling check. Construction stays central because status-derived fields and
 * non-empty evidence are report-wide invariants, not per-check conventions.
 */
/**
 * `skipped` is a check that exists but has nothing to inspect yet — it is not
 * a pass. `fail` means the tool cannot work correctly here; `warn` means the
 * setup is incomplete but nothing gives a wrong answer locally.
 */
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped';
/** The report-level verdict a JSON consumer can branch on. */
export type DoctorStatus = 'ok' | 'degraded' | 'failed';
/** How this CLI installation was reached, without probing the network. */
export type InstallSource = 'plugin' | 'npm' | 'npx' | 'source' | 'unknown';
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
    /** A consumer pins this schema id, not an incidental set of object keys. */
    schema: 'commitlore_doctor.v2';
    /** The CLI version that produced this report. */
    version: string;
    /** Derived once from the final completed rows. */
    status: DoctorStatus;
    /** The detected distribution channel for the running CLI. */
    installSource: InstallSource;
    /** The first actionable finding, or a status-appropriate no-action message. */
    headline: string;
    /** Counts and the sum of all per-check durations. */
    summary: {
        total: number;
        ok: number;
        warn: number;
        fail: number;
        skipped: number;
        durationMs: number;
    };
    /** Root causes in remediation order. */
    fixPlan: string[];
    /** Reserved for the filters ticket; omitted, never null, on a full run. */
    selection?: string[];
    checks: DoctorCheck[];
    /** 1 iff a non-optional check failed; degraded reports exit 0. */
    exitCode: number;
}
export interface DoctorOptions {
    cwd?: string;
    /** Apply the reversible local config fixes. */
    fix?: boolean;
}
/** Probe message for the git capability check — one trailer of each shape. */
export declare const PROBE_MESSAGE = "commitlore doctor probe\n\nLimit: probe\nBlast: local\n";
export declare const gitOptions: (opts: DoctorOptions) => {
    cwd?: never;
} | {
    cwd: string;
};
/** The bound keeps a broken child process from making a JSON report unbounded. */
export declare const boundedExcerpt: (output: string | null | undefined) => {
    firstLine: string;
    truncated: "true" | "false";
};
export declare const streamEvidence: (stream: string, output: string | null | undefined) => Record<string, string>;
export declare const evidenceKey: (value: string) => string;
export declare function check(id: string, category: Category, title: string, status: 'ok' | 'warn' | 'fail', detail: string, fix?: string | null, fixed?: boolean, needsAttention?: boolean, extra?: {
    evidence?: Record<string, string>;
    optional?: boolean;
    skipReason?: never;
}): DoctorCheck;
export declare function check(id: string, category: Category, title: string, status: 'skipped', detail: string, fix: string | null, fixed: boolean, needsAttention: boolean, extra: {
    evidence?: Record<string, string>;
    optional?: boolean;
    skipReason: SkipReason;
}): DoctorCheck;
export declare const blocked: (dependency: DoctorCheck, row: DoctorCheck) => DoctorCheck;
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
