/**
 * The answer key for `decision_delivery`: what records this repository holds,
 * and which of them are still active.
 *
 * **This module imports nothing from `src/` or `dist/`, and must not.** It is
 * the answer key for a measurement whose subject is `dist/core/inject.js`, so
 * reaching into the product for the answer would score the product against
 * itself. Everything below is Git plumbing plus a second implementation of the
 * SPEC §5 lifecycle fold; `test/decision-delivery.test.ts` pins the import ban.
 *
 * Where this fold and `src/core/stale.ts` disagree, the disagreement is the
 * finding. The counters this module exports exist so a divergence surfaces as a
 * number in the result row rather than as a silently wrong denominator.
 */

import { command } from './shared.ts';

const LOG_FORMAT = '--format=%H%x1f%cI%x1f%P%x1f%B%x00';
const TRAILER_PARSE_ARGS = [
  '-c',
  'trailer.separators=:',
  'interpret-trailers',
  '--parse',
  '--no-divider',
] as const;

const RECORD_ID_KEY = 'Record-Id';
const SUPERSEDES_KEY = 'Supersedes';
const EXPIRES_KEY = 'Expires';
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
/** A raw scan for retirements the paragraph walk below could not reach. */
const SUPERSEDES_LINE = /^Supersedes:[ \t]*(\S+)[ \t]*$/gm;
const EXPIRES_LINE = /^Expires:[ \t]*(\S+)[ \t]*$/gm;

export type Lifecycle = 'active' | 'superseded' | 'expired';

export interface Trailer {
  readonly key: string;
  readonly value: string;
}

export interface GoldRecord {
  readonly recordId: string;
  /** Every commit that declared this id, newest first. */
  readonly shas: readonly string[];
  /** Union of the paths changed by those commits. Empty for a merge-only record. */
  readonly paths: ReadonlySet<string>;
  readonly lifecycle: Lifecycle;
  /** The resolved `Expires:` value, verbatim, or null. */
  readonly expires: string | null;
}

export interface Census {
  /** The instant the fold was evaluated at: HEAD's committer instant. */
  readonly evaluatedAt: Date;
  readonly commitsExamined: number;
  readonly mergeCommits: number;
  readonly recordBearingCommits: number;
  readonly records: ReadonlyMap<string, GoldRecord>;
  readonly active: ReadonlySet<string>;
  readonly superseded: ReadonlySet<string>;
  readonly expired: ReadonlySet<string>;
  /** Records whose declaring commits changed no path — a merge carries none. */
  readonly recordsWithoutPaths: number;
  /** `Supersedes:` values the paragraph walk resolved. */
  readonly supersedesTrailersParsed: number;
  /** `Supersedes:` lines a raw scan of every message found. A gap means the walk missed one. */
  readonly supersedesLinesScanned: number;
  readonly expiresTrailersParsed: number;
  readonly expiresLinesScanned: number;
}

interface Commit {
  readonly sha: string;
  readonly committedAt: string;
  readonly parents: number;
  readonly message: string;
}

/** Git's own trailer parser, so the grammar is Git's rather than a regex here. */
const parseTrailers = (repoRoot: string, message: string): readonly Trailer[] =>
  command('git', TRAILER_PARSE_ARGS, { cwd: repoRoot, input: message })
    .stdout.split('\n')
    .filter((line) => line !== '')
    .flatMap((line) => {
      const at = line.indexOf(':');
      if (at === -1) return [];
      return [{ key: line.slice(0, at), value: line.slice(at + 1).trim() }];
    });

/**
 * One commit's record blocks.
 *
 * `interpret-trailers --parse` reads the final paragraph only, which is the
 * whole grammar for a single-record message. ADR-0014 allows several blocks in
 * one message, so earlier paragraphs that declare a `Record-Id` are re-parsed
 * on their own — the same walk `bench/deterministic/density.ts` uses to count
 * them.
 */
export const recordBlocks = (repoRoot: string, message: string): readonly (readonly Trailer[])[] => {
  const paragraphs = message
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .filter((paragraph) => paragraph.trim() !== '');
  const last = parseTrailers(repoRoot, message);
  const earlier = paragraphs
    .slice(0, -1)
    .filter((paragraph) => paragraph.includes(`${RECORD_ID_KEY}:`))
    .flatMap((paragraph) => {
      const block = parseTrailers(repoRoot, `x\n\n${paragraph}`);
      return block.some((trailer) => trailer.key === RECORD_ID_KEY) ? [block] : [];
    });
  return last.length === 0 ? earlier : [...earlier, last];
};

const valueOf = (trailers: readonly Trailer[], key: string): string | undefined =>
  trailers.find((trailer) => trailer.key === key)?.value;

/**
 * The instant a date-form `Expires:` stops being active: 00:00:00Z of the day
 * after the stated UTC day (SPEC §5). A free-text condition, or a date shape
 * that is not a real calendar date, never auto-expires.
 */
export const expiryEnd = (value: string | undefined): number | undefined => {
  if (value === undefined || !DATE_SHAPE.test(value)) return undefined;
  const start = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(start)) return undefined;
  if (new Date(start).toISOString().slice(0, 10) !== value) return undefined;
  return start + DAY_MS;
};

const countMatches = (pattern: RegExp, text: string): number => {
  pattern.lastIndex = 0;
  let total = 0;
  while (pattern.exec(text) !== null) total += 1;
  return total;
};

const readCommits = (repoRoot: string, ref: string): readonly Commit[] => {
  const raw = command('git', ['log', LOG_FORMAT, ref], { cwd: repoRoot }).stdout.split('\0');
  raw.pop();
  return raw.map((entry) => {
    const body = entry.startsWith('\n') ? entry.slice(1) : entry;
    const [sha = '', committedAt = '', parents = '', ...rest] = body.split('\x1f');
    return {
      sha,
      committedAt,
      parents: parents.trim() === '' ? 0 : parents.trim().split(/\s+/).length,
      message: rest.join('\x1f'),
    };
  });
};

/** The paths one commit changed. A merge shows none, which is what it means. */
const changedPaths = (repoRoot: string, sha: string): readonly string[] =>
  command('git', ['show', '--name-only', '--format=', '-z', sha], { cwd: repoRoot })
    .stdout.split('\0')
    .filter((path) => path !== '');

/**
 * Walks `ref`'s history and folds it into one state per `Record-Id`.
 *
 * Commits arrive newest first, so the first declaration seen of an id is the
 * latest one and wins for the single-valued `Expires:`; paths accumulate across
 * every declaration.
 */
export const buildCensus = (repoRoot: string, ref = 'HEAD'): Census => {
  const commits = readCommits(repoRoot, ref);
  const head = commits[0];
  if (head === undefined) throw new Error(`no commits at ${ref}`);
  const evaluatedAt = new Date(head.committedAt);
  if (Number.isNaN(evaluatedAt.getTime())) {
    throw new Error(`cannot read a committer instant from ${ref}`);
  }
  const cutoff = evaluatedAt.getTime();

  const declarations = new Map<string, { shas: string[]; expires: string | null }>();
  const superseded = new Set<string>();
  const shasWithRecords = new Set<string>();
  let mergeCommits = 0;
  let supersedesTrailersParsed = 0;
  let expiresTrailersParsed = 0;
  let supersedesLinesScanned = 0;
  let expiresLinesScanned = 0;

  for (const commit of commits) {
    if (commit.parents > 1) mergeCommits += 1;
    supersedesLinesScanned += countMatches(SUPERSEDES_LINE, commit.message);
    expiresLinesScanned += countMatches(EXPIRES_LINE, commit.message);

    for (const block of recordBlocks(repoRoot, commit.message)) {
      const recordId = valueOf(block, RECORD_ID_KEY);
      for (const trailer of block) {
        if (trailer.key !== SUPERSEDES_KEY) continue;
        supersedesTrailersParsed += 1;
        // A duplicate declaration may name its own id to resolve the duplicate.
        // That updates the record; it does not retire the identity (SPEC §5).
        if (trailer.value === recordId) continue;
        superseded.add(trailer.value);
      }
      if (recordId === undefined) continue;
      shasWithRecords.add(commit.sha);
      const expires = valueOf(block, EXPIRES_KEY);
      if (expires !== undefined) expiresTrailersParsed += 1;
      const existing = declarations.get(recordId);
      if (existing === undefined) {
        declarations.set(recordId, { shas: [commit.sha], expires: expires ?? null });
        continue;
      }
      existing.shas.push(commit.sha);
      // Newest first, so an earlier declaration never overwrites the latest value.
      if (existing.expires === null && expires !== undefined) existing.expires = expires;
    }
  }

  const pathsOf = new Map<string, readonly string[]>();
  for (const sha of shasWithRecords) pathsOf.set(sha, changedPaths(repoRoot, sha));

  const records = new Map<string, GoldRecord>();
  const active = new Set<string>();
  const expired = new Set<string>();
  let recordsWithoutPaths = 0;

  for (const [recordId, declaration] of declarations) {
    const paths = new Set<string>();
    for (const sha of declaration.shas) for (const path of pathsOf.get(sha) ?? []) paths.add(path);
    if (paths.size === 0) recordsWithoutPaths += 1;

    const end = expiryEnd(declaration.expires ?? undefined);
    const isExpired = end !== undefined && cutoff >= end;
    // Superseded outranks expired: retiring a record is a deliberate act.
    const lifecycle: Lifecycle = superseded.has(recordId)
      ? 'superseded'
      : isExpired
        ? 'expired'
        : 'active';
    if (lifecycle === 'active') active.add(recordId);
    if (lifecycle === 'expired') expired.add(recordId);
    records.set(recordId, {
      recordId,
      shas: declaration.shas,
      paths,
      lifecycle,
      expires: declaration.expires,
    });
  }

  // A `Supersedes:` naming an id this history never declared retires nothing.
  const retired = new Set([...superseded].filter((recordId) => records.has(recordId)));

  return {
    evaluatedAt,
    commitsExamined: commits.length,
    mergeCommits,
    recordBearingCommits: shasWithRecords.size,
    records,
    active,
    superseded: retired,
    expired,
    recordsWithoutPaths,
    supersedesTrailersParsed,
    supersedesLinesScanned,
    expiresTrailersParsed,
    expiresLinesScanned,
  };
};
