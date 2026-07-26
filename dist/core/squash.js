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
 */
import { execGit } from './git.js';
import { listRecordShas, readRecord, writeRecord } from './notes.js';
import { parseCommitMessage, serializeTrailers } from './trailers.js';
import { BLAST_VALUES, CERTAINTY_VALUES, SINGLE_VALUED, UNDO_VALUES, } from './types.js';
const RECORD_ID_KEY = 'Record-Id';
const PROVENANCE_KEY = 'Provenance';
const EXPIRES_KEY = 'Expires';
const VERSION_KEY = 'CommitLore-Version';
/**
 * The repeatable extension that carries per-source provenance in the mirror.
 *
 * `Provenance:` cannot do this job. It is single-valued (SPEC §3.2) and its
 * grammar admits exactly one sha — `^(authored|reconstructed|unknown|inherited
 * [0-9a-f]{7,40})$` in `spec/schema/record.schema.json` — so a record that
 * inherited from four commits has no legal way to say so with that key. An
 * `X-<Name>:` extension is repeatable and is preserved verbatim by every
 * conforming implementation (SPEC §3.2, §8), which makes it the only place the
 * per-source mapping can live without producing a record that fails
 * `commitlore validate`. See `attachToNotes`.
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
 * How many paragraphs `stripTrailerBlock` will drop before giving up. The
 * trailer block is the last paragraph (SPEC §2.1 B1/B2), so one drop is enough
 * unless the draft has trailing `#` comment paragraphs that git skipped; a
 * handful covers any real editor template, and the bound keeps a message shaped
 * unlike anything anticipated from looping.
 */
const MAX_PARAGRAPH_DROPS = 8;
const gitOptions = (opts) => opts.cwd === undefined ? {} : { cwd: opts.cwd };
const firstLine = (text) => (text.trim().split('\n')[0] ?? '').trim();
const trailerValue = (trailers, key) => trailers.find((trailer) => trailer.key === key)?.value;
const recordIdOf = (record) => record.recordId ?? trailerValue(record.trailers, RECORD_ID_KEY);
/**
 * Reads the records of every commit in `range`, oldest first — the order the
 * merge rules mean by "latest".
 *
 * Both channels of SPEC §1 are read for each commit: the message block and the
 * notes mirror, merged with `(key, value)` duplicates dropped. A record that
 * only ever existed as a note — one an earlier `squash-preserve` attached, or
 * one `harvest` wrote out of band — is inherited exactly like one in a message,
 * because the protocol does not rank the two sources.
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
export const collectRange = (range, opts = {}) => {
    if (!range.includes('..')) {
        // Without this a typo'd single ref would collect the whole history and
        // inherit every record in the repository onto one merge commit.
        throw new Error(`expected a range <base>..<head>, got ${JSON.stringify(range)}`);
    }
    const result = execGit(['log', '--reverse', '-z', `--format=${LOG_FORMAT}`, '--end-of-options', range, '--'], gitOptions(opts));
    if (result.code !== 0) {
        throw new Error(`cannot walk range ${JSON.stringify(range)}: ${firstLine(result.stderr)}`);
    }
    // One `git notes list` instead of one `git notes show` per commit: most
    // commits carry no note, and the mirror is usually far smaller than the range.
    const mirrored = new Set(listRecordShas(opts));
    const collected = [];
    for (const chunk of result.stdout.split(NUL)) {
        if (chunk.length === 0)
            continue;
        const separator = chunk.indexOf(UNIT);
        if (separator === -1)
            continue;
        const sha = chunk.slice(0, separator);
        const message = chunk.slice(separator + 1);
        const trailers = CANDIDATE_LINE_RE.test(message) ? parseCommitMessage(message) : [];
        if (mirrored.has(sha)) {
            for (const trailer of readRecord(sha, opts)) {
                const duplicate = trailers.some((existing) => existing.key === trailer.key && existing.value === trailer.value);
                if (!duplicate)
                    trailers.push(trailer);
            }
        }
        if (trailers.length === 0)
            continue;
        const recordId = trailerValue(trailers, RECORD_ID_KEY);
        collected.push({ sha, trailers, ...(recordId === undefined ? {} : { recordId }) });
    }
    return collected;
};
/** The last source in the range — "latest wins", the default for a tie. */
const latest = (candidates) => {
    const last = candidates[candidates.length - 1];
    return last === undefined ? '' : last.value;
};
/**
 * Picks the value furthest along `ordered`, which `types.ts` declares
 * least-risky first. A value outside the enum ranks below every legal one, so a
 * typo never outranks a real answer; if every candidate is a typo the latest
 * wins and `commitlore validate` reports it as the `enum` violation it is.
 */
const conservative = (ordered) => (candidates) => {
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
const earliestExpiry = (candidates) => {
    // ISO dates sort lexicographically in calendar order.
    const [earliest] = candidates
        .map((candidate) => candidate.value)
        .filter((value) => DATE_SHAPE_RE.test(value))
        .sort();
    return earliest ?? latest(candidates);
};
const semverCore = (value) => {
    const match = SEMVER_CORE_RE.exec(value);
    if (match === null)
        return null;
    const [, major = '0', minor = '0', patch = '0'] = match;
    return [Number(major), Number(minor), Number(patch)];
};
/** Left to right; the first differing component decides. */
const compareCore = (left, right) => {
    for (let index = 0; index < left.length; index += 1) {
        const a = left[index] ?? 0;
        const b = right[index] ?? 0;
        if (a !== b)
            return a - b;
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
const highestVersion = (candidates) => {
    let best;
    let bestCore = null;
    for (const candidate of candidates) {
        const core = semverCore(candidate.value);
        if (core === null)
            continue;
        if (bestCore === null || compareCore(core, bestCore) > 0) {
            bestCore = core;
            best = candidate.value;
        }
    }
    return best ?? latest(candidates);
};
/**
 * How a single-valued key (SPEC §3 cardinality) is resolved when the sources
 * disagree. Every key in `SINGLE_VALUED` has an entry here or is handled
 * outside the fold, so nothing falls through to an accident:
 *
 * | Key                  | Rule                                              |
 * |----------------------|---------------------------------------------------|
 * | `Blast`              | most conservative: `system` > `module` > `local`   |
 * | `Undo`               | most conservative: `permanent` > `costly` > `easy` |
 * | `Certainty`          | most conservative: `guess` > `tentative` > `firm`  |
 * | `Expires`            | earliest expiry; a date beats a condition          |
 * | `CommitLore-Version` | highest semver                                     |
 * | `Record-Id`          | kept only when unambiguous (`planSquash`)          |
 * | `Provenance`         | never inherited; rewritten (`planSquash`)          |
 *
 * The first three exist because the approval gate consumes them (SPEC §5):
 * `Blast: system` and `Undo: permanent` route a change to a human. If a branch
 * carried `Blast: local` on one commit and `Blast: system` on another, taking
 * the latest would let the order in which the branch happened to be written
 * decide whether a human ever sees the merge. Collapsing toward the optimistic
 * value turns a gate into a coin flip, so the merge keeps the value that asks
 * for more scrutiny — the one direction where being wrong costs a review rather
 * than an incident. `Certainty: guess` is the same argument one route over: it
 * is what the stale sweep surfaces first, and a merge must not quietly promote
 * a guess to firm.
 */
const RESOLVERS = new Map([
    ['Blast', conservative(BLAST_VALUES)],
    ['Undo', conservative(UNDO_VALUES)],
    ['Certainty', conservative(CERTAINTY_VALUES)],
    [EXPIRES_KEY, earliestExpiry],
    [VERSION_KEY, highestVersion],
]);
const groupByRecordId = (records) => {
    const groups = new Map();
    for (const record of records) {
        const recordId = recordIdOf(record);
        if (recordId === undefined)
            continue;
        const members = groups.get(recordId) ?? [];
        members.push(record);
        groups.set(recordId, members);
    }
    return groups;
};
/**
 * The `Record-Id`s declared more than once with different content. Comparison
 * is against the canonical block (SPEC §2.3), so a record merely restated in a
 * follow-up commit is not a conflict — only one whose content changed.
 */
const findConflicts = (groups) => {
    const conflicts = [];
    for (const [recordId, members] of groups) {
        const winner = members[members.length - 1];
        if (members.length < 2 || winner === undefined)
            continue;
        const kept = serializeTrailers(winner.trailers);
        const dropped = members
            .slice(0, -1)
            .filter((member) => serializeTrailers(member.trailers) !== kept)
            .map((member) => member.sha);
        if (dropped.length > 0)
            conflicts.push({ recordId, kept: winner.sha, dropped });
    }
    return conflicts;
};
/**
 * Folds the source records into the one record the merge commit will carry.
 *
 * `records` is expected oldest first, as `collectRange` returns it; "latest"
 * everywhere below means "later in that order".
 *
 * Dedupe:
 * - **Repeatable keys** accumulate, dropping exact `(key, value)` repeats. That
 *   is the content dedupe for records with no `Record-Id`, and it is also what
 *   happens inside a `Record-Id` group — a record refined across three commits
 *   contributes each distinct `Limit:` once, matching how the stale engine
 *   already resolves a re-declared record (`core/stale.ts`).
 * - **Single-valued keys** collect every candidate and are resolved once, by
 *   `RESOLVERS`. The merged record is one record, so it may carry at most one
 *   of each (SPEC §4) — folding them any other way produces output that fails
 *   `commitlore validate`.
 * - **Conflicts** are reported at `Record-Id` granularity and never resolved
 *   silently: `conflicts` names the commit whose version was kept and the ones
 *   that differed, and the caller prints them.
 *
 * Identity is the one thing a squash can genuinely lose. `Record-Id` is
 * single-valued, so when the range declared two of them neither can be the
 * merge record's identity, and inventing or arbitrarily picking one would
 * re-attribute context to a record that never carried it. The rule is
 * therefore: keep the `Record-Id` when the range declared exactly one, omit it
 * otherwise. Every identity, kept or not, survives in `provenance` and reaches
 * the mirror through `attachToNotes`, so the mapping from a record to where it
 * lived stays auditable even when it stops being declared. SPEC §3.3 wants an
 * identity to be stable across a squash, and this delivers that for the case
 * that matters most — one record refined over a branch — while refusing to fake
 * it for the case a single-record note cannot represent.
 *
 * `Provenance:` is not inherited from the sources: a source's value describes
 * the source. The merge record's own value is `inherited <sha>` naming the
 * newest source commit — the one sha that reaches the whole squashed branch
 * through its ancestry, and the only one the key's grammar has room for.
 */
export const planSquash = (records) => {
    const groups = groupByRecordId(records);
    const merged = [];
    const candidates = new Map();
    const slots = new Map();
    for (const record of records) {
        for (const trailer of record.trailers) {
            if (trailer.key === PROVENANCE_KEY || trailer.key === RECORD_ID_KEY)
                continue;
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
            const duplicate = merged.some((existing) => existing.key === trailer.key && existing.value === trailer.value);
            if (!duplicate)
                merged.push({ key: trailer.key, value: trailer.value });
        }
    }
    for (const [key, list] of candidates) {
        const slot = slots.get(key);
        if (slot === undefined)
            continue;
        merged[slot] = { key, value: (RESOLVERS.get(key) ?? latest)(list) };
    }
    const [onlyId, ...otherIds] = [...groups.keys()];
    if (onlyId !== undefined && otherIds.length === 0) {
        merged.push({ key: RECORD_ID_KEY, value: onlyId });
    }
    const newest = records[records.length - 1];
    if (newest !== undefined) {
        merged.push({ key: PROVENANCE_KEY, value: `inherited ${newest.sha}` });
    }
    return {
        sources: [...records],
        merged,
        conflicts: findConflicts(groups),
        provenance: records.map((record) => {
            const recordId = recordIdOf(record);
            return { ...(recordId === undefined ? {} : { recordId }), fromSha: record.sha };
        }),
    };
};
/** The message without its final paragraph, or null when only one is left. */
const dropLastParagraph = (message) => {
    const lines = message.split('\n');
    let end = lines.length;
    while (end > 0 && (lines[end - 1] ?? '').trim() === '')
        end -= 1;
    let start = end;
    while (start > 0 && (lines[start - 1] ?? '').trim() !== '')
        start -= 1;
    // The first paragraph is the subject, and git parses no trailers from a
    // message that is only a subject — there is nothing left to strip.
    if (start === 0)
        return null;
    return lines.slice(0, start).join('\n');
};
/**
 * Removes the existing trailer block from a draft, leaving the prose.
 *
 * The block is the last paragraph (SPEC §2.1 B1/B2), but a draft out of an
 * editor can have `#` comment paragraphs after it, which git skips and a
 * paragraph count does not. Rather than re-deciding where the block is — the
 * mistake B3 exists to forbid — this drops the last paragraph and asks git
 * again, until git reports no trailers.
 */
const stripTrailerBlock = (message) => {
    let text = message;
    for (let drops = 0; drops < MAX_PARAGRAPH_DROPS; drops += 1) {
        if (parseCommitMessage(text).length === 0)
            return text;
        const shorter = dropLastParagraph(text);
        if (shorter === null)
            return text;
        text = shorter;
    }
    return text;
};
/**
 * Rewrites a merge message draft so it carries the inherited record: the prose
 * of `base` with its trailer block replaced by the plan's canonical one.
 *
 * Replaced, not appended — running this twice on the same draft has to produce
 * the same message, because a re-run of the Action on an amended PR is ordinary
 * and a second block would leave the first one as prose (B2), where nothing
 * would ever read it again.
 *
 * A plan with no trailers returns `base` untouched. Emptying somebody's merge
 * message because there was nothing to inherit is not an improvement.
 */
export const renderMessage = (base, plan) => {
    const block = serializeTrailers(plan.merged);
    if (block === '')
        return base;
    const prose = stripTrailerBlock(base).replace(/\n+$/, '');
    return prose === '' ? block : `${prose}\n\n${block}`;
};
/**
 * Mirrors the inherited record onto the merge commit (SPEC §1: notes are "the
 * destination for records inherited across squash merges").
 *
 * The note is the plan's canonical block plus one `X-Inherited-From:` per
 * source record — `<record-id> <sha>` when the source declared an id, `<sha>`
 * when it did not. That is where "which original did this come from" is
 * answered per record: the message can only carry one `Provenance: inherited
 * <sha>` (see `INHERITED_FROM_KEY`), so the message says *that* the record was
 * inherited and the mirror says *from what*. Both halves validate — `X-<Name>`
 * is repeatable and preserved verbatim by the core (SPEC §3.2) — so a merge
 * commit produced here passes `commitlore validate` on both channels.
 *
 * Refuses to write an empty record: `git notes add` reads an empty body as a
 * deletion, and a plan with nothing in it must not remove a note somebody else
 * put there.
 */
export const attachToNotes = (targetSha, plan, opts = {}) => {
    const seen = new Set();
    const inherited = [];
    for (const entry of plan.provenance) {
        const value = entry.recordId === undefined ? entry.fromSha : `${entry.recordId} ${entry.fromSha}`;
        if (seen.has(value))
            continue;
        seen.add(value);
        inherited.push({ key: INHERITED_FROM_KEY, value });
    }
    const trailers = [...plan.merged, ...inherited];
    if (trailers.length === 0) {
        throw new Error(`nothing to attach to ${targetSha}: the plan inherited no records`);
    }
    writeRecord(targetSha, trailers, {
        ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
        ...(opts.force === undefined ? {} : { force: opts.force }),
    });
};
//# sourceMappingURL=squash.js.map