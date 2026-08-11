/**
 * Capture prepare phase — T-1002, ADR-0021.
 *
 * Computes binding conditions (hashes, HEAD, tree OID), generates the prompt
 * contract via `buildHarvestPrompt`, and persists the prepared transaction
 * through `createPending`.
 */
import { type GuardAdvisory, type PendingRecord } from './pending.js';
export interface PrepareCaptureOptions {
    cwd: string;
    transcript: string;
    /**
     * Declare that this capture runs without asking: the pipeline prepares,
     * verifies and stages it with no person in the loop (ADR-0030, #511).
     * Refused unless the repository opted in — `.commitlore-policy.json` with
     * `"unattended": true` and mode `auto` — because consent is a repository
     * setting, not a caller's say-so.
     */
    unattended?: boolean;
}
/** A historical index snapshot supplied by the read-only shadow runner. */
export interface HistoricalCaptureSnapshot {
    /** HEAD immediately before the historical change was committed. */
    base_head: string;
    /** The patch that historical commit introduced. */
    staged_diff: string;
    /** The tree Git would have produced after staging that patch. */
    staged_tree_oid: string;
}
export interface PrepareResult {
    nonce: string;
    base_head: string;
    staged_diff_hash: string;
    staged_tree_oid: string;
    policy_identity_hash: string;
    source_hashes: {
        transcript: string;
        diff: string;
    };
    prompt: string;
    guard_advisory: GuardAdvisory | null;
    /**
     * A named reason when a policy file exists but could not be used (T-1110).
     * The defaults ran, and `policy_identity_hash` describes them — but the caller
     * must say so: silently ignoring an unusable policy file would let a user
     * believe a setting applied.
     */
    policy_error: string | null;
}
/** A prepared transaction that exists only in process memory. */
export interface ReadOnlyPrepareResult extends PrepareResult {
    pending: PendingRecord;
}
/**
 * Prepares a capture context: computes all binding conditions, generates
 * the prompt contract, and persists a `phase:"prepared"` transaction.
 *
 * CEO amendment 1: `expires_at` is written as `null` — expiry is stamped
 * only when stage succeeds (`staged_at + 5 minutes`).
 *
 * CEO amendment 2: nonce is 32 lowercase hex chars (`randomBytes(16)`),
 * satisfying the store's `^[0-9a-f]{32}$` validation.
 */
export declare const prepareCaptureContext: (opts: PrepareCaptureOptions) => PrepareResult;
/**
 * Prepare a historical capture without creating `.git/commitlore/pending`.
 *
 * This deliberately uses the same policy resolution, prompt construction,
 * hashes, and advisory as `prepareCaptureContext`; only the Git index snapshot
 * and the pending-store write are substituted.
 */
export declare const prepareCaptureContextReadOnly: (opts: PrepareCaptureOptions & {
    snapshot: HistoricalCaptureSnapshot;
    /** Guard is advisory-only; shadow may omit it to keep a large history scan bounded. */
    skipGuard?: boolean;
}) => ReadOnlyPrepareResult;
