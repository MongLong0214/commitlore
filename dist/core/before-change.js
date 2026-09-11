/**
 * T-1024 — `commitlore_before_change`: unified context + guard in one call.
 *
 * Returns path-scoped context (active decisions, verification gaps) alongside
 * an optional experimental guard result, with the two confidence levels kept
 * structurally separate per ADR-0020's confidence-separation constraint.
 *
 * ## Confidence separation
 *
 * `guard_confidence` qualifies `possible_revival_matches` and nothing else.
 * `active_decisions` and `verification_gaps` are path-scoped context — they
 * never inherit the guard's experimental grade. The schema is the asymmetry:
 * there is no `context_confidence` field, and the response carries exactly five
 * fields.
 *
 * ## Fail-closed
 *
 * When the repository cannot be read or notes are unfetched, the tool reports
 * the gap in `verification_gaps` rather than returning an empty context that
 * reads as "no constraints". This is the project's oldest defect class.
 */
import { createHash } from 'node:crypto';
import { execGit, hasShallowHistory, historyAvailability } from './git.js';
import { guard, renderGuardMatch } from './guard.js';
import { notesAvailability } from './notes.js';
import { withholdBlocked } from '../commands/query.js';
import { CONSUMER_SCAN_BUDGET_MS, runQuery, } from './query.js';
// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
/**
 * Derives the verification gaps from the repository state checks this codebase
 * already performs. The canonical order is fixed: `history-unavailable`,
 * `shallow-history`, `notes-unfetched`. `unread-commits` is appended after
 * the query, because only the query knows whether a budget left history unread.
 *
 * The two source gaps are taken from the query rather than re-measured, because
 * `runQuery` computes and returns both. Measured on the injection path -- the
 * one that runs on every file edit -- this route spawned 18 git processes, four
 * of them byte-identical repeats issued by this function and by the query it
 * then called. The same question asked twice in one invocation is the cost, and
 * the answer was already in hand.
 *
 * `history` stays measured here because it is what decides whether the query
 * runs at all; there is no result to read it from yet. When it says the history
 * is unavailable the query is skipped, and `sourceGapsFromRepository` measures
 * the other two directly -- the only branch that still pays for them.
 */
const historyGap = (cwd) => historyAvailability(cwd) === 'unavailable' ? ['history-unavailable'] : [];
/** The two source gaps, in canonical order, from values a query already reports. */
const sourceGaps = (shallow, notes) => [
    ...(shallow ? ['shallow-history'] : []),
    ...(notes === 'unfetched' ? ['notes-unfetched'] : []),
];
/** The same two, measured, for the branch where no query runs to report them. */
const sourceGapsFromRepository = (cwd) => sourceGaps(hasShallowHistory(cwd), notesAvailability({ cwd }));
/** Extracts the active decisions from the query result. */
const extractActiveDecisions = (result) => result.records.map((record) => ({
    recordId: record.recordId ?? null,
    sha: record.sha,
    trust: record.trust ?? null,
    paths: record.paths,
    trailers: record.trailers.map((t) => ({ key: t.key, value: t.value })),
}));
/**
 * Computes HEAD for the repository, or throws if the repository is completely
 * unreadable (fail-closed — no silent empty context).
 */
const resolveHead = (cwd) => {
    const result = execGit(['rev-parse', 'HEAD'], { cwd });
    if (result.code !== 0) {
        throw new Error(`commitlore_before_change: cannot read repository at ${cwd} — ` +
            'this is a failure, not an empty answer');
    }
    return result.stdout.trim();
};
/**
 * Builds a cache key. Two forms:
 * - Context-only (no proposal): `ctx:<sha>:<lifecycle-instant>:<path-hash>`
 * - With proposal: `full:<sha>:<lifecycle-instant>:<path-hash>:<proposal-hash>`
 *
 * The prefix makes the two forms structurally distinguishable, so a
 * context-snapshot key can never serve a proposal-bearing response.
 */
const buildCacheKey = (head, path, proposal, at) => {
    // The MCP edge supplies a UTC-day bucket for automatic calls. Preserve an
    // explicit instant exactly, because it can also decide which historical
    // commits existed when the caller asked the question.
    const lifecycleInstant = at.toISOString();
    const pathHash = createHash('sha256').update(path).digest('hex').slice(0, 16);
    if (proposal === undefined) {
        return `ctx:${head}:${lifecycleInstant}:${pathHash}`;
    }
    // Normalise the proposal before hashing: trim and collapse whitespace
    const normalised = proposal.trim().replace(/\s+/g, ' ');
    const proposalHash = createHash('sha256').update(normalised).digest('hex').slice(0, 16);
    return `full:${head}:${lifecycleInstant}:${pathHash}:${proposalHash}`;
};
/**
 * The unified before-change query. Returns exactly five fields.
 *
 * When `proposal` is omitted: context only, `guard_confidence: "not-run"`.
 * When `proposal` is supplied: context + experimental guard result.
 */
export const beforeChange = (opts) => {
    const cwd = opts.cwd ?? process.cwd();
    const path = opts.path;
    const at = opts.at;
    if (Number.isNaN(at.getTime())) {
        throw new Error('commitlore_before_change: opts.at is not a valid Date');
    }
    // Derive verification gaps — this determines whether we can trust the context.
    // The source gaps are appended below, in canonical order, from whichever of
    // the two routes ran.
    const gaps = historyGap(cwd);
    // If history is unavailable entirely, we still report what we can but the
    // caller knows the context is not trustworthy via the gap
    const historyUnavailable = gaps.includes('history-unavailable');
    // Attempt to resolve HEAD for the cache key. If history is unavailable,
    // use a sentinel value — fail-closed means we report the gap, not that we
    // crash on every non-repo directory.
    let head;
    if (historyUnavailable) {
        head = 'unavailable';
    }
    else {
        head = resolveHead(cwd);
    }
    // Query active decisions for this path
    let activeDecisions = [];
    if (!historyUnavailable) {
        // Withheld here, not in the caller. A record graded `blocked` matched an
        // injection pattern, and this tool's own MCP instructions tell the model
        // that `blocked` means the content was withheld. Returning the trailers
        // anyway made this the one surface that labelled a payload and then handed
        // it over -- `inject` and `commitlore_query` both strip it, and the model
        // reading this tool has no way to know the three routes disagreed.
        const queryResult = withholdBlocked(runQuery({
            cwd,
            at,
            scanBudgetMs: CONSUMER_SCAN_BUDGET_MS,
            ...(path === '' || path === '.' ? {} : { paths: [path] }),
            ...(opts.trustedAuthors === undefined ? {} : { trustedAuthors: opts.trustedAuthors }),
            ...(opts.requireSignedDirective === true ? { requireSignedDirective: true } : {}),
            ...(opts.trustedSignerFingerprints === undefined
                ? {}
                : { trustedSignerFingerprints: opts.trustedSignerFingerprints }),
        }));
        activeDecisions = extractActiveDecisions(queryResult);
        gaps.push(...sourceGaps(queryResult.shallow, queryResult.notes));
        if (queryResult.unreadCommits > 0)
            gaps.push('unread-commits');
    }
    else {
        gaps.push(...sourceGapsFromRepository(cwd));
    }
    // Run guard if a proposal was supplied
    let matches = [];
    let confidence = 'not-run';
    if (opts.proposal !== undefined && opts.proposal.trim() !== '') {
        if (!historyUnavailable) {
            const guardResult = guard({
                proposal: opts.proposal,
                cwd,
                at,
                ...(path === '' || path === '.' ? {} : { paths: [path] }),
                ...(opts.trustedAuthors === undefined ? {} : { trustedAuthors: opts.trustedAuthors }),
                ...(opts.requireSignedDirective === true ? { requireSignedDirective: true } : {}),
                ...(opts.trustedSignerFingerprints === undefined
                    ? {}
                    : { trustedSignerFingerprints: opts.trustedSignerFingerprints }),
            });
            matches = guardResult.matches.map(renderGuardMatch);
            confidence = 'experimental';
        }
        else {
            // History unavailable but a proposal was given, so the guard is skipped
            // here and never starts. This reported `timed-out` (#889): a completed
            // git failure presented as an expiry, with no guard execution and no
            // elapsed time behind it. Measured against a directory that is not a
            // repository — `git rev-parse --git-dir` exits 128 — the whole call
            // returned in ~37 ms claiming it had timed out.
            //
            // The gap already says why in `verification_gaps`; this says only that
            // the guard did not produce an answer, which is the honest reading of an
            // empty `possible_revival_matches` here.
            confidence = 'unavailable';
        }
    }
    const cacheKey = buildCacheKey(head, path, opts.proposal, at);
    return {
        active_decisions: activeDecisions,
        verification_gaps: gaps,
        possible_revival_matches: matches,
        guard_confidence: confidence,
        cache_key: cacheKey,
    };
};
//# sourceMappingURL=before-change.js.map