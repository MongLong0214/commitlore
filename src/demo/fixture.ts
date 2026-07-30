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
export const targetPath = 'src/services/cache.ts';

/**
 * Record-Id of the predecessor (will be computed as superseded downstream).
 */
export const expectedSupersededRecordId = 'r-demo01';

/**
 * Record-Id of the successor (will be computed as active downstream).
 */
export const expectedActiveRecordId = 'r-demo02';

/**
 * A full commit message for the predecessor decision. When committed
 * chronologically first, this record is initially active. Once the successor
 * commit lands, `foldLifecycle` computes it as superseded.
 *
 * Trailers satisfy SPEC §3 vocabulary and `record.schema.json`.
 */
export const predecessorCommitMessage = `Decide on Redis for session cache

Use Redis as the session cache backend. It handles our throughput
requirements and the ops team already runs a managed instance.

Limit: must not exceed 512 MB memory budget per node
Ruled-out: memcached | no built-in persistence for session recovery
Blast: module
Undo: costly
Certainty: firm
Record-Id: r-demo01
Provenance: authored
CommitLore-Version: 2.0.0
`;

/**
 * A full commit message for the successor decision. It carries
 * `Supersedes: r-demo01`, which is how `foldLifecycle` retires the
 * predecessor and computes this record as active.
 */
export const successorCommitMessage = `Switch session cache from Redis to SQLite

Redis added operational complexity without matching throughput gains for
our actual traffic pattern. SQLite embedded cache removes the external
dependency and simplifies deployment.

Supersedes: r-demo01
Limit: single-writer constraint requires careful connection pooling
Ruled-out: Redis cluster | cost and complexity disproportionate to traffic
Blast: module
Undo: easy
Certainty: firm
Record-Id: r-demo02
Provenance: authored
CommitLore-Version: 2.0.0
`;

/**
 * A proposal that re-proposes the superseded approach. Used by T-1011 to
 * exercise lifecycle-filtered retrieval: when an agent proposes reverting to
 * Redis, the demo shows that the predecessor is superseded and the successor
 * is active — the agent should not revive the reversed decision.
 *
 * This is plain text, not a CommitMessage — it represents what an agent might
 * say, not a record in the graph.
 */
export const proposalText =
  'I suggest we switch back to Redis for session caching. It would give us ' +
  'better throughput for the new real-time features and the ops team already ' +
  'has the infrastructure.';
