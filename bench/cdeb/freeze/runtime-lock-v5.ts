/**
 * CDEB-Fresh v5 Stage 1-r1 gate G4: runtime equivalence.
 *
 * The two arms are supposed to differ by exactly one thing: whether the
 * shipping hook forwards the decision before the first relevant mutation. Every
 * other difference between them is an alternative explanation for whatever the
 * study measures, and most of those differences are invisible -- a model
 * version rolling forward mid-run, a cache warm in one arm and cold in the
 * other, a scheduler that puts one arm on a quiet machine.
 *
 * So the runtime is pinned as a list of named fields, and the list is closed. A
 * lock with an empty field is not a lock with a gap; it is an unpinned runtime
 * that looks pinned, which is worse than no lock at all.
 */

export const RUNTIME_LOCK_FIELDS = [
  "model_id",
  "agent_harness",
  "agent_harness_version",
  "system_prompt_digest",
  "tools_enabled",
  "permission_mode",
  "container_image_digest",
  "base_commit_per_repository",
  "context_policy",
  "cache_policy",
  "budget_wall_clock_seconds",
  "budget_tokens",
  "fresh_session_rule",
  "worktree_rule",
  "commitlore_release",
  "hook_configuration_digest",
  "execution_scheduler",
] as const;

export type RuntimeLockField = (typeof RUNTIME_LOCK_FIELDS)[number];

export interface RuntimeLock {
  readonly schema_version: 1;
  readonly study_id: "cdeb-fresh-v5";
  readonly stage: "stage1-r1";
  readonly frozen_at: string | null;
  readonly fields: Readonly<Partial<Record<RuntimeLockField, unknown>>>;
  /** The single permitted difference between arms, named so it can be checked. */
  readonly arm_difference: "automatic-model-visible-commitlore-delivery";
}

const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0);

/** Every field present and non-empty, and no field outside the closed list. */
export const assertRuntimeLockComplete = (lock: RuntimeLock): void => {
  const missing = RUNTIME_LOCK_FIELDS.filter((field) => isEmpty(lock.fields[field]));
  if (missing.length > 0) {
    throw new Error(
      `runtime-lock: ${String(missing.length)} field(s) are unset: ${missing.join(", ")}. ` +
        `An unpinned field is an uncontrolled difference between the arms`,
    );
  }
  const known: ReadonlySet<string> = new Set(RUNTIME_LOCK_FIELDS);
  const extra = Object.keys(lock.fields).filter((field) => !known.has(field));
  if (extra.length > 0) {
    throw new Error(`runtime-lock: unregistered field(s) ${extra.join(", ")}`);
  }
  if (lock.frozen_at === null) {
    throw new Error("runtime-lock: the lock is not frozen, so nothing stops it moving between arms");
  }
};

/**
 * Compares what each arm actually ran under. The only field permitted to differ
 * is the delivery switch itself, and that switch is not one of the locked
 * fields -- it is the treatment.
 */
export const runtimeDrift = (
  on: Readonly<Partial<Record<RuntimeLockField, unknown>>>,
  suppressed: Readonly<Partial<Record<RuntimeLockField, unknown>>>,
): RuntimeLockField[] =>
  RUNTIME_LOCK_FIELDS.filter((field) => JSON.stringify(on[field]) !== JSON.stringify(suppressed[field]));

export const assertArmsDifferOnlyByDelivery = (
  on: Readonly<Partial<Record<RuntimeLockField, unknown>>>,
  suppressed: Readonly<Partial<Record<RuntimeLockField, unknown>>>,
): void => {
  const drift = runtimeDrift(on, suppressed);
  if (drift.length > 0) {
    throw new Error(
      `runtime-lock: the arms differ in ${drift.join(", ")} as well as in delivery. Each difference is an ` +
        `alternative explanation for the result`,
    );
  }
};

/**
 * Comparing the arms to each other is not enough, and an adversarial review
 * showed why: a hosted model or harness revision that rolls forward mid-run
 * moves **both** arms together. `assertArmsDifferOnlyByDelivery` sees two equal
 * objects and passes, and if the revision lands part-way through a schedule the
 * drift is credited to whichever arm was running.
 *
 * So every episode is also compared to the freeze itself. This is the check the
 * scheduler runs per episode, not once per study.
 */
export const assertEpisodeMatchesFrozenLock = (
  lock: RuntimeLock,
  episode: Readonly<Partial<Record<RuntimeLockField, unknown>>>,
  episodeLabel: string,
): void => {
  if (lock.frozen_at === null) {
    throw new Error(`runtime-lock: ${episodeLabel} cannot be compared to a lock that was never frozen`);
  }
  const drift = RUNTIME_LOCK_FIELDS.filter(
    (field) => JSON.stringify(lock.fields[field]) !== JSON.stringify(episode[field]),
  );
  if (drift.length > 0) {
    throw new Error(
      `runtime-lock: ${episodeLabel} ran under a runtime that differs from the freeze in ${drift.join(", ")}. ` +
        `Both arms drifting together is invisible to an arm-versus-arm comparison and is the shape a rolled-` +
        `forward hosted model takes`,
    );
  }
};
