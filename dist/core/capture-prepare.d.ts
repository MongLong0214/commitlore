/**
 * Capture prepare phase — T-1002, ADR-0021.
 *
 * Computes binding conditions (hashes, HEAD, tree OID), generates the prompt
 * contract via `buildHarvestPrompt`, and persists the prepared transaction
 * through `createPending`.
 */
import { type GuardAdvisory } from './pending.js';
export interface PrepareCaptureOptions {
    cwd: string;
    transcript: string;
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
