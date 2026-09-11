/**
 * Thin `git` child-process wrapper (SPEC §2: parsing is delegated to git, so
 * every module that needs git behavior goes through here).
 *
 * There is no custom Error subclass by design. A non-zero exit is ordinary
 * data — `execGit` returns it in `GitResult` and lets the caller judge.
 * Callers that want a failure to be fatal use `execGitOrThrow`, which throws a
 * plain `Error` carrying `code` and `stderr` as own properties.
 */
import { type SpawnSyncReturns } from 'node:child_process';
/** One `git` invocation's outcome. A non-zero `code` is a result, not a throw. */
export interface GitResult {
    stdout: string;
    stderr: string;
    code: number;
}
export interface ExecGitOptions {
    /** Written to git's stdin. */
    stdin?: string;
    cwd?: string;
    /** Environment passed to git. Defaults to this process's environment. */
    env?: NodeJS.ProcessEnv;
    /** Max bytes buffered from stdout/stderr. Defaults to 64 MiB. */
    maxBuffer?: number;
    /** Maximum time to wait for git before terminating it, in milliseconds. */
    timeout?: number;
}
/**
 * `code` reported when git never ran to completion (binary missing, output
 * over `maxBuffer`, killed by a signal). Distinct from any real git exit code,
 * which is 0-255.
 */
export declare const GIT_SPAWN_FAILED = -1;
/** Maps a completed spawn result to the git wrapper's stable result shape. */
export declare const gitResultFromSpawn: (result: SpawnSyncReturns<string>) => GitResult;
/**
 * Runs `git` with `args` and returns its outcome. Never throws for a git-level
 * failure; check `code`.
 *
 * The child is spawned without a shell, so nothing in `args` or `stdin` can be
 * reinterpreted as shell syntax — commit messages are untrusted input (SPEC §7
 * grades records precisely because anyone who can push can write one).
 */
export declare const execGit: (args: string[], opts?: ExecGitOptions) => GitResult;
export declare const isGitFailure: (error: unknown) => boolean;
/**
 * Runs `git` and returns stdout, throwing on any failure. The thrown `Error`
 * carries `code` and `stderr` as own properties so a caller can branch on them
 * programmatically without a custom Error class.
 */
export declare const execGitOrThrow: (args: string[], opts?: ExecGitOptions) => string;
/**
 * Resolves a revision a user typed — a branch, a tag, `HEAD~3`, or an
 * abbreviated object id — to the one full object id it names, or `null` when
 * git will not resolve it to exactly one commit.
 *
 * This is the only place an abbreviation is allowed to become an identity.
 * Everywhere downstream holds full ids and checks them with `isFullObjectId`,
 * so the ambiguity is settled once, by git, at the boundary where the user's
 * text arrives — rather than by a regex that cannot know what a prefix names.
 *
 * `--verify` is what makes an ambiguous prefix an error instead of a guess, and
 * `^{commit}` peels a tag to the commit it points at so an annotated tag does
 * not resolve to the tag object's own id. The result is checked rather than
 * trusted: `--quiet` turns "no such revision" into an empty stdout with a
 * non-zero code, and a caller reading stdout alone would accept `''` from a
 * git that failed in a way it did not anticipate.
 */
export declare const resolveRevision: (cwd: string, revision: string) => string | null;
/**
 * Whether this repository's history can be read, and if not, why.
 *
 * - `ready`       — git answered; an empty result is a statement about content
 * - `empty`       — a repository with no commits yet: a true empty
 * - `unavailable` — git could not answer. An empty result here is **not** a
 *                   statement about content, and must not be reported as one
 *
 * The third case is the reason this exists. `scanTrailers` read `git rev-parse
 * HEAD`, took `null` for an answer, and returned `[]` — so a repository whose
 * git was broken, absent, or not a repository at all produced
 * `{"records": [], "diagnostics": []}` and exit 0. That is the most dangerous
 * output this tool can produce: an agent reads "no constraints" as "nothing is
 * off limits", and here it was said with the same confidence as a genuine empty.
 *
 * `empty` is separated from `unavailable` deliberately. A freshly initialised
 * repository legitimately has nothing, and folding it into the failure case
 * would make `commitlore` refuse to run on the first commit of every project —
 * which trains people to ignore the failure that matters.
 */
export type HistoryAvailability = 'ready' | 'empty' | 'unavailable';
/**
 * Asks git whether it can read this repository's history.
 *
 * Two questions, because one cannot separate the cases. `rev-parse --verify
 * --quiet HEAD` exits 1 both when there are no commits and when this is not a
 * repository, so `rev-parse --git-dir` is asked first: it succeeds for an empty
 * repository and fails for everything else.
 */
export declare const historyAvailability: (cwd: string) => HistoryAvailability;
export declare const SHALLOW_HISTORY_CAVEAT = "this clone has shallow history, so this answer may be missing records that exist upstream";
export declare const hasShallowHistory: (cwd: string) => boolean;
/**
 * Where an answer was read from — the half of completeness nothing reported.
 *
 * Every other availability field describes a *source* or the *scan*: `history`
 * says whether the object store could be read, `notes` whether the mirror was
 * fetched, `coverage` and `unreadCommits` whether a budget truncated the walk.
 * All of them stay healthy while the walk starts from the wrong commit. The
 * commit source only ever reads `rev-list HEAD` (index-db.ts says so), so an
 * answer is complete *with respect to a vantage the caller never sees* — and a
 * checkout behind its own already-fetched upstream returns zero records with
 * `coverage: "complete"`, byte-identical to a repository where nobody wrote one.
 * That is the sentence `notes` exists to prevent, arriving by another door.
 *
 * `behind` is the whole signal, and the discrimination is the point:
 *
 *   at the tip                 behind 0     silent
 *   behind its upstream        behind n     the dangerous case, and only it
 *   detached (review worktree) upstream null, ref null -- stated, not warned:
 *                              that vantage is deliberate, and warning on it
 *                              would fire on every blind review
 *   an unmerged local branch   behind 0     silent; HEAD is not missing what
 *                              its own line never had
 *
 * Two cheaper-looking signals were measured and rejected because they fire on
 * healthy checkouts: `rev-list --branches --remotes --not HEAD` counts 202 on
 * this repository at the tip of main, and path-scoping it still counts 18 for
 * README.md. Both are answering "does any unreachable commit exist", which is
 * yes in every repository that has ever merged a branch.
 *
 * Cost, because r-4e29b7 asked for a number and had none: one `rev-parse` and
 * at most one `rev-list --count`, 18-21 ms together on a 1500-commit repository
 * with 623 refs, against 436 ms for the `context` call that carries it. Skipped
 * entirely when there is no upstream to be behind.
 */
export interface Vantage {
    /** The commit walked from. Every record in the answer is reachable from it. */
    readonly head: string | null;
    /** The branch HEAD is on, or null when detached. */
    readonly ref: string | null;
    /** The tracked upstream, or null when the branch tracks nothing. */
    readonly upstream: string | null;
    /**
     * Commits the upstream has that this vantage cannot reach, and whose records
     * are therefore absent from the answer. `null` when there is no upstream to
     * compare against -- unknown, not zero.
     */
    readonly behind: number | null;
}
export declare const readVantage: (cwd: string) => Vantage;
/** The caveat for a vantage that is behind, in the words a caller can act on. */
export declare const vantageCaveat: (vantage: Vantage) => string | null;
/**
 * Git's `%cI` for a UTC commit, spelled one way (#650).
 *
 * `%cI` is strict ISO 8601, and git changed how it renders a zero offset:
 * 2.39 emits `+00:00`, 2.50 emits `Z`. The same commit therefore reads
 * differently depending on the machine, and `committedAt` is a documented
 * field of the `--json` output — a consumer comparing strings, matching a
 * pattern, or feeding a strict parser gets different answers for one
 * repository.
 *
 * Only the UTC spelling is touched. A real offset carries information about
 * where the commit was made and is left exactly as git wrote it.
 */
export declare const canonicalCommittedAt: (value: string) => string;
