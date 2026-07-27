/**
 * Trust grading (SPEC §7, ADR-0005): the gate between what a commit *says* and
 * what an agent is allowed to *do*.
 *
 * A commit message is an instruction channel. Anyone who can land a commit —
 * including a fork PR author nobody has ever met — can write `Warn:` text that
 * an agent will read as if the repository itself said it. This module is the
 * minimum defence: every record is graded on the two axes of SPEC §7
 * (provenance × lifecycle) plus author trust, and `Warn:` only survives as a
 * `directive` when all three hold. Everything else degrades to `claim`
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
import type { Lifecycle, Provenance, Record } from './types.js';
/** How a record's `Warn:` may be delivered. */
export type Trust = 'directive' | 'claim' | 'blocked';
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
    /** 이 저장소에서 신뢰되는 작성자. 로컬은 --trusted-authors, Action은 GitHub API. */
    trustedAuthors?: readonly string[];
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
 *   (`i.g.n.o.r.e`), base64 or any other encoding.
 * - Any language other than English.
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
 * string by the time any pattern sees them.
 *
 * Match-only: the result is not safe to display. NFD leaves Hangul and other
 * scripts decomposed.
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
 * Whether `author` is on the repository's trusted list.
 *
 * Undefined or empty `trustedAuthors` trusts nobody. That default is the
 * feature: a caller that forgets to pass the list gets every record downgraded
 * to `claim`, which is loud and harmless — the opposite default would turn the
 * check off silently. There is no wildcard entry; `*` in the list matches an
 * author literally called `*`.
 *
 * Comparison is exact after trimming, with `Name <email>` also matching on
 * either half. An identity that differs by case does not match, and degrades to
 * `claim` — the safe direction for a misconfigured list.
 */
export declare const isTrustedAuthor: (author: string | undefined, trustedAuthors: readonly string[] | undefined) => boolean;
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
