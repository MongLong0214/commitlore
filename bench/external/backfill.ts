/**
 * `revert_backfill` — manufacturing an answer key for a repository that never
 * kept one, out of the only decision class an arbitrary repository declares
 * mechanically: the commits it reverted.
 *
 * The procedure, every filter and the 0.5 return threshold are registered in
 * `bench/EXTERNAL-CORPUS.md` §5, before this file existed. Nothing here composes
 * a sentence: an accepted record's `Ruled-out:` value is the reverted commit's
 * own subject and the revert commit's own prose, cut by fixed rules.
 *
 * Two properties of the output decide how its numbers may be read, and both are
 * consequences of the procedure rather than caveats bolted onto it:
 *
 * 1. **Every record is correct by construction.** F6 keeps only reverts whose
 *    change is provably still gone at the pinned SHA. A delivery figure over
 *    this corpus is therefore an upper bound on a process nobody ran, not an
 *    estimate of one.
 * 2. **Records go to `refs/notes/commitlore`, never into a commit message.**
 *    `src/core/backfill.ts` refuses to rewrite history and so does this; the
 *    pinned SHAs of §3 would not survive it. The cost is that
 *    `git log --format=%B` cannot see the result, which is why §6.2 adds an arm
 *    rather than reporting a 0% as a fact about Git.
 */

import { createHash } from 'node:crypto';

import { command, git } from '../deterministic/shared.ts';
import type { RowBase } from '../deterministic/types.ts';
import type { CorpusIdentity, RevertBackfillRow } from './types.ts';

/** The line `git revert` writes itself, and the only candidate signal used. */
const REVERTS_LINE = /^[ \t]*This reverts commit ([0-9a-f]{7,40})\.?[ \t]*$/gm;

/** Trailer keys stripped from the reason half. Fixed in §5.5, not discovered. */
const REASON_NOISE =
  /^(?:Signed-off-by|Co-authored-by|Reviewed-by|Acked-by|Cc|Closes|Fixes|Refs|Ref|Resolves|Change-Id|Reverts):/i;

export const NOTES_REF = 'refs/notes/commitlore';
export const RETURN_THRESHOLD = 0.5;
/** Reported beside the chosen threshold so §5.4's 0.5 is auditable. */
export const ALTERNATIVE_THRESHOLDS = [0.25, 0.75] as const;
const MIN_CHECKABLE_LINES = 5;
const MIN_LINE_LENGTH = 8;
const ALTERNATIVE_CHARS = 120;
const REASON_CHARS = 240;
const RECORD_ID_HEX = 8;

export interface BackfilledRecord {
  readonly revertSha: string;
  readonly revertedSha: string;
  readonly recordId: string;
  readonly alternative: string;
  readonly reason: string;
  readonly reasonAbsent: boolean;
  readonly reasonTruncated: boolean;
  readonly returnShare: number;
  readonly paths: readonly string[];
  readonly block: string;
}

export interface BackfillFunnel {
  readonly candidates: number;
  readonly notExactlyOne: number;
  readonly unresolvable: number;
  readonly merge: number;
  readonly selfReverted: number;
  readonly tooLittleContent: number;
  readonly returned: number;
  readonly accepted: readonly BackfilledRecord[];
  readonly acceptedAt: ReadonlyMap<number, number>;
}

interface Commit {
  readonly sha: string;
  readonly parents: number;
  readonly message: string;
}

const readCommits = (repoRoot: string, ref: string): readonly Commit[] => {
  const raw = command('git', ['log', '--format=%H%x1f%P%x1f%B%x00', ref], {
    cwd: repoRoot,
  }).stdout.split('\0');
  raw.pop();
  return raw.map((entry) => {
    const body = entry.startsWith('\n') ? entry.slice(1) : entry;
    const [sha = '', parents = '', ...rest] = body.split('\x1f');
    return {
      sha,
      parents: parents.trim() === '' ? 0 : parents.trim().split(/\s+/).length,
      message: rest.join('\x1f'),
    };
  });
};

const namedReverts = (message: string): readonly string[] => {
  REVERTS_LINE.lastIndex = 0;
  const found: string[] = [];
  let match = REVERTS_LINE.exec(message);
  while (match !== null) {
    if (match[1] !== undefined) found.push(match[1]);
    match = REVERTS_LINE.exec(message);
  }
  return found;
};

const resolveCommit = (repoRoot: string, sha: string): string | null => {
  const result = git(repoRoot, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], {
    allowed: [0, 1],
  });
  return result.status === 0 ? result.stdout.trim() : null;
};

const isAncestor = (repoRoot: string, ancestor: string, descendant: string): boolean =>
  git(repoRoot, ['merge-base', '--is-ancestor', ancestor, descendant], { allowed: [0, 1] })
    .status === 0;

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The alternative half. `Ruled-out:` splits on the *first* `|` and SPEC §3.1
 * gives no escape, so a pipe in a commit subject would sever the value; it is
 * replaced rather than dropped, so the reader still sees where it was.
 */
export const alternativeOf = (subject: string, revertedSha: string): string => {
  const cleaned = collapse(subject).replace(/\|/g, '/');
  if (cleaned === '') return `commit ${revertedSha.slice(0, 9)}`;
  return cleaned.length <= ALTERNATIVE_CHARS ? cleaned : cleaned.slice(0, ALTERNATIVE_CHARS).trim();
};

export interface Reason {
  readonly text: string;
  readonly absent: boolean;
  readonly truncated: boolean;
}

/**
 * The reason half, from the revert commit's own prose. When the revert said
 * nothing, the value is a true statement about the commit rather than an
 * invented rationale — the one sentence in this file that is not quoted, and it
 * asserts only the absence of a reason.
 */
export const reasonOf = (message: string): Reason => {
  const lines = message.replace(/\r\n/g, '\n').split('\n').slice(1);
  const kept = lines.filter((line) => {
    REVERTS_LINE.lastIndex = 0;
    if (new RegExp(REVERTS_LINE.source).test(line)) return false;
    return !REASON_NOISE.test(line.trim());
  });
  const joined = collapse(kept.join(' '));
  if (joined === '') {
    return { text: 'no reason recorded in the revert message', absent: true, truncated: false };
  }
  if (joined.length <= REASON_CHARS) return { text: joined, absent: false, truncated: false };
  const cut = joined.slice(0, REASON_CHARS);
  const space = cut.lastIndexOf(' ');
  const trimmed = (space === -1 ? cut : cut.slice(0, space)).trim();
  return { text: `${trimmed} [truncated]`, absent: false, truncated: true };
};

export const recordIdFor = (revertSha: string): string =>
  `r-${createHash('sha256').update(revertSha).digest('hex').slice(0, RECORD_ID_HEX)}`;

/** SPEC §3 vocabulary order: decision context, then identity and provenance. */
export const blockFor = (record: {
  alternative: string;
  reason: string;
  recordId: string;
}): string =>
  [
    `Ruled-out: ${record.alternative} | ${record.reason}`,
    `Record-Id: ${record.recordId}`,
    'Provenance: reconstructed',
    '',
  ].join('\n');

/** Lines a commit added, per path, long enough to be worth matching on. */
const addedLines = (repoRoot: string, sha: string): ReadonlyMap<string, ReadonlySet<string>> => {
  const diff = command(
    'git',
    ['-c', 'core.quotepath=false', 'show', '--format=', '--unified=0', '--no-color', sha],
    { cwd: repoRoot },
  ).stdout;
  const byPath = new Map<string, Set<string>>();
  let current: string | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      current = target === '/dev/null' ? null : target.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('---') || line.startsWith('@@') || !line.startsWith('+')) continue;
    if (current === null) continue;
    const content = line.slice(1).trim();
    if (content.length < MIN_LINE_LENGTH) continue;
    const existing = byPath.get(current);
    if (existing === undefined) byPath.set(current, new Set([content]));
    else existing.add(content);
  }
  return byPath;
};

/** The file as it stands at the pinned ref, or null when it is no longer there. */
const blobLines = (repoRoot: string, ref: string, path: string): ReadonlySet<string> | null => {
  const result = git(repoRoot, ['show', `${ref}:${path}`], { allowed: [0, 128] });
  if (result.status !== 0) return null;
  return new Set(result.stdout.split('\n').map((line) => line.trim()));
};

/**
 * F6, the return check (§5.4). The tree at the pinned ref is read directly
 * rather than walked commit by commit: a change that came back and was removed
 * again is not back, and the tip is what an agent about to edit the file sees.
 */
export const returnShare = (
  repoRoot: string,
  ref: string,
  added: ReadonlyMap<string, ReadonlySet<string>>,
): { readonly share: number; readonly checkable: number } => {
  let checkable = 0;
  let worst = 0;
  for (const [path, lines] of added) {
    if (lines.size === 0) continue;
    checkable += lines.size;
    const present = blobLines(repoRoot, ref, path);
    if (present === null) continue;
    let matched = 0;
    for (const line of lines) if (present.has(line)) matched += 1;
    worst = Math.max(worst, matched / lines.size);
  }
  return { share: worst, checkable };
};

export const selectReverts = (
  repoRoot: string,
  ref: string,
  log: (line: string) => void = () => {},
): BackfillFunnel => {
  const commits = readCommits(repoRoot, ref);
  const parentsOf = new Map(commits.map((commit) => [commit.sha, commit.parents]));

  const candidates = commits.filter((commit) => namedReverts(commit.message).length > 0);
  // Every sha any revert in this history names, so F4 can ask whether a revert
  // was itself reverted. Built from all candidates, including the ones F1 to F3
  // drop: a bulk revert still reverses what it names.
  const revertedByAnyone = new Set<string>();
  for (const candidate of candidates) {
    for (const named of namedReverts(candidate.message)) {
      const resolved = resolveCommit(repoRoot, named);
      if (resolved !== null) revertedByAnyone.add(resolved);
    }
  }
  log(`backfill: ${candidates.length} revert candidates in ${commits.length} commits`);

  let notExactlyOne = 0;
  let unresolvable = 0;
  let merge = 0;
  let selfReverted = 0;
  let tooLittleContent = 0;
  let returned = 0;
  const accepted: BackfilledRecord[] = [];
  const acceptedAt = new Map<number, number>(ALTERNATIVE_THRESHOLDS.map((value) => [value, 0]));

  for (const candidate of candidates) {
    const named = namedReverts(candidate.message);
    if (named.length !== 1 || named[0] === undefined) {
      notExactlyOne += 1;
      continue;
    }
    const reverted = resolveCommit(repoRoot, named[0]);
    if (
      reverted === null ||
      reverted === candidate.sha ||
      !isAncestor(repoRoot, reverted, candidate.sha)
    ) {
      unresolvable += 1;
      continue;
    }
    if ((parentsOf.get(candidate.sha) ?? 0) > 1 || (parentsOf.get(reverted) ?? 0) > 1) {
      merge += 1;
      continue;
    }
    if (revertedByAnyone.has(candidate.sha)) {
      selfReverted += 1;
      continue;
    }

    const added = addedLines(repoRoot, reverted);
    const { share, checkable } = returnShare(repoRoot, ref, added);
    if (checkable < MIN_CHECKABLE_LINES) {
      tooLittleContent += 1;
      continue;
    }
    for (const threshold of ALTERNATIVE_THRESHOLDS) {
      if (share < threshold) acceptedAt.set(threshold, (acceptedAt.get(threshold) ?? 0) + 1);
    }
    if (share >= RETURN_THRESHOLD) {
      returned += 1;
      continue;
    }

    const subject = git(repoRoot, ['log', '-1', '--format=%s', reverted]).stdout.trim();
    const alternative = alternativeOf(subject, reverted);
    const reason = reasonOf(candidate.message);
    const recordId = recordIdFor(candidate.sha);
    accepted.push({
      revertSha: candidate.sha,
      revertedSha: reverted,
      recordId,
      alternative,
      reason: reason.text,
      reasonAbsent: reason.absent,
      reasonTruncated: reason.truncated,
      returnShare: share,
      paths: [...added.keys()],
      block: blockFor({ alternative, reason: reason.text, recordId }),
    });
  }

  const ids = new Set(accepted.map((record) => record.recordId));
  if (ids.size !== accepted.length) {
    throw new Error(`record id collision: ${accepted.length} records, ${ids.size} ids`);
  }
  return {
    candidates: candidates.length,
    notExactlyOne,
    unresolvable,
    merge,
    selfReverted,
    tooLittleContent,
    returned,
    accepted,
    acceptedAt,
  };
};

/**
 * Writes the accepted records to the notes mirror, replacing whatever was there.
 * Deleting the ref first is what makes a rerun idempotent: a second run over a
 * clone that already carries notes must produce the same mirror, not a merged
 * one.
 */
export const writeNotes = (repoRoot: string, records: readonly BackfilledRecord[]): number => {
  git(repoRoot, ['update-ref', '-d', NOTES_REF], { allowed: [0, 1] });
  for (const record of records) {
    git(repoRoot, ['notes', `--ref=${NOTES_REF}`, 'add', '-f', '-F', '-', record.revertSha], {
      input: record.block,
    });
  }
  return records.length;
};

export const backfillCorpus = (
  base: RowBase,
  repoRoot: string,
  identity: CorpusIdentity,
  log: (line: string) => void = () => {},
): { readonly row: RevertBackfillRow; readonly funnel: BackfillFunnel } => {
  const funnel = selectReverts(repoRoot, identity.ref, log);
  const written = writeNotes(repoRoot, funnel.accepted);
  const paths = new Set(funnel.accepted.flatMap((record) => record.paths));
  log(
    `backfill: ${identity.name} — ${funnel.accepted.length} of ${funnel.candidates} candidates ` +
      `accepted, ${written} notes written over ${paths.size} paths`,
  );
  return {
    funnel,
    row: {
      ...base,
      metric: 'revert_backfill',
      corpus: identity,
      candidates: funnel.candidates,
      dropped_not_exactly_one: funnel.notExactlyOne,
      dropped_unresolvable: funnel.unresolvable,
      dropped_merge: funnel.merge,
      dropped_self_reverted: funnel.selfReverted,
      dropped_too_little_content: funnel.tooLittleContent,
      dropped_returned: funnel.returned,
      accepted: funnel.accepted.length,
      accepted_at_return_threshold_025: funnel.acceptedAt.get(0.25) ?? 0,
      accepted_at_return_threshold_075: funnel.acceptedAt.get(0.75) ?? 0,
      return_threshold: RETURN_THRESHOLD,
      records_written: written,
      reason_absent: funnel.accepted.filter((record) => record.reasonAbsent).length,
      reason_truncated: funnel.accepted.filter((record) => record.reasonTruncated).length,
      notes_paths_touched: paths.size,
    },
  };
};
