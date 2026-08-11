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
export const targetPath = 'src/pricing.ts';

/**
 * Record-Id of the predecessor (will be computed as superseded downstream).
 */
export const expectedSupersededRecordId = 'r-price01';

/**
 * Record-Id of the successor (will be computed as active downstream).
 */
export const expectedActiveRecordId = 'r-price02';

/**
 * A full commit message for the predecessor decision. When committed
 * chronologically first, this record is initially active. Once the successor
 * commit lands, `foldLifecycle` computes it as superseded.
 *
 * Trailers satisfy SPEC §3 vocabulary and `record.schema.json`.
 */
export const predecessorCommitMessage = `Reuse calculatePrice for admin quotes

Admin quotes reuse calculatePrice so their preview stays aligned with the
final checkout total.

Limit: admin quotes share checkout eligibility and rounding
Ruled-out: separate admin quote path | a shared calculation keeps totals aligned
Blast: module
Undo: costly
Certainty: firm
Record-Id: r-price01
Provenance: authored
CommitLore-Version: 2.0.0
`;

/**
 * A full commit message for the successor decision. It carries
 * `Supersedes: r-price01`, which is how `foldLifecycle` retires the
 * predecessor and computes this record as active.
 */
export const successorCommitMessage = `Give admin quotes their own pricing path

Admin quote eligibility and rounding differ from final checkout pricing.
Keep the quote path separate instead of carrying exceptions in calculatePrice.

Supersedes: r-price01
Limit: calculatePrice owns final checkout pricing only
Ruled-out: reuse checkout pricing | admin eligibility and rounding differ
Blast: module
Undo: easy
Certainty: firm
Record-Id: r-price02
Provenance: authored
CommitLore-Version: 2.0.0
`;

/**
 * A proposal that re-proposes the superseded approach. Used by T-1011 to
 * exercise lifecycle-filtered retrieval: when an agent proposes reverting to
 * calculatePrice for admin quotes, the demo shows that the predecessor is
 * superseded and the successor is active — the agent should not revive the
 * reversed decision.
 *
 * This is plain text, not a CommitMessage — it represents what an agent might
 * say, not a record in the graph.
 */
export const proposalText =
  'I suggest reusing calculatePrice for admin quotes so previews and checkout ' +
  'totals stay on one code path.';
