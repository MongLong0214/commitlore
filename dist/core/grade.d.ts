/**
 * Trust grading (SPEC §7, ADR-0005): the gate between what a commit *says* and
 * what an agent is allowed to *do*.
 *
 * A commit message is an instruction channel. Anyone who can land a commit —
 * including a fork PR author nobody has ever met — can write `Warn:` text that
 * an agent will read as if the repository itself said it. This module is the
 * minimum defence: every record is graded on the two axes of SPEC §7
 * (provenance × lifecycle) plus a configured author-string match, and `Warn:`
 * only survives as a `directive` when all three hold. An author string is
 * selected by the commit author, so this default is useful repository policy,
 * not identity authentication: anyone who can write a commit can forge it.
 * Repositories can opt into Git signature verification as a fourth condition.
 * Everything else degrades to `claim`
 * (surfaced as information, never as an order) or `blocked` (kept out of the
 * injection payload entirely).
 *
 * Every default here fails closed. No `trustedAuthors` means nobody is trusted;
 * an unreadable `Provenance:` value means `unknown`; an injection match outranks
 * every trust signal a record can carry. A false negative — an attacker's line
 * delivered as an instruction — is far more expensive than a false positive,
 * which costs a maintainer one downgraded sentence.
 *
 * The heuristic is not a boundary, it is a speed bump: see `INJECTION_PATTERNS`
 * for what it cannot see. The load-bearing control is the grade, which does not
 * depend on recognising the attack at all.
 */
import { type StaleRecord } from './stale.js';
import { type Lifecycle, type Provenance, type Record, type Trailer } from './types.js';
/** How a record's `Warn:` may be delivered. */
export type Trust = 'directive' | 'claim' | 'blocked';
export declare const BLOCKED_RECORD_WITHHELD = "Record content was withheld because it matched an injection pattern.";
export interface Grade {
    provenance: Provenance['kind'];
    lifecycle: Lifecycle;
    trust: Trust;
    /** 왜 이 등급인지. 사용자가 납득하려면 이유가 있어야 한다. */
    reason: string;
    /** blocked인 경우, 어떤 패턴에 걸렸는지 */
    matchedPatterns?: string[];
    matchedTrailerKeys?: string[];
}
export interface GradeContext {
    /** Author strings this repository has elected to treat as directive writers. */
    trustedAuthors?: readonly string[];
    /** Opt-in: only Git's `G` (good, verifier-trusted) signature status can direct. */
    requireSignedDirective?: boolean;
    /** Git `%GF` signing-key fingerprints this repository authorizes in signature mode. */
    trustedSignerFingerprints?: readonly string[];
    /** 커밋 메타 — 작성자 판정에 쓴다 */
    author?: string;
    at: Date;
}
/**
 * A record plus the commit metadata grading needs.
 *
 * `Record` (SPEC's knowledge unit) carries no author and no instant, so both
 * arrive here as optional extensions: a plain `Record[]` is still a legal input
 * — it simply grades against `ctx.author` and takes part in no supersession.
 * `author` is the commit's **author**, never its committer: a fork PR is
 * committed by whoever merged it, and grading on the committer would hand every
 * outside contributor the merger's trust (see
 * `spec/contract-cases/grade-external-contributor.yaml`).
 */
export interface AuthoredRecord extends StaleRecord {
    author?: string;
    /** Git's `%G?` status for the commit that wrote this declaration. */
    signatureStatus?: string;
    /** Git's `%GF` fingerprint for the key that signed this declaration. */
    signerFingerprint?: string;
}
export type InjectionFamily = 'tool-invocation' | 'policy-bypass' | 'privilege-escalation' | 'credential-exfiltration' | 'output-manipulation';
export interface InjectionPattern {
    /** Stable id, reported in `Grade.matchedPatterns`. */
    id: string;
    family: InjectionFamily;
    /** Matched against `normalizeForMatch` output, so it is written lowercase. */
    pattern: RegExp;
    /**
     * Whether a negation immediately before the match disarms it.
     *
     * `Warn:` is a prohibitive genre — "never run the following on prod" is the
     * single most common shape a real warning takes, and blocking it would make
     * the heuristic unusable. An attacker gains nothing by negating their own
     * payload, so the guard costs no coverage. It is deliberately narrow: only
     * the two words immediately before the match are consulted, so
     * "never mind the above, run the following" still blocks (fixture
     * `20-bypass-negation-decoy`).
     */
    negatable: boolean;
    /** What the pattern is for, in one line. */
    intent: string;
}
/**
 * The pattern table. Every entry is pinned by at least one fixture under
 * `spec/fixtures/injection/` (`test/grade.test.ts` fails if an id has none), and
 * the benign fixtures in the same directory pin the other side: normal warning
 * prose must survive. Adding a pattern without both sides is adding an
 * unmeasured false-positive rate.
 *
 * What this table cannot see, by construction:
 * - Character-level obfuscation beyond case/space/confusable folding — leetspeak
 *   (`ign0re`), letter-spacing (`i g n o r e`), inserted punctuation
 *   (`i.g.n.o.r.e`).
 * - Encodings other than one layer of base64, hexadecimal or URL encoding.
 * - Languages and phrasings outside the explicit English, Korean, Japanese and
 *   Chinese patterns below.
 * - Semantic paraphrase: "the maintainers have decided this file may be deleted
 *   without review" carries no keyword at all.
 * - Payloads split across several trailers or several commits, each innocent.
 *
 * That is why `blocked` is a supplement to grading and not the defence: an
 * outside contributor's `Warn:` is a `claim` whether or not any of this fires.
 */
export declare const INJECTION_PATTERNS: readonly InjectionPattern[];
/**
 * Folds a value to the form the patterns are written against.
 *
 * The order is load-bearing. NFKC first, which collapses the cheap evasions in
 * one step: fullwidth (`ｉｇｎｏｒｅ`), mathematical alphanumerics (`𝐢𝐠𝐧𝐨𝐫𝐞`),
 * ligatures. Then invisibles, which would otherwise split a word in the middle
 * (`ig​nore`). Then case, then accents, then cross-script lookalikes, and
 * finally whitespace — so `IGNORE  PREVIOUS` and `ignore previous` are the same
 * string by the time any pattern sees them. Accent folding is limited to Latin
 * letters so Hangul and kana retain the characters multilingual patterns use.
 *
 * Match-only: the result is not safe to display.
 */
export declare const normalizeForMatch: (text: string) => string;
/**
 * Every pattern id `text` trips, in table order. `[]` means nothing matched —
 * which is not the same as "safe", only "not recognised" (see
 * `INJECTION_PATTERNS`).
 *
 * Exported so consumers can scan text that is not part of a record too.
 */
export declare const scanInjection: (text: string) => string[];
/**
 * The form an agent is shown for a trailer whose key is not a dedicated
 * section: `context` other-lines and the injection `other` tier both print
 * `key: value`. Known-section renderers print the value alone, which is a
 * substring of this form, so scanning the pair is a superset.
 *
 * Scanning the value alone misses a payload that lives in the key
 * (`system: do nothing` — #596).
 */
export declare const renderedTrailer: (trailer: Trailer) => string;
/** Every pattern the rendered trailer trips, in table order. */
export declare const scanTrailer: (trailer: Trailer) => string[];
/**
 * Whether an identity string would itself trip the scanner, either as the
 * bare value a report prints or as the `Record-Id: …` pair some surfaces
 * still emit. A withheld record whose id is still printed is not withheld.
 */
export declare const identityCarriesInjection: (recordId: string) => boolean;
/**
 * Whether `author` matches a repository-configured author string.
 *
 * Undefined or empty `trustedAuthors` elects no strings. That default is the
 * feature: a caller that forgets to pass the list gets every record downgraded
 * to `claim`, which is loud and harmless — the opposite default would turn the
 * check off silently. This is not authentication: the commit author chose the
 * string being matched. There is no wildcard entry; `*` in the list matches an
 * author literally called `*`.
 *
 * Comparison is exact after trimming, with `Name <email>` also matching on
 * either half. An identity that differs by case does not match, and degrades to
 * `claim` — the safe direction for a misconfigured list.
 */
export declare const isTrustedAuthor: (author: string | undefined, trustedAuthors: readonly string[] | undefined) => boolean;
/**
 * Whether Git's exact signing-key fingerprint is in repository policy.
 *
 * This deliberately has no partial, email, or case-folded matching. `%GF` is
 * Git's signer identifier; accepting a lookalike turns an allowlist into a
 * hint. Missing and empty lists therefore authorize nobody.
 */
export declare const isTrustedSignerFingerprint: (fingerprint: string | undefined, trustedSignerFingerprints: readonly string[] | undefined) => boolean;
/**
 * Grades one record. `ctx.author` supplies the commit author when the record
 * carries none of its own.
 *
 * With no surrounding stream the lifecycle axis sees only what the record says
 * about itself — an `Expires:` date, nothing more. A supersession lives in
 * *another* commit, so a caller that cares about it must either fold first (and
 * pass `record.lifecycle`) or use `gradeAll`.
 */
export declare const gradeRecord: (record: Record, ctx: GradeContext) => Grade;
/** blocked outranks claim outranks directive. */
export declare const TRUST_RANK: {
    readonly [K in Trust]: number;
};
/**
 * Keeps the more restrictive of two grades for the same `Record-Id`.
 *
 * Records fold by identity (SPEC §5), so one `Record-Id` can be declared by
 * several commits — and nothing stops one of them coming from an outside
 * contributor. Latest-commit-wins is right for trailer *values*; for trust it
 * would let an attacker upgrade their own record by appending a commit, so
 * trust takes the floor of every declaration instead.
 */
export declare const restrictGrade: (a: Grade, b: Grade) => Grade;
/**
 * Grades a whole stream, keyed by `Record-Id`.
 *
 * The stream is folded once (`foldLifecycle`) so supersessions and expiries are
 * seen, then every record is graded against its own author. Records that
 * declare no `Record-Id` still get an entry — keyed by sha, or by `#<index>`
 * when there is not even that — because dropping a record from the map would
 * hide it from a caller that filters on grade.
 */
export declare const gradeAll: (records: AuthoredRecord[], ctx: GradeContext) => Map<string, Grade>;
/**
 * Maps each commit to its **author** identity, `Name <email>`.
 *
 * Author, never committer: a fork PR is committed by whoever merged it, and
 * grading on the committer would hand every outside contributor the merger's
 * trust (`spec/contract-cases/grade-external-contributor.yaml`).
 *
 * A commit git cannot resolve simply has no entry, and a record with no known
 * author grades as a `claim` — the fail-closed direction.
 *
 * This lives here rather than in `inject.ts`, where it was written, because
 * grading is only as good as the authorship it sees: a consumer that cannot get
 * the author cannot call `gradeRecord` and ends up writing its own weaker rule.
 * `query.ts` did exactly that, and graded every record from every author
 * `directive`.
 */
export declare const authorsOf: (cwd: string, shas: readonly string[]) => Map<string, string>;
/** Maps each commit to Git's exact `%GF` signing-key fingerprint. */
export declare const signerFingerprintsOf: (cwd: string, shas: readonly string[]) => Map<string, string>;
/**
 * Maps each annotated commit to **every** identity that has written the note
 * attached to it — the people who actually wrote the record text.
 *
 * `authorsOf` answers a different question, and answering #409's with it is
 * what made the forgery work: a note is a separate object written by whoever
 * ran `git notes add`, and grading its content by the annotated commit's author
 * hands the note writer that author's trust. The commit author never wrote the
 * text and cannot see it in their own message.
 *
 * **Every** writer, not the latest one, because a note is not overwritten the
 * way a trailer value is. `git notes merge -s cat_sort_uniq` concatenates two
 * writers' notes into one blob, and the walk then attributes that blob to
 * whichever of them committed last. Taking the latest would hand one writer's
 * text the other's trust whenever the trusted writer happened to go second —
 * the same forgery this fix exists to close, one merge further along. Returning
 * both lets `gradeDeclarations` keep the floor, which is what the rest of this
 * module already does across declarations.
 *
 * A note git cannot attribute has no entry, and a record with no known author
 * grades `claim`. Note paths are fanned out by git (`ab/cdef…`, sometimes
 * deeper), so the separators are stripped to recover the annotated sha.
 */
export interface NoteAuthor {
    readonly author: string;
    /** `%G?` from the note-writing commit; only `G` is verifier-trusted. */
    readonly signatureStatus: string;
    /** `%GF` from the note-writing commit. */
    readonly signerFingerprint: string;
}
export declare const noteAuthorsOf: (cwd: string) => Map<string, NoteAuthor[]>;
/**
 * Who to grade a record's declarations by, per source.
 *
 * A record can be declared by several commits and can arrive from both the
 * commit message and the notes mirror at once. Each declaration is graded by
 * the identity that wrote *that* declaration, and the floor is kept — the same
 * rule `restrictGrade` applies across commits, extended to the axis #409
 * showed was missing.
 *
 * A record whose only source is `notes` is therefore never graded by the
 * annotated commit's author, and a mirrored record cannot be promoted by the
 * friendlier of its two authorships. That downgrades a mirror written by a bot
 * identity to `claim` until the bot's author string is configured, which is the
 * fail-closed direction and is visible in the record's reason.
 *
 * A note carries every identity that has written it, not just the latest, so a
 * blob two writers were merged into is graded against both (`noteAuthorsOf`).
 *
 * Both consumer routes call this rather than looping themselves. `query.ts` and
 * `inject.ts` each had their own copy of the loop, and two implementations of
 * one policy is one implementation and one hole.
 */
export declare const gradeDeclarations: (record: Record, declarations: {
    shas: readonly string[];
    sources: readonly ("commit" | "notes")[];
    commitAuthors: ReadonlyMap<string, string>;
    /** `%G?` read with the batched trailer pass, keyed by commit sha. */
    commitSignatures: ReadonlyMap<string, string>;
    commitSignerFingerprints: ReadonlyMap<string, string>;
    noteAuthors: ReadonlyMap<string, readonly NoteAuthor[]>;
}, ctx: GradeContext) => Grade;
