/**
 * Public CDEB run-lifecycle surface.
 *
 * Freeze/sealed-bundle loading belongs to the freeze tooling; this module
 * intentionally exports only the immutable execution API so a caller cannot
 * slip scientific CLI overrides between a frozen manifest and `runStudy`.
 */

export {
  MAX_EVALUATOR_ATTEMPTS,
  MAX_PRE_AGENT_ATTEMPTS,
  MeasurementIntegrityError,
  InterruptedAgentAttemptError,
  RetryExhaustedError,
  blockedRandomization,
  canonicalFinalTreeFreezer,
  formatOutcomeFreeProgress,
  materializedWorkspacePreparer,
  ociEvaluatorRunner,
  runStudy,
  runtimeAgentRunner,
  summarizeExposure,
} from "./orchestrator.ts";

export type {
  AgentExecution,
  AgentRunner,
  AgentRunnerInput,
  AgentTerminalObservation,
  BlockedRandomization,
  CdebCondition,
  CdebStudyPlan,
  EvaluatorExecution,
  EvaluatorRunner,
  ExposureSummary,
  FinalTreeFreezer,
  FrozenTreeObservation,
  LifecycleState,
  LogicalRunPlan,
  MaterializedRepositorySource,
  MaterializedWorkspacePreparerOptions,
  OciEvaluatorRunnerOptions,
  OpaqueRandomizationManifest,
  OrchestratorDependencies,
  OutcomeFreeProgress,
  PreparedWorkspace,
  ProgressReporter,
  RunStudyOptions,
  RuntimeAgentRunnerOptions,
  ScheduledSealedBlock,
  SealedPairBlock,
  StudyRunResult,
} from "./orchestrator.ts";

export { DurableStudyStorage, ImmutableArtifactError, SimulatedProcessKill } from "./storage.ts";
export type {
  AgentLaunchCheckpoint,
  AgentStartedCheckpoint,
  DurableStudyStorageOptions,
  FinalTreeArtifact,
  StorageFaults,
  StoredAttempt,
  StoredRunState,
} from "./storage.ts";
