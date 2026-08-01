/**
 * Capture policy — the single definition of the policy defaults and the policy
 * identity hash (T-1110, acceptance row B-7 / matrix row P1-5, ADR-0021 §7).
 *
 * This file exists because the definition used to exist three times. At
 * `da1c733` `computePolicyIdentityHash` and its defaults object were declared
 * independently in `capture-prepare.ts`, `capture-stage.ts` and
 * `prepare-commit-msg.ts` — under two different constant names — and agreed only
 * because the three object literals happened to list the same three keys in the
 * same order. Key order is what `JSON.stringify` serialises, and nothing tested
 * that the three agreed.
 *
 * That matters more than duplication usually does. The hook compares the hash it
 * computes against the one `prepare` wrote into the pending file. If the two
 * sites disagree, the hook reports a policy change that never happened, and the
 * user sees a capture declined for a reason that is not true.
 *
 * ADR-0021 fixed the migration before the file existed: with no policy file the
 * identity is `sha256(canonical-defaults-json)`; with one it is
 * `sha256(file-contents)`. The pending format needs no version bump either way,
 * which is why `PendingRecord.version` stays `1`.
 */
/**
 * `mode` is a closed set. Adding a member is a decision, not a config change.
 *
 * `suggest` says a capture produces a candidate rather than committing one on
 * its own, and that much holds: nothing here writes a record without a host
 * driving prepare → verify → stage. What it does **not** say is that a human
 * saw the candidate. The pending transaction's phases are
 * `prepared → verified → staged → applied → consumed` (ADR-0021 §2) — there is
 * no `approved` phase, no rejection state and no approval token — so no code
 * path here can tell a record a user kept from one that was never shown.
 * `stageCaptureRecord` checks the phase, the record count, HEAD, the staged
 * diff, the staged tree and this policy's identity. It cannot check for consent,
 * because consent is not something the transaction can hold.
 *
 * The prompt therefore lives in the host: `skills/commitlore-commits/SKILL.md`
 * asks before it calls stage. A host that stages without asking violates no
 * check in this repository and is within contract. Read `suggest` as a
 * convention this project documents and its own skill follows, not an enforced
 * one — ADR-0028 records why the line sits there and what moving it would cost.
 */
export type CaptureMode = 'suggest';
export interface CapturePolicy {
    mode: CaptureMode;
    max_records_per_commit: number;
    require_verified_evidence: boolean;
}
/**
 * Key order is load-bearing: it is the input to `JSON.stringify` and therefore
 * to the identity hash. Reordering these three lines changes the digest every
 * pending file in flight was written with. See `test/capture-policy.test.ts`,
 * which pins the value.
 */
export declare const POLICY_DEFAULTS: CapturePolicy;
/** The only keys a policy file may set. An unknown key is rejected, not merged. */
export declare const POLICY_KEYS: readonly ["mode", "max_records_per_commit", "require_verified_evidence"];
/**
 * One location, deliberately. PRD-F13 requirement 11 allows either a stated
 * precedence between a repository-local and a user-global file, or a single
 * location. A single location is chosen: an ambiguous precedence is worse than a
 * missing feature, and the user story this file answers ("one record per commit
 * generally, two on this repository") is repository-scoped anyway.
 */
export declare const POLICY_FILE_NAME = ".commitlore-policy.json";
/**
 * The identity of a policy that came from the defaults.
 *
 * `JSON.stringify` over an object literal whose keys are declared in
 * `POLICY_DEFAULTS`' order — the exact expression the three former call sites
 * used, preserved so that consolidation is a no-op on the digest.
 */
export declare const computePolicyIdentityHash: (policy?: CapturePolicy) => string;
/**
 * The identity of a policy that came from a file: the bytes as written.
 *
 * Hashing the contents rather than the parsed object is ADR-0021's choice, and
 * it is the stronger one — a reformat that changes nothing semantically still
 * changes the identity, so the hook reports "the policy file changed", which is
 * true.
 */
export declare const computePolicyFileIdentityHash: (contents: string) => string;
export interface PolicyResolution {
    /** False when a policy file exists but could not be used. */
    ok: boolean;
    policy: CapturePolicy;
    identityHash: string;
    source: 'defaults' | 'repository';
    /** Absolute path of the file that was read, or null when none was. */
    path: string | null;
    /**
     * A named, actionable reason when `ok` is false. Never null in that case: a
     * silent fallback to the defaults would make the identity hash describe a
     * policy the user did not ask for without telling them.
     */
    error: string | null;
}
/**
 * Resolve the policy for `cwd`.
 *
 * Never throws. Every failure path returns the defaults **and** a named reason,
 * so a caller that ignores `error` still behaves as it did before the policy
 * file existed, and a caller that reports it tells the truth about which policy
 * ran.
 */
export declare const resolvePolicy: (cwd: string) => PolicyResolution;
