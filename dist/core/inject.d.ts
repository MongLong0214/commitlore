/**
 * The injection projection (ADR-0006 decisions 2 and 3): the deterministic fold
 * that turns a path's active records into the text an agent is handed before it
 * reads or edits that path.
 *
 * Three properties define this module, and each one is a constraint on how it
 * may be written:
 *
 * ## It is deterministic, byte for byte
 *
 * No LLM call, no randomness, and no clock. `Date.now()` and `new Date()` are
 * not called here — the evaluation instant arrives as `opts.at`, resolved by
 * the command or hook before it calls this projection. The automatic route
 * supplies the final millisecond of the current UTC day, while callers that
 * need a historical answer supply their own instant. That keeps this module a
 * pure function of its inputs and keeps `cacheKey` honest: same inputs,
 * including the same lifecycle day, produce the same bytes.
 *
 * Every ordering is stated explicitly. Nothing here iterates a `Map` or a `Set`
 * and hopes; entries are sorted by (kind, commit instant, `Record-Id`, sha,
 * declaration order) before a single character is rendered.
 *
 * ## It routes by grade, and never re-derives one
 *
 * `core/grade.ts` decides whether a record is a `directive`, a `claim` or
 * `blocked` (SPEC §7). This module asks and obeys: a `directive` is rendered as
 * an instruction, a `claim` is rendered with the tag that says it is not one,
 * and a `blocked` record contributes nothing but a count — its content never
 * reaches the payload, because the content is the attack.
 *
 * A record declared several times is graded once per declaration and takes the
 * most restrictive answer. Trailer *values* fold latest-wins (SPEC §5); trust
 * does not, or an outside contributor could promote their own record to
 * `directive` by appending a commit.
 *
 * A declaration is graded by whoever wrote *it*, which for a record arriving
 * from the notes mirror is the note's author and not the annotated commit's
 * (#409). A mirrored record is therefore graded on both authorships and keeps
 * the floor.
 *
 * ## It is bounded, and says when it cut
 *
 * The budget is a token count (ADR-0006/PRD-F4: 800 by default), approximated
 * at `CHARS_PER_TOKEN` characters per token. When the projection does not fit,
 * entries are dropped from the lowest priority up — other, then `Ruled-out:`,
 * then `Limit:`, then `Warn:` — and both the count and the tier the cut reached
 * are reported in `Injection` and printed in the text. A silent truncation
 * would make an agent confident about a constraint list it never received.
 *
 * That report is the one thing the budget cannot buy back. Once no entry fits,
 * what remains is the header and the notices — and a budget too small even for
 * those is honoured by dropping records, never by dropping the sentence that
 * says records were dropped. `included === 0` is the only case in which `text`
 * may run past the budget, and it carries no record content at all.
 *
 * ## Each of those three can be switched off, one at a time
 *
 * Scoping, grade routing and the lifecycle filter are the three things this
 * module claims to buy. `AblationFlags` removes them individually so that
 * CommitLoreBench (ADR-0007, T-703) can measure what each one is worth instead
 * of asserting it. The flags default to `false` and are unreachable from the
 * CLI and the hook; a projection built without an `ablation` is byte-identical
 * to one built before they existed, which is the property that makes an arm
 * comparable to the baseline at all.
 */
/**
 * The three guarantees of this module, individually removable.
 *
 * **These are measurement instruments, not features.** An ablation arm is the
 * projection minus one guarantee with everything else held fixed, so that
 * CommitLoreBench can attribute a difference in agent behaviour to that
 * guarantee. Each flag therefore removes something the rest of this file exists
 * to provide, and `noGrade` in particular hands the agent content the trust
 * grader withheld on purpose.
 *
 * Nothing in `src/commands/` can set them: `injectOptions` builds
 * `InjectOptions` field by field out of parsed flags, so there is no path from
 * a command line, a hook payload or a settings file into this object. The only
 * caller that can is one holding a literal `AblationFlags`.
 *
 * Every flag defaults to `false`. Omitting `ablation` entirely, or passing one
 * with every flag false, produces the same bytes and the same `cacheKey` as a
 * build from before this interface existed — pinned by `test/inject.test.ts`,
 * because an ablation that moved the baseline would be comparing against
 * nothing.
 */
export interface AblationFlags {
    /**
     * Remove path scoping: project every record in the repository rather than one
     * path's.
     *
     * This is the one input `buildInjection` otherwise refuses. ADR-0006 ruled the
     * repository-wide dump out for injection on measured evidence, and the refusal
     * is lifted **here and only here**: an unscoped `opts.path` still throws
     * whenever this flag is not set, and setting it widens the projection even
     * when `opts.path` names a real file.
     */
    noScope?: boolean;
    /**
     * Remove trust routing: render every record as a `directive`, `core/grade.ts`
     * never consulted.
     *
     * That includes the records grading would have returned as `blocked`, whose
     * content is the prompt-injection payload the grader exists to withhold. An
     * arm that kept withholding them would be measuring the tag on the line
     * rather than the guarantee, so this one injects them. Bench workspaces only.
     */
    noGrade?: boolean;
    /**
     * Remove the lifecycle filter: inject superseded and expired records
     * alongside the active ones (SPEC §5).
     */
    noLifecycle?: boolean;
}
export interface InjectOptions {
    /**
     * The path to scope to. Required, and never repository-wide: `''` and `'.'`
     * are rejected rather than answered (see `buildInjection`), unless
     * `ablation.noScope` lifts the refusal.
     */
    path: string;
    /** Token budget for the whole payload. Defaults to `DEFAULT_BUDGET_TOKENS`. */
    budget?: number;
    /** The instant to evaluate against, resolved by the caller. */
    at: Date;
    cwd?: string;
    /** Authors whose records may render as instructions. Empty trusts nobody. */
    trustedAuthors?: readonly string[];
    /** Opt-in: a directive also needs Git's verified `G` signature status. */
    requireSignedDirective?: boolean;
    /** Answer from git alone, without the SQLite index. Same answers, slower. */
    noIndex?: boolean;
    /** Guarantees to remove. Bench instrumentation; every flag defaults to false. */
    ablation?: AblationFlags;
}
/** Which tier the budget cut reached, in priority order. */
export type Tier = 'warn' | 'limit' | 'ruled-out' | 'other';
/**
 * The result of one projection.
 *
 * `included` and `omitted` count **trailer values, not records** — one per
 * rendered line. A commit that recorded three `Limit:` lines constrains three
 * different things and contributes three (SPEC §2.1 B5 keeps every repeat for
 * exactly that reason), so a consumer that logs `included` as a record count
 * will overstate it. The record counts are `records` and `withheld`.
 */
export interface Injection {
    /** The final text handed to the agent. Empty when the path has nothing. */
    text: string;
    /** Trailer values rendered, one per line of the payload. */
    included: number;
    /**
     * Trailer values that did not reach the payload, in the same unit as
     * `included`: every value of a `blocked` record, plus every value the budget
     * cut. `included + omitted` is every *injectable* value the path's active
     * records carry — the keys in `INJECT_OMITTED_KEYS` are never
     * candidates and are counted in neither.
     */
    omitted: number;
    /** The highest-priority tier the budget cut reached, when it cut at all. */
    truncatedAt?: Tier;
    /** Cache key = HEAD sha + path + options. The same key means the same bytes. */
    cacheKey: string;
    /** The path as it was scoped, normalized. */
    path: string;
    /** The HEAD the projection was taken from; `''` in a repository with no commits. */
    head: string;
    /** The instant everything was evaluated against, ISO 8601. */
    at: string;
    /** The budget in effect, in tokens. */
    budgetTokens: number;
    /** **Records** — distinct — that contributed at least one rendered line. */
    records: number;
    /** **Records** excluded entirely because they graded `blocked`. */
    withheld: number;
    diagnostics: string[];
}
/**
 * Characters per token. A deliberate over-estimate of English prose density
 * (~3.5–4 chars/token for GPT-family encoders), chosen because it is a constant
 * a reader can check rather than a tokenizer this module would have to ship,
 * load, and keep in step with whatever model is on the other end. Overshooting
 * the true count spends less of the agent's window than the budget allows,
 * which is the direction that cannot break anything.
 */
export declare const CHARS_PER_TOKEN = 4;
/** PRD-F4 requirement 2: the default injection budget. */
export declare const DEFAULT_BUDGET_TOKENS = 800;
/**
 * Builds the path-scoped projection.
 *
 * **An unscoped request throws.** `runQuery` reads `''` and `'.'` as the whole
 * repository, and that is right for a query somebody typed — but ADR-0006 rules
 * out the repository-wide dump for *injection* specifically, on measured
 * evidence (the AGENTS.md result: unscoped context was conditionally harmful).
 * So the two modules genuinely disagree about that input, and the disagreement
 * is made loud rather than settled by returning nothing: a silent empty answer
 * would make "this path has no records" and "this call never scoped anything"
 * the same observation, which is the one failure this project cannot afford.
 *
 * The hook never reaches this: `hookResponse` answers with silence when it
 * cannot extract a path, because a hook that fails a tool call is worse than a
 * hook that says nothing.
 *
 * `opts.ablation.noScope` is the single exception, and it is an instrument
 * rather than a second opinion: the bench needs the projection ADR-0006
 * rejected in order to measure what rejecting it bought. The refusal below is
 * lifted by that flag and by nothing else.
 */
export declare const buildInjection: (opts: InjectOptions) => Injection;
