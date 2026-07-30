/**
 * Demo scenario fixture — T-1010 (#202).
 *
 * Pure static data: one decision that will be computed as superseded, one
 * successor that retires it (computed as active), and a proposal text that
 * re-proposes the superseded decision's approach.
 *
 * This module exports raw commit-message text and identifiers only.
 * Lifecycle (`active` / `superseded`) is NEVER stated here — it is computed
 * by `foldLifecycle` in `src/core/stale.ts` from the `Supersedes:` trailer
 * across chronologically ordered records. See ADR-0022.
 *
 * No command registration. No filesystem operations. No I/O.
 */
/**
 * The path all demo records are scoped to.
 */
export declare const targetPath = "src/services/cache.ts";
/**
 * Record-Id of the predecessor (will be computed as superseded downstream).
 */
export declare const expectedSupersededRecordId = "r-demo01";
/**
 * Record-Id of the successor (will be computed as active downstream).
 */
export declare const expectedActiveRecordId = "r-demo02";
/**
 * A full commit message for the predecessor decision. When committed
 * chronologically first, this record is initially active. Once the successor
 * commit lands, `foldLifecycle` computes it as superseded.
 *
 * Trailers satisfy SPEC §3 vocabulary and `record.schema.json`.
 */
export declare const predecessorCommitMessage = "Decide on Redis for session cache\n\nUse Redis as the session cache backend. It handles our throughput\nrequirements and the ops team already runs a managed instance.\n\nLimit: must not exceed 512 MB memory budget per node\nRuled-out: memcached | no built-in persistence for session recovery\nBlast: module\nUndo: costly\nCertainty: firm\nRecord-Id: r-demo01\nProvenance: authored\nCommitLore-Version: 2.0.0\n";
/**
 * A full commit message for the successor decision. It carries
 * `Supersedes: r-demo01`, which is how `foldLifecycle` retires the
 * predecessor and computes this record as active.
 */
export declare const successorCommitMessage = "Switch session cache from Redis to SQLite\n\nRedis added operational complexity without matching throughput gains for\nour actual traffic pattern. SQLite embedded cache removes the external\ndependency and simplifies deployment.\n\nSupersedes: r-demo01\nLimit: single-writer constraint requires careful connection pooling\nRuled-out: Redis cluster | cost and complexity disproportionate to traffic\nBlast: module\nUndo: easy\nCertainty: firm\nRecord-Id: r-demo02\nProvenance: authored\nCommitLore-Version: 2.0.0\n";
/**
 * A proposal that re-proposes the superseded approach. Used by T-1011 to
 * exercise lifecycle-filtered retrieval: when an agent proposes reverting to
 * Redis, the demo shows that the predecessor is superseded and the successor
 * is active — the agent should not revive the reversed decision.
 *
 * This is plain text, not a CommitMessage — it represents what an agent might
 * say, not a record in the graph.
 */
export declare const proposalText: string;
