/**
 * How a run ended.
 *
 * The distinction between an *enforced* stop and an *observed* overrun is
 * deliberate. The installed `claude` CLI has no `--max-turns`, so a per-task
 * turn budget cannot be applied in flight: the run finishes on its own and the
 * harness notices afterwards that it went over. Labelling that `turns` read as
 * "the cap stopped it", which is how a row with turns=11 under a cap of 6 gets
 * misread as a cap of 11.
 *
 * - `completed`   — the agent finished within every budget
 * - `timeout`     — wall clock elapsed and the harness killed the process (enforced)
 * - `over-turns`  — finished on its own, having exceeded the turn budget (observed)
 * - `over-tokens` — the global token cap was exhausted (enforced between runs, observed within one)
 * - `error`       — driver or setup failure; the run produced no usable measurement
 */
export type StopReason = "completed" | "timeout" | "over-turns" | "over-tokens" | "error";

export type MatcherKind = "literal" | "regex";

/**
 * Which text the matcher is applied to. `artifacts` is diff + commits — what the
 * agent actually built — and is the default for re-proposal detection: a
 * transcript match cannot tell "use Redis" from "Redis was ruled out, so I will
 * not", and that false positive only ever fires in the injected arm.
 */
export type MatchSurface = "transcript" | "diff" | "commits" | "artifacts" | "any";

export interface Matcher {
  readonly kind: MatcherKind;
  readonly value: string;
  readonly in?: MatchSurface;
  /** Regex flags. Ignored for `literal`. Default `i`. */
  readonly flags?: string;
  /** Human label recorded in `matched[]`. Defaults to `kind:value`. */
  readonly label?: string;
}

export interface MatcherGroup {
  readonly any_of?: readonly Matcher[];
  readonly all_of?: readonly Matcher[];
}

export interface DetectSpec {
  readonly reproposed_if: MatcherGroup;
  readonly violation_if?: MatcherGroup;
}

export interface SeedCommit {
  readonly files: Readonly<Record<string, string>>;
  readonly message: string;
}

export type RepoKind = "synthetic" | "fixture";

export interface RepoSpec {
  readonly kind: RepoKind;
  /** `fixture` only — directory copied into the workspace, relative to the repo root. */
  readonly path?: string;
  readonly seed_commits?: readonly SeedCommit[];
}

export interface Budget {
  readonly turns: number;
  readonly tokens: number;
}

export interface Task {
  readonly id: string;
  readonly description: string;
  readonly repo: RepoSpec;
  readonly prompt: string;
  readonly detect: DetectSpec;
  readonly budget: Budget;
  readonly source_file: string;
}

/**
 * A condition is an open string enum: M4 (T-703) adds the ablation arms without
 * touching the runner. `status: "planned"` arms are rejected at CLI parse time.
 */
export interface ConditionSpec {
  readonly id: string;
  readonly status: "supported" | "planned";
  readonly description: string;
  /**
   * Whether the seeded commits keep their trailer block at all. A live off-arm
   * run read the records straight out of `git log` and cited them, so a control
   * that merely withholds injection is not a control — it has to be a repository
   * where nobody ever wrote a record.
   */
  readonly seed_records: boolean;
  readonly inject_records: boolean;
  readonly injection_scope: "route-scoped" | "global";
  /** SPEC §7 — `Warn:` renders as instruction only for trusted `authored` records. */
  readonly apply_grading: boolean;
  /** SPEC §7 — drop superseded/expired records before injection. */
  readonly apply_lifecycle: boolean;
}

export const CONDITIONS: Readonly<Record<string, ConditionSpec>> = {
  "commitlore-on": {
    id: "commitlore-on",
    status: "supported",
    description: "Records in history, assembled and injected before the task prompt",
    seed_records: true,
    inject_records: true,
    injection_scope: "route-scoped",
    apply_grading: true,
    apply_lifecycle: true,
  },
  "commitlore-off": {
    id: "commitlore-off",
    status: "supported",
    description: "Identical code, no records anywhere in history — the control arm",
    seed_records: false,
    inject_records: false,
    injection_scope: "route-scoped",
    apply_grading: true,
    apply_lifecycle: true,
  },
  "records-uninjected": {
    id: "records-uninjected",
    status: "planned",
    description:
      "Records in history but never injected — isolates injection from the agent reading git log itself. Needs an ADR-0007 decision before it counts as an arm.",
    seed_records: true,
    inject_records: false,
    injection_scope: "route-scoped",
    apply_grading: true,
    apply_lifecycle: true,
  },
  "no-scope": {
    id: "no-scope",
    status: "planned",
    description: "Ablation (T-703): dump every trailer instead of route-scoped injection",
    seed_records: true,
    inject_records: true,
    injection_scope: "global",
    apply_grading: true,
    apply_lifecycle: true,
  },
  "no-grade": {
    id: "no-grade",
    status: "planned",
    description: "Ablation (T-703): skip trust grading — every Warn renders as instruction",
    seed_records: true,
    inject_records: true,
    injection_scope: "route-scoped",
    apply_grading: false,
    apply_lifecycle: true,
  },
  "no-lifecycle": {
    id: "no-lifecycle",
    status: "planned",
    description: "Ablation (T-703): inject superseded and expired records too",
    seed_records: true,
    inject_records: true,
    injection_scope: "route-scoped",
    apply_grading: true,
    apply_lifecycle: false,
  },
};

export const SUPPORTED_CONDITIONS: readonly string[] = Object.values(CONDITIONS)
  .filter((c) => c.status === "supported")
  .map((c) => c.id);

/** One line of `bench/results/*.jsonl`. Field names are the serialized names. */
export interface RunRecord {
  readonly run_id: string;
  readonly task: string;
  readonly cond: string;
  readonly seed: number;
  readonly reproposed: boolean;
  readonly violations: number;
  readonly turns: number;
  readonly tokens: number;
  readonly stopped_by: StopReason;
  readonly duration_ms: number;
  readonly driver: string;
  readonly started_at: string;
  /** True when the driver fabricated the transcript. Simulated rows are never evidence. */
  readonly simulated: boolean;
  readonly matched?: readonly string[];
  readonly error?: string;
}
