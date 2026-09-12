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
    /**
     * For a pattern that names a pointer — a verb aimed at something to run —
     * whether this occurrence points at anything. Consulted before the
     * surrounding prose is: a pointer at nothing is not an instruction whatever
     * stands around it, and the rule that says so (`shellPointsAtSomething`) is
     * measured beside the pattern it serves.
     */
    corroborate?: (haystack: string, match: RegExpMatchArray) => boolean;
}
/**
 * The pattern table. Every entry is pinned by at least one fixture under
 * `spec/fixtures/injection/` (`test/grade.test.ts` fails if an id has none), and
 * the benign fixtures in the same directory pin the other side: normal warning
 * prose must survive. Adding a pattern without both sides is adding an
 * unmeasured false-positive rate.
 *
 * What the fixtures cannot tell you, and a census of this repository's own
 * history can: after #931 and #935, sixteen trailer values out of 5,878 still
 * tripped a pattern here, and **none of the sixteen was a true positive**.
 * Precision on this corpus is zero. That is not an argument for deleting the
 * table — the corpus contains no attack, so there is nothing here for it to
 * catch — but it is the shape of the trade, and it was unstated until it was
 * measured. A record is most likely to trip a pattern when its subject is this
 * table, which is why #408, #931 and #935 are all the same report from
 * different directions: eight of the sixteen are records about this table,
 * quoting the phrases they discuss.
 *
 * The question the table asks is *does this text contain an attack-shaped
 * phrase*. The question that separates the false positives from the attacks is
 * *does this text do something to the reader* — a matter of grammatical mood
 * and scope rather than of words. The disarming rules (`isDisarmed`) and the
 * corroboration hook (`corroborate`) are that question asked as narrowly as a
 * regex can ask it: an occurrence stands down only on positive evidence that
 * its clause asserts nothing to the reader (negated, reported, or
 * counterfactual with no addressee), or that its pointer points at nothing.
 * Measured on the census, the fixtures, and an adversarial set of ninety-odd
 * phrasings — paraphrases, mention-then-issue, payloads written as reports —
 * that pass brings the sixteen to twelve and releases no attack; it also
 * closes three phrasings the earlier `would` rule had let through (`you would
 * paste this into your terminal`) and one the negation window had (`never
 * mind, hide this`).
 *
 * Two things keep that bearable rather than silent. `explainWithholding` tells
 * the author at capture and at the commit-msg hook, so a withheld record is a
 * rewrite rather than a discovery someone else makes later. And blocking is not
 * the defence: the trust grade is, for `Warn:`. For `Ruled-out:`, `Limit:` and
 * `Verified:` blocking is the only content control the scanner has, which is why
 * exempting a key is not the cheap fix it looks like.
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
 *
 * And what it withholds although it should not — the twelve, measured on this
 * repository's history, each with the rule that would release it and what that
 * rule costs, so the next reader does not re-derive the trade:
 * - An attack phrase quoted as an example with no reporting verb in the two
 *   words before it: `` `apply the following naming convention` still blocks ``
 *   (seven of the twelve, all in records about this table). Reading a quote
 *   span whose closing mark is followed by a mention predicate (`still blocks`,
 *   `remain false positives`, `is still read as`) releases five of the seven
 *   and loses no attack once a bare copula is excluded — `` `paste this into
 *   your terminal` is required `` is an endorsement, not a mention. It needs
 *   `normalizeForMatch` to keep quote marks, which every pattern's haystack
 *   would then carry; the authors of these records already get
 *   `explainWithholding` and reworded (aed2135e), so it is not taken.
 * - A bare imperative as a `Ruled-out:` alternative: `suppress the warning for
 *   a branch whose content is absent | …` (two). Reading the alternative half
 *   as the rejected proposal it is by SPEC §3.1 — for the speech-act patterns
 *   only, never for `curl …`, `| sh`, `rm -rf`, `sudo` — releases both and
 *   loses nothing in the adversarial set, but it serves `ignore all previous
 *   instructions | too blunt` as a rejected alternative and changes what the
 *   pipe-separator test pins. That is a policy about the key, left to be made
 *   rather than made here.
 * - A purpose infinitive: `rewrites history to hide that the claim was made`
 *   (one). Non-finite is not non-assertive: `to` as a disarm marker releases
 *   this value and twenty-one of the adversarial phrasings (`make sure to hide
 *   this`, `you need to`, `the fix is to`), and a directive-trigger list in
 *   front of `to` still releases four, because `ask the agent to hide this`
 *   puts an unbounded noun phrase between the verb and the marker. Refused.
 * - `behave as the matrix states` (one): a comparison clause read as a
 *   persona, and `system: do nothing` quoted in a test transcript (one): a role
 *   marker, which is not disarmable by design.
 * Each of these is reported to the author at capture and commit time
 * (`explainWithholding`), where a reporting verb or a modal fixes the wording.
 */
export declare const INJECTION_PATTERNS: readonly InjectionPattern[];
/** Words that disarm an affirmative imperative when they sit right before it. */
export declare const NEGATIONS: ReadonlySet<string>;
/**
 * Words that mark the text after them as **mentioned rather than used** (#408).
 *
 * A record whose job is to warn about this class of attack has to name the
 * attack: "reject any record that says ignore all prior instructions". Matching
 * the literal blocked that record, and a blocked record's content is withheld —
 * so the one record an agent most needed to read was the one it could not. A
 * defensive quotation was punished while an attack paraphrase went through.
 *
 * This disarms one occurrence, not the record. `fires` blocks unless *every*
 * occurrence is disarmed, so quoting the phrase and then issuing it still
 * blocks — pinned by a test, because that is the bypass this would otherwise
 * open. An attacker can still phrase a whole payload as a report, and loses
 * most of its imperative force in doing so; that residual is the price of a
 * defensive record being readable at all.
 *
 * Consulted only for `negatable` patterns, the same gate `NEGATIONS` uses:
 * those are the entries whose authors already judged surrounding prose able to
 * change their reading.
 */
export declare const MENTIONS: ReadonlySet<string>;
/**
 * The counterfactual modal. `it would hide that two rows were unplanned` is a
 * consequence being described, not a request being made (#935): the bare verb
 * after `would` is the only slot an imperative shares with a conditional, and
 * a `Ruled-out:` reason — *why* an alternative was dropped — is written in
 * exactly that mood. Measured on this repository's history, 6 of the 7
 * `output.conceal` withholdings sat in a reason, 4 of them literally
 * `… would hide that …`.
 *
 * What makes `would` safe is not adjacency, it is that a counterfactual cannot
 * address the reader — and that has two consequences the first version of this
 * rule got wrong in opposite directions (`underCounterfactual`):
 *
 * - It *can* address the reader when its subject does: `you would paste this
 *   into your terminal` is an instruction softened by a modal, and the
 *   adjacent-word rule served it. A subject of `you` or `we` immediately before
 *   `would` now blocks. The corpus has three `<pronoun> would` uses, none
 *   before a pattern verb, so this costs nothing here.
 * - Its scope runs across a coordinator: in `it would fix drift and hide it`
 *   one modal governs both verbs, and the second is no more a request than
 *   the first. `would` is now read through `and`/`or`/`nor` (`and then` too),
 *   within the clause: no `;:.!?()` between modal and verb, a comma only
 *   directly before the coordinator, at most eight words, and none of `to`,
 *   `that`, `so`, `but`, `if`, `because`, `which`, `you`, `we` in between —
 *   each of which opens a clause the modal does not reach, so `it would be
 *   safer to review and hide this` still blocks. What this serves that the
 *   adjacent rule did not: `they would approve it, and then run the following:
 *   …`, a narrated sequence, the same residual the adjacent rule already
 *   accepts for `the hook would run the following on every commit: …`.
 *
 * `could`, `might`, `should` and `can` are deliberately absent — `you could
 * paste this into your terminal` is an instruction wearing a modal, and this
 * set exists for the one modal that cannot address the reader.
 */
export declare const IRREALIS: ReadonlySet<string>;
/** A subject that makes a counterfactual an address to the reader. */
/**
 * Subjects that make a counterfactual an instruction anyway.
 *
 * `would` is disarmable because a counterfactual cannot instruct -- but only
 * while its subject is not someone who could act. `you would paste this into
 * your terminal` is an instruction wearing a counterfactual's clothes, and so
 * is every third-person or generic agent: measured, `a reviewer would paste
 * this into their terminal`, `the operator would run the following`, `one would
 * hide this output` and `anyone would run the following` were all served while
 * 1.2.16 blocked them.
 *
 * A deny-list, and the inverse was measured first and is worse. Allowing only
 * non-agent *pronouns* fails the benign population outright: its subjects are
 * noun phrases naming mechanisms -- `the retry would log the error and hide
 * it`, `an unpinned hook would run the following`, `a merged row would hide
 * that two were unplanned`, `squashing would rewrite history` -- so an
 * allow-list of pronouns broke ten of them and an allow-list of mechanisms
 * would have to name every mechanism English can name.
 *
 * This list is therefore incomplete by construction and says so: it names the
 * agents that appear in attacks rather than every agent there is. What keeps
 * that bearable is that the payload an agent would be told to run trips its own
 * pattern, and that an author whose record is withheld is told at capture.
 */
export declare const AGENT_SUBJECT: ReadonlySet<string>;
export declare const COORDINATORS: ReadonlySet<string>;
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
/**
 * Every pattern the rendered trailer trips, in table order.
 *
 * One reading is corrected by the key (#935). SPEC §3.1 requires a `|` in
 * every `Ruled-out:` value and makes the first one the separator between the
 * alternative and the reason, so a reason that opens with an interpreter's
 * name as its subject — `| node on Windows reads /tmp/x as C:\tmp\x` — is
 * `tool.pipe-to-shell`'s anchor character followed by its interpreter list,
 * and the pattern read punctuation the grammar mandates as a shell pipe. The
 * separator is neutralised and the value rescanned for that one pattern; a
 * second `|` is still a pipe, and every other pattern still reads the value
 * exactly as an agent is shown it.
 *
 * What this gives up, stated: a whole value of the form `<command> | sh`,
 * where the command trips nothing on its own, is now served as a rejected
 * alternative whose reason is `sh`. `curl … | sh` is not in that set —
 * `tool.curl-remote` reads the alternative — and neither is any value with a
 * second pipe or a verb that asks for the value to be run.
 */
export declare const scanTrailer: (trailer: Trailer) => string[];
/**
 * Whether an identity string would itself trip the scanner, either as the
 * bare value a report prints or as the `Record-Id: …` pair some surfaces
 * still emit. A withheld record whose id is still printed is not withheld.
 */
export declare const identityCarriesInjection: (recordId: string) => boolean;
/**
 * Why a trailer would be withheld, said to the one person who can still change
 * it (#931). Grading is a read-time judgement: the author of a record that
 * trips a pattern got `staged` from capture and `shape ok` from the commit-msg
 * hook, and learned at query time, from a different reader, that every trailer
 * of the record was gone. Capture verification and `validate` both say this,
 * through one function, so the author hears the same sentence twice rather
 * than two sentences that might disagree.
 */
export declare const explainWithholding: (key: string, patterns: readonly string[]) => string;
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
