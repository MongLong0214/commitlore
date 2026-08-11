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
/**
 * What capture does with a candidate record (ADR-0030).
 *
 * - `auto` — stage it without asking. The default. Every record staged this way
 *   is marked `Provenance: drafted` and can never grade above `claim`, because
 *   nobody read it (see `capture-stage.ts`).
 * - `suggest` — draft it and leave staging to the host, which may ask first.
 *   What this repository shipped before ADR-0030, kept for a host that wants
 *   the prompt. `stage` still cannot tell whether anyone was asked, so a record
 *   staged in this mode carries whatever provenance it was drafted with.
 * - `off` — capture nothing. `prepare` refuses, so no transcript is hashed and
 *   no candidate exists.
 */
export type CaptureMode = 'auto' | 'suggest' | 'off';
export declare const CAPTURE_MODES: readonly CaptureMode[];
export interface CapturePolicy {
    mode: CaptureMode;
    /**
     * Consent to capture without asking (ADR-0030, #511). Off unless a
     * repository sets it, and honoured only in `auto` mode: `suggest` exists to
     * ask, `off` captures nothing, and a consent neither mode can honour is a
     * configuration error rather than a silent no-op. The declaration a capture
     * makes against it is checked in `capture-prepare.ts`; the grading cap that
     * keeps an unread record from directing lives in `grade.ts`.
     */
    unattended: boolean;
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
export declare const POLICY_KEYS: readonly ["mode", "unattended", "max_records_per_commit", "require_verified_evidence"];
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
 *
 * `unattended` is deliberately absent (#511). The setting can only be turned
 * on by a policy file, and a file's identity is its own bytes — so every
 * identity the setting can change is hashed already. Putting a fixed-false
 * default into this digest too would refuse every capture in flight across the
 * upgrade in every repository that never opted in: a policy change that never
 * happened, the exact false positive this hash exists to avoid. If the default
 * ever becomes `true`, this input must move with it.
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
/**
 * Absolute path of the repository's policy file, or null outside a repository.
 * The file itself may or may not exist; this is where it lives either way, so
 * a status report can say where the setting is kept even before it is set.
 */
export declare const capturePolicyPath: (cwd: string) => string | null;
export interface PolicyWriteSuccess {
    ok: true;
    /** Absolute path of the policy file. */
    path: string;
    /** False when the requested state was already in effect and nothing was written. */
    changed: boolean;
    /** The policy that applies after the call. */
    policy: CapturePolicy;
    /** The policy that applied before the call — the defaults when no file existed. */
    previous: CapturePolicy;
}
export interface PolicyWriteFailure {
    ok: false;
    /** Absolute path of the policy file, or null outside a repository. */
    path: string | null;
    /** A named, actionable reason — the same words `resolvePolicy` would use. */
    error: string;
}
export type PolicyWriteResult = PolicyWriteSuccess | PolicyWriteFailure;
/**
 * Turn unattended capture on or off by writing the policy file
 * `resolvePolicy` reads (#511 added the setting; this is the only writer).
 *
 * Never throws. Coherence is enforced here rather than trusted to the caller:
 * enabling sets `mode: "auto"` beside `unattended: true`, because a consent
 * the mode cannot honour is a configuration error the resolver rejects
 * (ADR-0030, #511) — this function cannot produce a file it would reject.
 * Disabling preserves whatever mode the repository chose.
 *
 * An existing file is merged, never replaced: every other key the repository
 * set survives. A file the resolver rejects is refused rather than rewritten,
 * because rewriting it would destroy whatever the user meant to put there
 * before they can see it named. When no file exists, disabling writes nothing
 * — the defaults already apply, and creating a file would move the repository
 * from the default digest to a file digest while nothing about capture
 * changed, which #511 pins against.
 */
export declare const setUnattendedCapture: (cwd: string, enabled: boolean) => PolicyWriteResult;
