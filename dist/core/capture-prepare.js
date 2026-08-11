/**
 * Capture prepare phase — T-1002, ADR-0021.
 *
 * Computes binding conditions (hashes, HEAD, tree OID), generates the prompt
 * contract via `buildHarvestPrompt`, and persists the prepared transaction
 * through `createPending`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execGitOrThrow } from './git.js';
import { guard, renderGuardMatch } from './guard.js';
import { buildHarvestPrompt } from './harvest.js';
import { POLICY_FILE_NAME, resolvePolicy } from './capture-policy.js';
import { createPending, makePreparedPending, } from './pending.js';
// ---------------------------------------------------------------------------
// Guard advisory — ADR-0020, T-1109
// ---------------------------------------------------------------------------
const GUARD_DISCLOSURE = 'Experimental advisory: precision 44.8%, recall 22.0% on the 417-decision corpus. ' +
    'An empty `matched` array does not guarantee the proposal avoids every ruled-out alternative.';
/**
 * Extracts file paths from a unified diff (git diff --cached output).
 * Parses `diff --git a/<path> b/<path>` lines.
 */
const extractPathsFromDiff = (diff) => {
    const paths = new Set();
    for (const line of diff.split('\n')) {
        const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        if (m && m[1] && m[2]) {
            paths.add(m[1]);
            paths.add(m[2]);
        }
    }
    return [...paths];
};
/**
 * Maps GuardResult availability fields into the closed gap vocabulary.
 */
const deriveGuardGaps = (result) => {
    const gaps = [];
    if (result.history === 'unavailable')
        gaps.push('history-unavailable');
    if (result.shallow)
        gaps.push('shallow-history');
    if (result.notes === 'unfetched')
        gaps.push('notes-unfetched');
    return gaps;
};
/**
 * Compute the guard advisory for a capture. Never throws — any error becomes
 * a recorded gap. The capture must always succeed regardless of guard outcome.
 */
const computeGuardAdvisory = (opts) => {
    try {
        const result = guard({
            proposal: opts.proposal,
            ...(opts.paths.length > 0 ? { paths: opts.paths } : {}),
            cwd: opts.cwd,
            ...(opts.readOnly === true ? { noIndex: true } : {}),
            ...(opts.trustedAuthors === undefined ? {} : { trustedAuthors: opts.trustedAuthors }),
        });
        return {
            matches: result.matches.map(renderGuardMatch),
            gaps: deriveGuardGaps(result),
            disclosure: GUARD_DISCLOSURE,
        };
    }
    catch {
        // Guard failure degrades to a recorded gap — never a capture failure
        return {
            matches: [],
            gaps: ['history-unavailable'],
            disclosure: GUARD_DISCLOSURE,
        };
    }
};
const isObjectId = (value) => /^[0-9a-f]{40}$/.test(value);
/**
 * The shared, side-effect-free half of prepare. The ordinary capture path and
 * historical shadow differ only in where their staged snapshot comes from and
 * whether the completed transaction is persisted.
 */
const prepareValues = (opts) => {
    const { cwd, transcript, snapshot } = opts;
    const baseHead = snapshot?.base_head ?? execGitOrThrow(['rev-parse', 'HEAD'], { cwd }).trim();
    if (!isObjectId(baseHead)) {
        throw new Error('Cannot resolve HEAD — is this a git repository with at least one commit?');
    }
    const diff = snapshot?.staged_diff ?? execGitOrThrow(['diff', '--cached'], { cwd });
    const stagedDiffHash = createHash('sha256').update(diff).digest('hex');
    const stagedTreeOid = snapshot?.staged_tree_oid ?? execGitOrThrow(['write-tree'], { cwd }).trim();
    if (!isObjectId(stagedTreeOid)) {
        throw new Error('Cannot resolve staged tree — is this a git repository with at least one commit?');
    }
    const sourceHashes = {
        transcript: createHash('sha256').update(transcript).digest('hex'),
        diff: stagedDiffHash,
    };
    const policy = resolvePolicy(cwd);
    if (policy.policy.mode === 'off') {
        throw new Error(`capture is off for this repository (${POLICY_FILE_NAME}: mode "off") — nothing was prepared`);
    }
    // ADR-0030, #511. Declaring a capture unattended is claiming the repository
    // consented to capture without asking; prepare is the one moment that can
    // check the claim before anything is written. Refused without the consent —
    // no pending file, nothing staged — the same shape as `off`'s refusal, for
    // the same reason. The read-only shadow never declares unattended, so a
    // repository's opt-in changes nothing about what shadow writes: nothing.
    if (opts.unattended === true &&
        !(policy.policy.mode === 'auto' && policy.policy.unattended)) {
        throw new Error(`unattended capture is off for this repository (${POLICY_FILE_NAME}: "unattended": true with mode "auto" opts in) — nothing was prepared`);
    }
    const diffPaths = extractPathsFromDiff(diff);
    const advisory = opts.skipGuard === true
        ? null
        : computeGuardAdvisory({
            proposal: transcript,
            paths: diffPaths,
            cwd,
            ...(opts.readOnly ? { readOnly: true } : {}),
            ...(opts.trustedAuthors === undefined ? {} : { trustedAuthors: opts.trustedAuthors }),
        });
    return {
        base_head: baseHead,
        staged_diff_hash: stagedDiffHash,
        staged_tree_oid: stagedTreeOid,
        policy_identity_hash: policy.identityHash,
        source_hashes: sourceHashes,
        prompt: buildHarvestPrompt({ transcript, diff }),
        guard_advisory: advisory,
        policy_error: policy.error,
    };
};
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
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
export const prepareCaptureContext = (opts) => {
    const { cwd } = opts;
    const prepared = prepareValues({ ...opts, readOnly: false });
    // 8. Persist the prepared transaction via createPending (T-1001)
    const nonce = createPending({
        cwd,
        source_hashes: prepared.source_hashes,
        staged_diff_hash: prepared.staged_diff_hash,
        staged_tree_oid: prepared.staged_tree_oid,
        policy_identity_hash: prepared.policy_identity_hash,
        guard_advisory: prepared.guard_advisory,
        ...(opts.unattended === true ? { unattended: true } : {}),
    });
    return {
        nonce,
        base_head: prepared.base_head,
        staged_diff_hash: prepared.staged_diff_hash,
        staged_tree_oid: prepared.staged_tree_oid,
        policy_identity_hash: prepared.policy_identity_hash,
        source_hashes: prepared.source_hashes,
        prompt: prepared.prompt,
        policy_error: prepared.policy_error,
        guard_advisory: prepared.guard_advisory,
    };
};
/**
 * Prepare a historical capture without creating `.git/commitlore/pending`.
 *
 * This deliberately uses the same policy resolution, prompt construction,
 * hashes, and advisory as `prepareCaptureContext`; only the Git index snapshot
 * and the pending-store write are substituted.
 */
export const prepareCaptureContextReadOnly = (opts) => {
    const prepared = prepareValues({ ...opts, readOnly: true });
    const nonce = randomBytes(16).toString('hex');
    const pending = makePreparedPending({
        cwd: opts.cwd,
        nonce,
        base_head: prepared.base_head,
        source_hashes: prepared.source_hashes,
        staged_diff_hash: prepared.staged_diff_hash,
        staged_tree_oid: prepared.staged_tree_oid,
        policy_identity_hash: prepared.policy_identity_hash,
        guard_advisory: prepared.guard_advisory,
    });
    return {
        nonce,
        base_head: prepared.base_head,
        staged_diff_hash: prepared.staged_diff_hash,
        staged_tree_oid: prepared.staged_tree_oid,
        policy_identity_hash: prepared.policy_identity_hash,
        source_hashes: prepared.source_hashes,
        prompt: prepared.prompt,
        policy_error: prepared.policy_error,
        guard_advisory: prepared.guard_advisory,
        pending,
    };
};
//# sourceMappingURL=capture-prepare.js.map