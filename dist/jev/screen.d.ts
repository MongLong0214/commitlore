/**
 * Secret screening for everything that leaves this machine — #1046, ADR D4.
 *
 * `scanForSecrets` is the native detector and it is reused whole: the rule
 * table, the placeholder suppressors and the shadowing are exactly the ones
 * `validate` applies to a commit message. What changes is the *surface* it is
 * applied to.
 *
 * The commit-message scanner deliberately skips two things, and both are correct
 * for its job and wrong for this one:
 *
 * - **`#` comment lines.** Git strips them, so a finding there is a finding
 *   about text that will never exist in the repository. But an outbound request
 *   is not a commit: whatever is in the string is what leaves the machine.
 * - **Everything below `commit -v` scissors.** Same reasoning, and it is where
 *   the pasted diff lives.
 *
 * So screening runs with `includeIgnoredLines`, which is why that option exists
 * on the native scanner rather than a second rule table living here.
 *
 * ## What a clean screen does and does not mean
 *
 * It means no rule in an eleven-rule table fired. It does not mean the text is
 * safe to publish, and it is not consent: source text can be private with no
 * credential anywhere in it. The product's obligation is to *disclose* that
 * assessed text is exported and that screening is best effort — which #1050
 * owns — not to claim the screen made the export safe.
 *
 * ## Why an unsafe unit is dropped rather than masked
 *
 * A masked string is a different string. Sending `AKIA…` in place of a
 * credential and then recording a decision as though the original passage had
 * been assessed would attribute a judgement to text the model never saw. So the
 * unit is withheld and reported as unassessed, which is a smaller claim and a
 * true one.
 */
import { type SecretFinding } from '../core/secret-guard.js';
export interface ScreenedUnit<T> {
    readonly unit: T;
    readonly findings: readonly SecretFinding[];
}
export interface ScreenResult<T> {
    /** Units with no finding. Only these may be sent. */
    readonly safe: readonly T[];
    /** Units withheld, with what fired. Values are already redacted by the scanner. */
    readonly withheld: readonly ScreenedUnit<T>[];
}
/**
 * Screens one original string.
 *
 * "Original" is load-bearing: the check runs on the text as it exists, not on
 * its JSON-escaped form. A credential inside a JSON string literal is the same
 * credential, and escaping can break a rule's `\b` boundaries — screening the
 * serialized body would be a check that passes because the input changed shape.
 */
export declare const screenText: (text: string) => readonly SecretFinding[];
/** True when nothing fired. Named so a caller reads the direction correctly. */
export declare const isSafeToSend: (text: string) => boolean;
/**
 * Partitions units by whether they may leave the machine.
 *
 * `text` extracts the original string from a unit so the caller keeps its own
 * shape — a candidate passage, a question instruction, a diff path — instead of
 * this module knowing about any of them.
 */
export declare const screenUnits: <T>(units: readonly T[], text: (unit: T) => string) => ScreenResult<T>;
/**
 * What a diagnostic may say about withheld units.
 *
 * Rule ids and a count. `SecretFinding.redacted` is already masked by the
 * scanner, and it still does not appear here: a diagnostic file sits in
 * `.git` and gets pasted into issue reports, so it carries the *shape* of what
 * was found and no part of the value.
 */
export declare const describeWithheld: (withheld: readonly ScreenedUnit<unknown>[]) => string | null;
