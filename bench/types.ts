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
/**
 * `code` is the surface a re-proposal detector should use: added diff lines
 * with documentation files and comments removed, so that implementing an
 * alternative counts and explaining that it was avoided does not. See
 * `codeText` in `detect.ts` and `bench/DETECTOR-DEFECT.md`.
 */
export type MatchSurface = "transcript" | "diff" | "commits" | "code" | "artifacts" | "any";

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
  "commitlore-guard": {
    id: "commitlore-guard",
    status: "supported",
    description:
      "Records in history, delivered through `commitlore guard` at edit time — the route SPEC §5 assigns to `Ruled-out:` and the only one never measured. Advisory: it reports what an edit revives and lets the edit through. `inject_records` is false because this arm injects nothing; the records reach the agent as a guard warning or not at all.",
    seed_records: true,
    inject_records: false,
    injection_scope: "route-scoped",
    apply_grading: true,
    apply_lifecycle: true,
  },

  "no-scope": {
    id: "no-scope",
    status: "supported",
    description:
      "Ablation (T-703): dump every trailer raw instead of the routed projection. NAME OVERSTATES IT — this removes the projection, not the path scope. `assembleContext` injects once before the agent has a path, so there is no scope to remove; both renderings already carry every record in the repository. Measuring path scoping needs per-path injection at tool time (the PreToolUse hook in the workspace). See bench/README.md.",
    seed_records: true,
    inject_records: true,
    injection_scope: "global",
    apply_grading: true,
    apply_lifecycle: true,
  },
  "no-grade": {
    id: "no-grade",
    status: "supported",
    description:
      "Ablation (T-703): skip trust grading — every Warn renders as instruction. Inert on a task whose records are all `Provenance: authored`, because there is nothing to promote.",
    seed_records: true,
    inject_records: true,
    injection_scope: "route-scoped",
    apply_grading: false,
    apply_lifecycle: true,
  },
  "no-lifecycle": {
    id: "no-lifecycle",
    status: "supported",
    description:
      "Ablation (T-703): inject superseded and expired records too. Inert on a task that seeds no `Supersedes:` and no `Expires:`, because there is nothing to resurrect.",
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

/**
 * The two arms of the primary comparison, which is what `--cond both` means and
 * has always meant.
 *
 * It is spelled out rather than derived, because it used to be derivable: while
 * the ablation arms were `planned`, "every supported condition" and "the two
 * arms of the hypothesis test" were the same list, and `both` and `all` were
 * the same flag. T-703 made three more arms supported, and a `both` that
 * quietly grew from two arms to five would have turned a re-run of the
 * registered comparison into a bill for two and a half times the runs.
 */
export const PRIMARY_CONDITIONS: readonly string[] = ["commitlore-on", "commitlore-off"];

/**
 * Alternative delivery routes: the same records, reaching the agent another way.
 *
 * `commitlore-guard` is not an ablation. Nothing is removed from it — it sends
 * `Ruled-out:` through the route SPEC §5 assigns to that key instead of through
 * injection (§14, #37).
 */
export const ROUTE_CONDITIONS: readonly string[] = ["commitlore-guard"];

/**
 * The ablation arms (T-703): the projection minus one guarantee each.
 *
 * Named rather than derived as "everything that is not primary". That
 * derivation was correct while ablations were the only other kind of arm, and
 * it silently reclassified the guard route as an ablation the moment one was
 * added — which would have put a route comparison into an ablation report.
 */
export const ABLATION_CONDITIONS: readonly string[] = SUPPORTED_CONDITIONS.filter(
  (id) => !PRIMARY_CONDITIONS.includes(id) && !ROUTE_CONDITIONS.includes(id),
);

/** One line of `bench/results/*.jsonl`. Field names are the serialized names. */
export interface RunRecord {
  readonly run_id: string;
  /** The commit the harness was run from, resolved once at startup. */
  readonly harness_commit: string;
  /** sha256 of the dist tree the hook actually executed, read once at startup. */
  readonly dist_digest: string;
  readonly task: string;
  readonly cond: string;
  readonly seed: number;
  readonly model?: string;
  readonly reproposed: boolean;
  readonly reproposal_matches?: number;
  readonly violations: number;
  readonly turns: number;
  readonly tokens: number;
  readonly stopped_by: StopReason;
  readonly duration_ms: number;
  readonly driver: string;
  readonly started_at: string;
  /** True when the driver fabricated the transcript. Simulated rows are never evidence. */
  readonly simulated: boolean;
  readonly guard_exposure?: GuardExposure;
  readonly matched?: readonly string[];
  readonly error?: string;

  // --- CPAA instrumentation (ADR-0007 "운영 지표"; PRD-F7 requirement 3) ---
  //
  // CPAA = (harvest tokens + verify tokens) / accepted records: what one record
  // that survives verification costs to produce. It prices the *writing* side of
  // CommitLore, which is a different pipeline from the one every other field
  // here measures — those all describe the agent solving the task.
  //
  // All three are optional and are read as a unit: `metrics.ts` counts a row
  // toward CPAA only when it carries all of them, because a row with a
  // denominator and no numerator would divide records that were accepted by a
  // cost that was never recorded and call the result cheap. A row that carries
  // none is reported as "not instrumented", which is not the same statement as
  // a CPAA of zero.

  /** Model tokens the harvest step spent drafting records for this run. */
  readonly harvest_tokens?: number;
  /**
   * Model tokens the verification step spent checking those drafts.
   *
   * Structurally zero for the shipped verifier — `core/harvest-verify.ts` is
   * deterministic and calls no model — but a *measured* zero is a different
   * claim from an absent field, and the design could change.
   */
  readonly verify_tokens?: number;
  /**
   * Records present in the repository this run started from — the denominator
   * CPAA divides its harvest cost by, and the reason CPAA can come back
   * undefined rather than infinite.
   *
   * "Accepted" is the harvest pipeline's word for a draft that passed
   * verification and was written to a commit. In a bench workspace the records
   * were seeded from the task file rather than harvested, so this counts what
   * reached the repository without asserting how it got there; the arm that
   * strips the trailer block reports 0, which is the honest count for a
   * repository whose team never wrote a record.
   */
  readonly accepted_records?: number;
}

export interface GuardExposureMatch {
  readonly path: string | null;
  readonly alternative: string | null;
  readonly record_id: string;
}

export interface GuardExposure {
  readonly complete: boolean;
  readonly executed: boolean;
  readonly checks: number;
  readonly fires: number;
  readonly matches: readonly GuardExposureMatch[];
}
