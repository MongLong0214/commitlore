/**
 * Squash inheritance (T-302, ADR-0004, PRD-F3 AC 1·2).
 *
 * A squash merge collapses a branch into one commit and destroys every trailer
 * block on it. What GitHub writes is a bulleted list of subjects, and a
 * `Key: value` line sitting inside prose is not a trailer block (SPEC §2.1 B3),
 * so `git interpret-trailers` finds nothing on the merge commit. That is defect
 * D3 — the reason "records are permanent" was a false claim before this module
 * existed, and the reason squash cannot simply be forbidden: the protocol has
 * to adapt to the workflow, not the other way round (ADR-0004 Ruled-out).
 *
 * The repair is in two halves, kept as separate functions so the GitHub Action
 * (T-602) can drive them with no CLI in the loop:
 *
 *   plan    `collectRange` -> `planSquash`      pure; reads git, writes nothing
 *   apply   `renderMessage` / `attachToNotes`   one returns text, one writes notes
 *
 * Both destinations are used because neither survives alone: the message block
 * is what path-scoped queries read (`commitlore limits -- <path>`), and the
 * notes mirror is what survives the next `rebase -i` (SPEC §1).
 *
 * Nothing here talks to a network. Writing `refs/notes/commitlore` is local;
 * publishing it is the user's or the Action's decision.
 *
 * ## One block per inherited record (bug-issue-60)
 *
 * This module used to fold every source record in the range into one merged
 * record: the branch's `Limit:`s, `Warn:`s and the rest all landed in a single
 * trailer block, `Record-Id:` was kept only when the range declared exactly
 * one, and `Provenance: inherited <sha>` named the newest source commit
 * regardless of how many records actually contributed. Two commits sharing a
 * `Record-Id` — an ordinary lifecycle update across a branch — is one record
 * and folds correctly. Two commits declaring *different* ids are two separate
 * decisions, and folding them into one record with a single identity was
 * always wrong: it either kept one id and silently discarded the other's
 * (findable-only-by-`Follows:` identity gone for good) or, with two or more,
 * kept neither.
 *
 * `planSquash` now produces one block per distinct record (`SquashPlan.blocks`
 * — SPEC §2.4's multi-record grammar), each keeping its own `Record-Id` when
 * the sources declared one, and its own `Provenance: inherited <sha>` naming
 * *that record's* newest source, never a different record's. `renderMessage`
 * and `attachToNotes` write the blocks as separate, blank-line-separated
 * paragraphs, so `commitlore validate`/`context`/the index recover every one
 * of them individually (`core/trailers.ts` `parseRecordBlocks`,
 * `core/index-db.ts`, `core/notes.ts` `readRecordBlocks`/`writeRecordBlocks`).
 *
 * `X-Inherited-From` — the old format's only way to say which source commit
 * an inherited record with an ambiguous identity actually came from — is no
 * longer written: a canonical `Provenance:` inside each record's own block
 * says that now, correctly, without an extension. `attachToNotes` still
 * reads an old note through the ordinary trailer parser and never rejects
 * one that carries the old key, because `X-<Name>:` is preserved and never
 * interpreted by the core (SPEC §3.2) — an already-published note keeps
 * resolving exactly as it did before this change.
 */

import { execGit } from './git.js';
import { listRecordShas, readRecordBlocks, writeRecordBlocks } from './notes.js';
import { parseCommitMessage, parseRecordBlocks, serializeTrailers } from './trailers.js';
import {
  BLAST_VALUES,
  CERTAINTY_VALUES,
  SINGLE_VALUED,
  UNDO_VALUES,
  type Trailer,
} from './types.js';

export interface SquashOptions {
  cwd?: string;
}

export interface AttachOptions extends SquashOptions {
  /** Replace an existing note on the target. Without it, one is an error. */
  force?: boolean;
}

/** One source commit's record, as the range gave it up. */
export interface CollectedRecord {
  /** The original commit — the sha the squash is about to make unreachable. */
  sha: string;
  trailers: Trailer[];
  recordId?: string;
}

/** Two commits declared the same `Record-Id` with different content. */
export interface RecordConflict {
  recordId: string;
  /** The source commit whose version won — the latest one in the range. */
  kept: string;
  /** The source commits whose versions differed from it. */
  dropped: readonly string[];
}

/** Where one inherited record lived before the squash. */
export interface ProvenanceEntry {
  recordId?: string;
  fromSha: string;
}

export interface SquashPlan {
  sources: CollectedRecord[];
  /**
   * One resolved trailer array per inherited record (SPEC §2.4), in the
   * order each record's identity first appears in the range — an
   * unidentified source contributes its own block at its own position.
   * Every block carries its own `Record-Id` (when the sources declared one)
   * and its own `Provenance: inherited <sha>`, naming that record's newest
   * source and no other's. Written out as separate paragraphs by
   * `renderMessage` / `attachToNotes`.
   */
  blocks: Trailer[][];
  /** Same `Record-Id`, contradictory content. Warned about, never silent. */
  conflicts: RecordConflict[];
  /** One entry per source record, in range order. */
  provenance: ProvenanceEntry[];
}

const RECORD_ID_KEY = 'Record-Id';
const PROVENANCE_KEY = 'Provenance';
const EXPIRES_KEY = 'Expires';
const VERSION_KEY = 'CommitLore-Version';

/**
 * The extension the pre-multi-record format used to carry per-source
 * provenance in the mirror, back when one ambiguous `Record-Id` situation
 * forced every inherited record into a single merged block (see this
 * module's own doc comment). `attachToNotes` no longer writes it — each
 * block's own `Provenance:` says the same thing correctly, without an
 * extension — but a note published before this change still carries it, and
 * nothing here refuses that note: `X-<Name>:` is preserved and never
 * interpreted by the core (SPEC §3.2), so it reads back exactly as before.
 * Exported for exactly that: tests and callers that need to construct or
 * recognize the old shape.
 */
export const INHERITED_FROM_KEY = 'X-Inherited-From';

/**
 * `-z` NUL-terminates each commit and a commit object cannot contain a NUL, so
 * the record boundary is unambiguous. The single US byte separates the sha from
 * the message; any further one is inside the message where it belongs.
 */
const UNIT = '\u001f';
const NUL = '\u0000';
const LOG_FORMAT = `%H${UNIT}%B`;

/**
 * A message with no line of the form `Key:` cannot contain a trailer under
 * git's grammar, so parsing it would spawn a process to be told nothing. This
 * never decides that a line *is* a trailer — B3 is exactly why that decision
 * stays with `git interpret-trailers`.
 */
const CANDIDATE_LINE_RE = /^[A-Za-z][A-Za-z0-9-]*:/m;

/** Shape-only gate for a date-form `Expires:` (SPEC §3.2). */
const DATE_SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SEMVER_CORE_RE = /^(\d+)\.(\d+)\.(\d+)/;

/**
 * How many paragraphs `stripTrailerBlock` will drop before giving up. A
 * message may legitimately carry several record-block paragraphs at its tail
 * now (SPEC §2.4) rather than one, plus any trailing `#` comment paragraphs an
 * editor draft leaves behind; a handful covers any real draft without the
 * bound looking like a message shaped unlike anything anticipated.
 */
const MAX_PARAGRAPH_DROPS = 8;

const gitOptions = (opts: SquashOptions): { cwd?: string } =>
  opts.cwd === undefined ? {} : { cwd: opts.cwd };

const firstLine = (text: string): string => (text.trim().split('\n')[0] ?? '').trim();

const trailerValue = (trailers: Trailer[], key: string): string | undefined =>
  trailers.find((trailer) => trailer.key === key)?.value;

const recordIdOf = (record: CollectedRecord): string | undefined =>
  record.recordId ?? trailerValue(record.trailers, RECORD_ID_KEY);

/** Every distinct `(key, value)` pair in a block, as the fold's dedupe keys it. */
const contentSet = (trailers: readonly Trailer[]): Set<string> =>
  new Set(trailers.map((trailer) => `${trailer.key}${NUL}${trailer.value}`));

/**
 * Matches one commit's message blocks against its mirrored note blocks
 * (SPEC §2.4), so a source commit that itself carries several record blocks —
 * ordinarily the previous squash-preserve run's own output, being squashed
 * again — contributes each of them once, message and note merged, rather
 * than the note's blocks being lost or duplicated.
 *
 * A message block and a note block are the same record when they declare the
 * same `Record-Id`, or — when neither declares one — when the message
 * block's trailers are all present in the note block's (the same rule
 * `core/query.ts`'s `foldMirroredNotes` uses to fold an unidentified mirror
 * into its commit). Matched pairs merge, keeping every distinct trailer of
 * either; an unmatched note block still contributes, on its own.
 */
const mergeCommitBlocks = (
  messageBlocks: readonly Trailer[][],
  noteBlocks: readonly Trailer[][],
): Trailer[][] => {
  const claimed = new Set<number>();
  const blocks: Trailer[][] = [];

  for (const messageBlock of messageBlocks) {
    const messageId = trailerValue(messageBlock, RECORD_ID_KEY);
    const contents = contentSet(messageBlock);
    const matchIndex = noteBlocks.findIndex((noteBlock, index) => {
      if (claimed.has(index)) return false;
      const noteId = trailerValue(noteBlock, RECORD_ID_KEY);
      if (messageId !== undefined || noteId !== undefined) return messageId === noteId;
      const noteContents = contentSet(noteBlock);
      return [...contents].every((entry) => noteContents.has(entry));
    });

    if (matchIndex === -1) {
      blocks.push(messageBlock);
      continue;
    }
    claimed.add(matchIndex);
    const merged = [...messageBlock];
    for (const trailer of noteBlocks[matchIndex] ?? []) {
      const duplicate = merged.some(
        (existing) => existing.key === trailer.key && existing.value === trailer.value,
      );
      if (!duplicate) merged.push(trailer);
    }
    blocks.push(merged);
  }

  noteBlocks.forEach((noteBlock, index) => {
    if (!claimed.has(index)) blocks.push(noteBlock);
  });

  return blocks;
};

/**
 * Reads the records of every commit in `range`, oldest first — the order the
 * merge rules mean by "latest".
 *
 * Both channels of SPEC §1 are read for each commit: the message's own record
 * blocks and the notes mirror's, matched and merged by `mergeCommitBlocks`. A
 * record that only ever existed as a note — one an earlier `squash-preserve`
 * attached, or one `harvest` wrote out of band — is inherited exactly like one
 * in a message, because the protocol does not rank the two sources.
 *
 * Commits that recorded nothing are absent from the result rather than present
 * and empty: they contribute no trailers and no provenance, and listing them
 * would put commits in `plan.sources` that no record came from (SPEC §4 — a
 * commit with no trailers is a commit that recorded nothing, not an error).
 *
 * Throws when `range` is not a range or names nothing; the caller turns that
 * into a usage exit. An empty range is not an error here — it yields `[]`, and
 * only the command knows whether that is worth failing over.
 */
export const collectRange = (range: string, opts: SquashOptions = {}): CollectedRecord[] => {
  if (!range.includes('..')) {
    // Without this a typo'd single ref would collect the whole history and
    // inherit every record in the repository onto one merge commit.
    throw new Error(`expected a range <base>..<head>, got ${JSON.stringify(range)}`);
  }

  const result = execGit(
    ['log', '--reverse', '-z', `--format=${LOG_FORMAT}`, '--end-of-options', range, '--'],
    gitOptions(opts),
  );
  if (result.code !== 0) {
    throw new Error(`cannot walk range ${JSON.stringify(range)}: ${firstLine(result.stderr)}`);
  }

  // One `git notes list` instead of one `git notes show` per commit: most
  // commits carry no note, and the mirror is usually far smaller than the range.
  const mirrored = new Set(listRecordShas(opts));

  const collected: CollectedRecord[] = [];
  for (const chunk of result.stdout.split(NUL)) {
    if (chunk.length === 0) continue;
    const separator = chunk.indexOf(UNIT);
    if (separator === -1) continue;

    const sha = chunk.slice(0, separator);
    const message = chunk.slice(separator + 1);
    const messageBlocks = CANDIDATE_LINE_RE.test(message) ? parseRecordBlocks(message) : [];
    const noteBlocks = mirrored.has(sha) ? readRecordBlocks(sha, opts) : [];
    const blocks = mergeCommitBlocks(messageBlocks, noteBlocks);

    for (const trailers of blocks) {
      if (trailers.length === 0) continue;
      const recordId = trailerValue(trailers, RECORD_ID_KEY);
      collected.push({ sha, trailers, ...(recordId === undefined ? {} : { recordId }) });
    }
  }

  return collected;
};

interface Candidate {
  value: string;
  sha: string;
}

type Resolver = (candidates: Candidate[]) => string;

/** The last source in the range — "latest wins", the default for a tie. */
const latest: Resolver = (candidates) => {
  const last = candidates[candidates.length - 1];
  return last === undefined ? '' : last.value;
};

/**
 * Picks the value furthest along `ordered`, which `types.ts` declares
 * least-risky first. A value outside the enum ranks below every legal one, so a
 * typo never outranks a real answer; if every candidate is a typo the latest
 * wins and `commitlore validate` reports it as the `enum` violation it is.
 */
const conservative =
  (ordered: readonly string[]): Resolver =>
  (candidates) => {
    let best = latest(candidates);
    let bestRank = -1;
    for (const candidate of candidates) {
      const rank = ordered.indexOf(candidate.value);
      if (rank > bestRank) {
        bestRank = rank;
        best = candidate.value;
      }
    }
    return best;
  };

/**
 * The earliest date-form `Expires:`, and a date in preference to a condition.
 * Merging must not extend a record's life: a condition never auto-expires, so
 * choosing one over a date would turn a record that retires itself into one
 * that has to be retired by hand. Among conditions there is nothing to order
 * on, so the latest source wins.
 */
const earliestExpiry: Resolver = (candidates) => {
  // ISO dates sort lexicographically in calendar order.
  const [earliest] = candidates
    .map((candidate) => candidate.value)
    .filter((value) => DATE_SHAPE_RE.test(value))
    .sort();
  return earliest ?? latest(candidates);
};

type SemverCore = [number, number, number];

const semverCore = (value: string): SemverCore | null => {
  const match = SEMVER_CORE_RE.exec(value);
  if (match === null) return null;
  const [, major = '0', minor = '0', patch = '0'] = match;
  return [Number(major), Number(minor), Number(patch)];
};

/** Left to right; the first differing component decides. */
const compareCore = (left: SemverCore, right: SemverCore): number => {
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a - b;
  }
  return 0;
};

/**
 * The highest `CommitLore-Version:` any source targeted. This one is not a risk
 * judgement: the merged record is the union of its sources' vocabularies, so it
 * needs the newest protocol version any of them needed in order to be read
 * without loss (SPEC §8). A value that is not semver is ignored rather than
 * ranked, and if none of them parse the latest source wins.
 */
const highestVersion: Resolver = (candidates) => {
  let best: string | undefined;
  let bestCore: SemverCore | null = null;

  for (const candidate of candidates) {
    const core = semverCore(candidate.value);
    if (core === null) continue;
    if (bestCore === null || compareCore(core, bestCore) > 0) {
      bestCore = core;
      best = candidate.value;
    }
  }

  return best ?? latest(candidates);
};

/**
 * How a single-valued key (SPEC §3 cardinality) is resolved when the sources
 * that declare *the same record* disagree. Every key in `SINGLE_VALUED` has an
 * entry here or is handled outside the fold, so nothing falls through to an
 * accident:
 *
 * | Key                  | Rule                                              |
 * |----------------------|---------------------------------------------------|
 * | `Blast`              | most conservative: `system` > `module` > `local`   |
 * | `Undo`               | most conservative: `permanent` > `costly` > `easy` |
 * | `Certainty`          | most conservative: `guess` > `tentative` > `firm`  |
 * | `Expires`            | earliest expiry; a date beats a condition          |
 * | `CommitLore-Version` | highest semver                                     |
 * | `Record-Id`          | the group's own identity, carried as-is            |
 * | `Provenance`         | never inherited; rewritten per block (`planSquash`)|
 *
 * The fold runs per record identity (`foldGroup`), not across the whole
 * range: two *different* records disagreeing about `Blast` is not a conflict
 * to resolve, because they are not the same record (that was the bug this
 * module used to have — see the module doc comment). Within one record, the
 * first three exist because the approval gate consumes them (SPEC §5):
 * `Blast: system` and `Undo: permanent` route a change to a human. If a
 * record's own history carried `Blast: local` on one commit and `Blast:
 * system` on a later one, taking the latest would let the order in which the
 * branch happened to be written decide whether a human ever sees the merge.
 * Collapsing toward the optimistic value turns a gate into a coin flip, so the
 * fold keeps the value that asks for more scrutiny — the one direction where
 * being wrong costs a review rather than an incident. `Certainty: guess` is
 * the same argument one route over: it is what the stale sweep surfaces
 * first, and a merge must not quietly promote a guess to firm.
 */
const RESOLVERS: ReadonlyMap<string, Resolver> = new Map<string, Resolver>([
  ['Blast', conservative(BLAST_VALUES)],
  ['Undo', conservative(UNDO_VALUES)],
  ['Certainty', conservative(CERTAINTY_VALUES)],
  [EXPIRES_KEY, earliestExpiry],
  [VERSION_KEY, highestVersion],
]);

/** One inherited record: the sources — oldest first — that all declare it, or the one that does not. */
interface RecordGroup {
  recordId?: string;
  members: CollectedRecord[];
}

/**
 * Groups the range's collected records by identity, in the order each
 * identity is first seen. An unidentified record forms a singleton group of
 * its own — there is no basis to fold two unidentified records together, only
 * a shared `Record-Id` says two declarations are the same decision (SPEC
 * §3.3).
 */
const groupRecords = (records: readonly CollectedRecord[]): RecordGroup[] => {
  const groups: RecordGroup[] = [];
  const byId = new Map<string, RecordGroup>();

  for (const record of records) {
    const recordId = recordIdOf(record);
    if (recordId === undefined) {
      groups.push({ members: [record] });
      continue;
    }
    let group = byId.get(recordId);
    if (group === undefined) {
      group = { recordId, members: [] };
      byId.set(recordId, group);
      groups.push(group);
    }
    group.members.push(record);
  }

  return groups;
};

/**
 * The `Record-Id`s declared more than once with different content. Comparison
 * is against the canonical block (SPEC §2.3), so a record merely restated in a
 * follow-up commit is not a conflict — only one whose content changed.
 */
const findConflicts = (groups: readonly RecordGroup[]): RecordConflict[] => {
  const conflicts: RecordConflict[] = [];

  for (const group of groups) {
    const { recordId, members } = group;
    const winner = members[members.length - 1];
    if (recordId === undefined || members.length < 2 || winner === undefined) continue;

    const kept = serializeTrailers(winner.trailers);
    const dropped = members
      .slice(0, -1)
      .filter((member) => serializeTrailers(member.trailers) !== kept)
      .map((member) => member.sha);

    if (dropped.length > 0) conflicts.push({ recordId, kept: winner.sha, dropped });
  }

  return conflicts;
};

/**
 * Folds one record's sources into the payload half of its block: every
 * distinct repeatable trailer, and each single-valued one resolved once by
 * `RESOLVERS`. `Record-Id` and `Provenance` are excluded here and added by
 * the caller — the group's identity and the record's own accurate
 * provenance are not sources to fold, they are what the fold is naming.
 *
 * Dedupe:
 * - **Repeatable keys** accumulate, dropping exact `(key, value)` repeats —
 *   a record refined across three commits contributes each distinct `Limit:`
 *   once, matching how the stale engine already resolves a re-declared
 *   record (`core/stale.ts`).
 * - **Single-valued keys** collect every candidate across the group's members
 *   and are resolved once. The merged record is one record, so it may carry
 *   at most one of each (SPEC §4) — folding them any other way produces
 *   output that fails `commitlore validate`.
 */
const foldGroup = (members: readonly CollectedRecord[]): Trailer[] => {
  const merged: Trailer[] = [];
  const candidates = new Map<string, Candidate[]>();
  const slots = new Map<string, number>();

  for (const record of members) {
    for (const trailer of record.trailers) {
      if (trailer.key === PROVENANCE_KEY || trailer.key === RECORD_ID_KEY) continue;

      if (SINGLE_VALUED.has(trailer.key)) {
        const list = candidates.get(trailer.key) ?? [];
        list.push({ value: trailer.value, sha: record.sha });
        candidates.set(trailer.key, list);
        // The resolved value lands where the key first appeared, so resolution
        // never reorders the record.
        if (!slots.has(trailer.key)) {
          slots.set(trailer.key, merged.length);
          merged.push({ key: trailer.key, value: trailer.value });
        }
        continue;
      }

      const duplicate = merged.some(
        (existing) => existing.key === trailer.key && existing.value === trailer.value,
      );
      if (!duplicate) merged.push({ key: trailer.key, value: trailer.value });
    }
  }

  for (const [key, list] of candidates) {
    const slot = slots.get(key);
    if (slot === undefined) continue;
    merged[slot] = { key, value: (RESOLVERS.get(key) ?? latest)(list) };
  }

  return merged;
};

/**
 * Folds the range's collected records into one block per distinct record —
 * findings 2 and 3 of bug-issue-60, together: identity survives (a group's
 * `Record-Id`, when it has one, is carried on its own block, never dropped
 * for ambiguity — there is nothing ambiguous about it once records are not
 * folded across identities), and `Provenance: inherited <sha>` names that
 * block's own newest source, correct for every block instead of true for at
 * most one.
 *
 * Blocks are ordered identified groups first (each at the position its
 * identity first appears in the range), then unidentified singleton records
 * last, in their own range order. That placement is not cosmetic: SPEC §2.4's
 * multi-record grammar recovers a *non-final* block only when it declares a
 * `Record-Id` (there being no other way to tell it apart from an incidental
 * `Key: value`-shaped body paragraph — see `parseRecordBlocks`). Putting the
 * unidentified ones last means that when there is exactly one, it is the
 * message's own last paragraph and needs no identity to be found again — the
 * ordinary, unconditional way `parseCommitMessage` has always recognized a
 * trailer block. When there is more than one, only the last survives a later
 * re-parse of the stored text; the plan computed here still names all of
 * them (`SquashPlan.blocks`, `warningsFor` in `commands/squash-preserve.ts`).
 */
export const planSquash = (records: CollectedRecord[]): SquashPlan => {
  const groups = groupRecords(records);
  const identified = groups.filter((group) => group.recordId !== undefined);
  const unidentified = groups.filter((group) => group.recordId === undefined);
  const ordered = [...identified, ...unidentified];

  const blocks = ordered.map((group) => {
    const newest = group.members[group.members.length - 1];
    const payload = foldGroup(group.members);
    const block: Trailer[] = [...payload];
    if (group.recordId !== undefined) block.push({ key: RECORD_ID_KEY, value: group.recordId });
    if (newest !== undefined) {
      block.push({ key: PROVENANCE_KEY, value: `inherited ${newest.sha}` });
    }
    return block;
  });

  return {
    sources: [...records],
    blocks,
    conflicts: findConflicts(groups),
    provenance: records.map((record) => {
      const recordId = recordIdOf(record);
      return { ...(recordId === undefined ? {} : { recordId }), fromSha: record.sha };
    }),
  };
};

/** The message without its final paragraph, or null when only one is left. */
const dropLastParagraph = (message: string): string | null => {
  const lines = message.split('\n');

  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? '').trim() === '') end -= 1;

  let start = end;
  while (start > 0 && (lines[start - 1] ?? '').trim() !== '') start -= 1;

  // The first paragraph is the subject, and git parses no trailers from a
  // message that is only a subject — there is nothing left to strip.
  if (start === 0) return null;

  return lines.slice(0, start).join('\n');
};

/**
 * Removes the trailing record-block paragraphs from a draft, leaving the
 * prose.
 *
 * A draft this module previously wrote may carry several trailing blocks now
 * (SPEC §2.4), one per inherited record, rather than the single block earlier
 * versions produced. This drops trailing paragraphs one at a time for as long
 * as each new last paragraph is still a trailer block — which correctly
 * strips any number of contiguous ones — and stops at the first paragraph
 * that is not (`stripTrailerBlock`'s original job: a draft out of an editor
 * can have `#` comment paragraphs after the real block, which git skips and a
 * paragraph count does not). Rather than re-deciding where a block ends —
 * the mistake SPEC §2.1 B3 exists to forbid — this only ever asks git again,
 * until git reports no trailers for what is currently last.
 */
const stripTrailerBlock = (message: string): string => {
  let text = message;
  for (let drops = 0; drops < MAX_PARAGRAPH_DROPS; drops += 1) {
    if (parseCommitMessage(text).length === 0) return text;
    const shorter = dropLastParagraph(text);
    if (shorter === null) return text;
    text = shorter;
  }
  return text;
};

/**
 * Rewrites a merge message draft so it carries the inherited records: the
 * prose of `base` with its trailing record-block paragraphs replaced by the
 * plan's, one block per paragraph, blank-line separated (SPEC §2.4).
 *
 * Replaced, not appended — running this twice on the same draft has to produce
 * the same message, because a re-run of the Action on an amended PR is ordinary
 * and a second set of blocks would leave the first as prose (B2), where
 * nothing would ever read it again.
 *
 * A plan with no blocks returns `base` untouched. Emptying somebody's merge
 * message because there was nothing to inherit is not an improvement.
 */
export const renderMessage = (base: string, plan: SquashPlan): string => {
  const body = plan.blocks
    .map(serializeTrailers)
    .filter((block) => block !== '')
    .join('\n');
  if (body === '') return base;

  const prose = stripTrailerBlock(base).replace(/\n+$/, '');
  return prose === '' ? body : `${prose}\n\n${body}`;
};

/**
 * Mirrors the inherited records onto the merge commit (SPEC §1: notes are "the
 * destination for records inherited across squash merges").
 *
 * One note, one block per inherited record (SPEC §2.4, `writeRecordBlocks`) —
 * the same shape `renderMessage` writes into a commit message, so a consumer
 * reading either channel recovers the same records with the same identities
 * and the same per-record provenance. Earlier versions of this function also
 * wrote `X-Inherited-From:` here to carry per-source provenance the message
 * channel's single `Provenance:` could not hold; that extension is no longer
 * needed (see this module's doc comment) and is not written by this version.
 *
 * Refuses to write when the plan inherited nothing: `git notes add` reads an
 * empty body as a deletion, and a plan with no blocks must not remove a note
 * somebody else put there.
 */
export const attachToNotes = (
  targetSha: string,
  plan: SquashPlan,
  opts: AttachOptions = {},
): void => {
  if (plan.blocks.length === 0) {
    throw new Error(`nothing to attach to ${targetSha}: the plan inherited no records`);
  }

  writeRecordBlocks(targetSha, plan.blocks, {
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    ...(opts.force === undefined ? {} : { force: opts.force }),
  });
};
