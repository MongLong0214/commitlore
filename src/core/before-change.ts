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
import { guard, renderGuardMatch, type RenderedGuardMatch } from './guard.js';
import { notesAvailability } from './notes.js';
import { withholdBlocked } from '../commands/query.js';
import { runQuery, valuesOf, type GradedRecord, type QueryResult } from './query.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The three verification gaps this codebase checks for, in canonical order. */
export type VerificationGap = 'history-unavailable' | 'shallow-history' | 'notes-unfetched';

/** Guard confidence enum — qualifies `possible_revival_matches` only. */
export type GuardConfidence = 'not-run' | 'experimental' | 'timed-out';

/** One active decision record, as surfaced to the caller. */
export interface ActiveDecision {
  recordId: string | null;
  sha: string;
  trust: string | null;
  paths: string[];
  trailers: Array<{ key: string; value: string }>;
}

/** The response shape — exactly five fields, no more, no less. */
export interface BeforeChangeResult {
  active_decisions: ActiveDecision[];
  verification_gaps: VerificationGap[];
  possible_revival_matches: RenderedGuardMatch[];
  guard_confidence: GuardConfidence;
  cache_key: string;
}

export interface BeforeChangeOptions {
  path: string;
  proposal?: string;
  cwd?: string;
  /** Authors whose active records may direct the caller. */
  trustedAuthors?: readonly string[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Derives the verification gaps from the repository state checks this codebase
 * already performs. The canonical order is fixed: `history-unavailable`,
 * `shallow-history`, `notes-unfetched`.
 */
const deriveVerificationGaps = (cwd: string): VerificationGap[] => {
  const gaps: VerificationGap[] = [];

  const history = historyAvailability(cwd);
  if (history === 'unavailable') {
    gaps.push('history-unavailable');
  }

  const shallow = hasShallowHistory(cwd);
  if (shallow) {
    gaps.push('shallow-history');
  }

  const notes = notesAvailability({ cwd });
  if (notes === 'unfetched') {
    gaps.push('notes-unfetched');
  }

  return gaps;
};

/** Extracts the active decisions from the query result. */
const extractActiveDecisions = (result: QueryResult): ActiveDecision[] =>
  result.records.map((record) => ({
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
const resolveHead = (cwd: string): string => {
  const result = execGit(['rev-parse', 'HEAD'], { cwd });
  if (result.code !== 0) {
    throw new Error(
      `commitlore_before_change: cannot read repository at ${cwd} — ` +
        'this is a failure, not an empty answer',
    );
  }
  return result.stdout.trim();
};

/**
 * Builds a cache key. Two forms:
 * - Context-only (no proposal): `ctx:<sha>:<path-hash>`
 * - With proposal: `full:<sha>:<path-hash>:<proposal-hash>`
 *
 * The prefix makes the two forms structurally distinguishable, so a
 * context-snapshot key can never serve a proposal-bearing response.
 */
const buildCacheKey = (head: string, path: string, proposal: string | undefined): string => {
  const pathHash = createHash('sha256').update(path).digest('hex').slice(0, 16);
  if (proposal === undefined) {
    return `ctx:${head}:${pathHash}`;
  }
  // Normalise the proposal before hashing: trim and collapse whitespace
  const normalised = proposal.trim().replace(/\s+/g, ' ');
  const proposalHash = createHash('sha256').update(normalised).digest('hex').slice(0, 16);
  return `full:${head}:${pathHash}:${proposalHash}`;
};

/**
 * The unified before-change query. Returns exactly five fields.
 *
 * When `proposal` is omitted: context only, `guard_confidence: "not-run"`.
 * When `proposal` is supplied: context + experimental guard result.
 */
export const beforeChange = (opts: BeforeChangeOptions): BeforeChangeResult => {
  const cwd = opts.cwd ?? process.cwd();
  const path = opts.path;

  // Derive verification gaps — this determines whether we can trust the context
  const gaps = deriveVerificationGaps(cwd);

  // If history is unavailable entirely, we still report what we can but the
  // caller knows the context is not trustworthy via the gap
  const historyUnavailable = gaps.includes('history-unavailable');

  // Attempt to resolve HEAD for the cache key. If history is unavailable,
  // use a sentinel value — fail-closed means we report the gap, not that we
  // crash on every non-repo directory.
  let head: string;
  if (historyUnavailable) {
    head = 'unavailable';
  } else {
    head = resolveHead(cwd);
  }

  // Query active decisions for this path
  let activeDecisions: ActiveDecision[] = [];
  if (!historyUnavailable) {
    // Withheld here, not in the caller. A record graded `blocked` matched an
    // injection pattern, and this tool's own MCP instructions tell the model
    // that `blocked` means the content was withheld. Returning the trailers
    // anyway made this the one surface that labelled a payload and then handed
    // it over -- `inject` and `commitlore_query` both strip it, and the model
    // reading this tool has no way to know the three routes disagreed.
    const queryResult = withholdBlocked(
      runQuery({
        cwd,
        ...(path === '' || path === '.' ? {} : { paths: [path] }),
        ...(opts.trustedAuthors === undefined ? {} : { trustedAuthors: opts.trustedAuthors }),
      }),
    );
    activeDecisions = extractActiveDecisions(queryResult);
  }

  // Run guard if a proposal was supplied
  let matches: RenderedGuardMatch[] = [];
  let confidence: GuardConfidence = 'not-run';

  if (opts.proposal !== undefined && opts.proposal.trim() !== '') {
    if (!historyUnavailable) {
      const guardResult = guard({
        proposal: opts.proposal,
        cwd,
        ...(path === '' || path === '.' ? {} : { paths: [path] }),
        ...(opts.trustedAuthors === undefined ? {} : { trustedAuthors: opts.trustedAuthors }),
      });
      matches = guardResult.matches.map(renderGuardMatch);
      confidence = 'experimental';
    } else {
      // History unavailable but proposal given — guard cannot run meaningfully
      confidence = 'timed-out';
    }
  }

  const cacheKey = buildCacheKey(head, path, opts.proposal);

  return {
    active_decisions: activeDecisions,
    verification_gaps: gaps,
    possible_revival_matches: matches,
    guard_confidence: confidence,
    cache_key: cacheKey,
  };
};
