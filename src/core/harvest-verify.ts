/**
 * Harvest verification — the checker half of maker–checker (ADR-0006 §5, T-404).
 *
 * T-403 hands the session a prompt and format-checks whatever comes back.
 * Format is not truth. A draft can name every field correctly, cite every claim
 * it makes, and still quote a sentence nobody ever said. This module asks the
 * one question that separates a record from a plausible sentence: is it *there*,
 * in the transcript or the diff the session was actually given?
 *
 * Everything here is deterministic — no model, no network, no clock. Asking a
 * model whether a model told the truth is the same failure mode with an extra
 * invoice, which is why ADR-0006 ruled out self-checking harvest agents.
 *
 * The bias is fixed and it is not neutral: when this module is unsure, it
 * discards. A true record wrongly dropped costs a reader nothing — they are
 * exactly where they were before CommitLore existed. A fabricated one that gets
 * through is read by an agent that cannot check it, and it misdirects every
 * agent after that. Hence the rule this file exists to enforce: no record is
 * better than a false record.
 *
 * What it will not do is block. Verification runs next to somebody's commit,
 * and a commit that fails because an optional enrichment step found nothing is
 * a feature people switch off (ADR-0006: 전량 실패 시 비차단).
 */

import {
  loadVocabulary,
  type DraftEvidence,
  type DraftRecord,
  type EvidenceSource,
} from './harvest.js';
import { validateRecord } from './schema.js';
import type { Violation } from './types.js';

/** Why a drafted record was discarded. */
export type RejectionReason =
  /** The quote is not in the source it names. */
  | 'evidence-not-found'
  /** A claim the record makes has nothing behind it. */
  | 'evidence-missing'
  /** A value outside a closed vocabulary (SPEC §3.1). */
  | 'enum'
  /** A value that does not match its grammar, or a cardinality breach (SPEC §6). */
  | 'format'
  /** A key SPEC §3 does not define. */
  | 'unknown-key'
  /** `Ruled-out:` with nothing in the source showing the alternative turned down. */
  | 'ruled-out-no-rejection';

export interface VerifiedRecord {
  record: DraftRecord;
}

export interface RejectedRecord {
  record: DraftRecord;
  reason: RejectionReason;
  detail: string;
}

export interface VerifyResult {
  accepted: VerifiedRecord[];
  rejected: RejectedRecord[];
}

/** The originals a citation is checked against — the same two the session saw. */
export interface Sources {
  transcript: string;
  diff: string;
}

/**
 * Phrases that mark a transcript *turning something down* rather than merely
 * mentioning it. `Ruled-out:` is the one key whose truth condition is not
 * visible in a quote alone: "we could use a queue worker" and "we ruled out the
 * queue worker" quote equally well, and only the second is a record.
 *
 * The table is deliberately short. Every phrase added here is a phrase that can
 * launder a mention into a rejection, and the cost of a missing marker (a true
 * `Ruled-out:` discarded) is one the protocol has already agreed to pay.
 *
 * Matched case-insensitively against the whitespace-collapsed neighbourhood of
 * the quote, with curly apostrophes folded to straight ones so that `won’t` and
 * `won't` are one phrase rather than two.
 */
export const REJECTION_MARKERS: readonly string[] = [
  // English — the alternative was turned down
  'reject',
  'rule out',
  'ruled out',
  'ruling out',
  'rule it out',
  'ruled it out',
  'ruling it out',
  'ruled against',
  'decided against',
  'instead',
  'rather than',
  'not an option',
  'not viable',
  'not possible',
  'not worth',
  'out of the question',
  'no good',
  'too expensive',
  'too slow',
  'discard',
  'abandon',
  'drop it',
  'drop that',
  'dropped it',
  'dropping it',
  'gave up',
  'give up',
  'walked away',
  'does not work',
  "doesn't work",
  "won't",
  'will not',
  "can't",
  'cannot',
  'can not',
  // Korean
  '대신',
  '기각',
  '배제',
  '제외',
  '포기',
  '탈락',
  '접었',
  '버렸',
  '버린다',
  '버리기로',
  '안 되는 이유',
  '불가능',
  '하지 않기로',
  '쓰지 않기로',
  '못 쓴다',
  '안 쓴다',
];

/**
 * How far from the quote a rejection marker may sit: the quoted lines, plus one
 * line on either side. In a transcript a line is an utterance, so this is "the
 * thing that was said, and what was said either side of it" — a boundary a
 * reader can check by eye. A character radius would have been easier to write
 * and impossible to describe.
 */
const NEIGHBOUR_LINES = 1;

/** Longest quote echoed back in a rejection detail. Details are read in terminals. */
const DETAIL_LIMIT = 80;

/**
 * A source with the two indexes the checks need: the whitespace-collapsed text
 * a quote is matched against, and enough bookkeeping to map a position in that
 * text back to the line it came from.
 */
interface ScannedSource {
  raw: string;
  /** Whitespace-collapsed. Identical to `raw.replace(/\s+/g, ' ').trim()`. */
  text: string;
  /** `offsets[i]` is the index in `raw` of `text[i]`. */
  offsets: number[];
  /** Index in `raw` where each line begins. */
  lineStarts: number[];
}

type ScannedSources = Record<EvidenceSource, ScannedSource>;

const SPACE = /\s/;

/**
 * The entire normalisation this verifier performs, and the reason it is written
 * out by hand rather than as a one-line `replace`: the checks need to know
 * where a match landed in the original.
 *
 * Runs of whitespace collapse to one space; leading and trailing whitespace
 * goes. Nothing else. Case survives, punctuation survives, every word survives.
 * A quote that differs from the source by one character is a different quote —
 * loosening this into fuzzy or token-similarity matching would hand back
 * exactly the fabrications the module exists to catch, since a fabricated
 * sentence is by construction *almost* what was said.
 */
const scan = (raw: string): ScannedSource => {
  const chars: string[] = [];
  const offsets: number[] = [];
  let pendingSpace = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] ?? '';
    if (SPACE.test(char)) {
      if (chars.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      chars.push(' ');
      offsets.push(index);
      pendingSpace = false;
    }
    chars.push(char);
    offsets.push(index);
  }

  const lineStarts = [0];
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === '\n') lineStarts.push(index + 1);
  }

  return { raw, text: chars.join(''), offsets, lineStarts };
};

/** The quote side of the same normalisation. */
const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

const scanSources = (sources: Sources): ScannedSources => ({
  transcript: scan(sources.transcript),
  diff: scan(sources.diff),
});

/** Which line of `raw` contains `offset`. */
const lineIndexOf = (lineStarts: readonly number[], offset: number): number => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((lineStarts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
};

/**
 * Positions of `quote` in `source.text`, capped: a two-word quote can occur
 * hundreds of times in a diff, and the rejection-context scan only needs enough
 * occurrences to find one that is grounded.
 */
const OCCURRENCE_LIMIT = 32;

const occurrences = (source: ScannedSource, quote: string): number[] => {
  if (quote === '') return [];
  const found: number[] = [];
  let at = source.text.indexOf(quote);
  while (at !== -1 && found.length < OCCURRENCE_LIMIT) {
    found.push(at);
    at = source.text.indexOf(quote, at + 1);
  }
  return found;
};

/** The quoted lines plus `NEIGHBOUR_LINES` either side, as raw text. */
const neighbourhood = (source: ScannedSource, start: number, length: number): string => {
  const rawStart = source.offsets[start] ?? 0;
  const rawEnd = source.offsets[start + length - 1] ?? rawStart;
  const first = Math.max(0, lineIndexOf(source.lineStarts, rawStart) - NEIGHBOUR_LINES);
  const last = Math.min(
    source.lineStarts.length - 1,
    lineIndexOf(source.lineStarts, rawEnd) + NEIGHBOUR_LINES,
  );
  const from = source.lineStarts[first] ?? 0;
  const to = source.lineStarts[last + 1] ?? source.raw.length;
  return source.raw.slice(from, to);
};

/** Marker matching folds case and curly apostrophes; the quote check never does. */
const forMarkers = (text: string): string => normalize(text).toLowerCase().replace(/[’‘]/g, "'");

const hasRejectionContext = (source: ScannedSource, quote: string): boolean => {
  const normalized = normalize(quote);
  return occurrences(source, normalized).some((at) => {
    const window = forMarkers(neighbourhood(source, at, normalized.length));
    return REJECTION_MARKERS.some((marker) => window.includes(marker));
  });
};

const brief = (text: string): string => {
  const flat = normalize(text);
  return flat.length <= DETAIL_LIMIT ? flat : `${flat.slice(0, DETAIL_LIMIT)}...`;
};

let claimKeys: ReadonlySet<string> | null = null;

/** The SPEC §3.1 keys — the ones a citation has to cover. */
const claimKeySet = (): ReadonlySet<string> => {
  if (claimKeys === null) {
    claimKeys = new Set(loadVocabulary().filter((entry) => entry.claim).map((entry) => entry.key));
  }
  return claimKeys;
};

/**
 * `Violation.rule` onto `RejectionReason`. `cardinality` lands on `format`
 * because both say the same thing to whoever has to fix it — the record's shape
 * is not what SPEC §6 allows — and the detail names the actual rule anyway.
 * `dangling-ref` is a cross-record question `validateRecord` never asks.
 */
const reasonFor = (violation: Violation): RejectionReason => {
  if (violation.rule === 'enum') return 'enum';
  if (violation.rule === 'unknown-key') return 'unknown-key';
  return 'format';
};

const describeViolation = (violation: Violation): string =>
  violation.got === violation.key
    ? `${violation.key} (${violation.rule}, want ${violation.want})`
    : `${violation.key}: ${JSON.stringify(brief(violation.got))} (${violation.rule}, want ${violation.want})`;

const discard = (
  record: DraftRecord,
  reason: RejectionReason,
  detail: string,
): RejectedRecord => ({ record, reason, detail });

/** Every claim key in the record that no citation names. */
const uncitedClaims = (record: DraftRecord): string[] => {
  const cited = new Set(record.evidence.map((cite) => cite.key));
  const claims = claimKeySet();
  return [...new Set(record.trailers.map((trailer) => trailer.key))].filter(
    (key) => claims.has(key) && !cited.has(key),
  );
};

/**
 * Re-asks the question `parseDraft` already asked. Not redundancy: the checker
 * must not assume the maker ran, and `verifyDraft` is callable on any
 * `DraftRecord[]` — including one assembled by a repair round that never went
 * back through the parser.
 */
const missingEvidence = (record: DraftRecord): RejectedRecord | null => {
  if (record.evidence.length === 0) {
    return discard(record, 'evidence-missing', 'the record cites nothing');
  }
  const uncited = uncitedClaims(record);
  if (uncited.length > 0) {
    return discard(
      record,
      'evidence-missing',
      `no evidence cites ${uncited.map((key) => `"${key}"`).join(', ')}`,
    );
  }
  return null;
};

const notFound = (cite: DraftEvidence, source: ScannedSource): string => {
  const where = source.text === '' ? ` (the ${cite.source} is empty)` : '';
  return `${cite.key}: the ${cite.source} does not contain "${brief(cite.quote)}"${where}`;
};

/**
 * The check the module exists for. A quote that survives is one the source
 * really contains, character for character, whitespace aside.
 *
 * An all-whitespace quote is treated as absent rather than as trivially
 * present: it normalises to the empty string, and every string contains that.
 */
const unfoundEvidence = (record: DraftRecord, sources: ScannedSources): RejectedRecord | null => {
  for (const cite of record.evidence) {
    const source = sources[cite.source];
    if (occurrences(source, normalize(cite.quote)).length === 0) {
      return discard(record, 'evidence-not-found', notFound(cite, source));
    }
  }
  return null;
};

/**
 * `Ruled-out:` claims an alternative was considered and dropped. The quote
 * proves the alternative was *mentioned*; only the surrounding text can show it
 * was turned down, so this asks for a rejection marker in the neighbourhood.
 *
 * Checked per key rather than per trailer: `evidence.key` names a key, not an
 * occurrence, so a record with two `Ruled-out:` trailers cannot say which
 * citation belongs to which. One grounded citation clears the record — the
 * alternative being to reject a shape SPEC §3 explicitly permits.
 */
const ungroundedRuledOut = (record: DraftRecord, sources: ScannedSources): RejectedRecord | null => {
  if (!record.trailers.some((trailer) => trailer.key === 'Ruled-out')) return null;

  const cites = record.evidence.filter((cite) => cite.key === 'Ruled-out');
  if (cites.some((cite) => hasRejectionContext(sources[cite.source], cite.quote))) return null;

  const quoted = cites.map((cite) => `"${brief(cite.quote)}"`).join(', ');
  return discard(
    record,
    'ruled-out-no-rejection',
    `Ruled-out: nothing near ${quoted} shows the alternative being turned down — ` +
      'the source mentions it, which is not the same as rejecting it',
  );
};

const invalid = (record: DraftRecord): RejectedRecord | null => {
  const violations = validateRecord(record.trailers);
  const first = violations[0];
  if (first === undefined) return null;
  return discard(record, reasonFor(first), violations.map(describeViolation).join('; '));
};

/**
 * Verifies a draft against the transcript and diff it was harvested from.
 *
 * Checks run in order of severity and stop at the first failure: a record that
 * quotes something nobody said is told that before it is told about an enum,
 * because the enum is not the problem with it.
 *
 * Total, deterministic, and side-effect free. The same draft and the same
 * sources always produce the same result, which is what lets a repair round be
 * something other than a coin flip.
 */
export const verifyDraft = (draft: DraftRecord[], sources: Sources): VerifyResult => {
  const scanned = scanSources(sources);
  const accepted: VerifiedRecord[] = [];
  const rejected: RejectedRecord[] = [];

  for (const record of draft) {
    const failure =
      missingEvidence(record) ??
      unfoundEvidence(record, scanned) ??
      ungroundedRuledOut(record, scanned) ??
      invalid(record);

    if (failure === null) accepted.push({ record });
    else rejected.push(failure);
  }

  return { accepted, rejected };
};

/** The trailer keys of a record, as a label a human can match against a draft. */
const label = (record: DraftRecord): string =>
  [...new Set(record.trailers.map((trailer) => trailer.key))].join(', ');

/** One line of summary, then one line per discarded record. For terminals and logs. */
export const formatResult = (result: VerifyResult): string => {
  const lines = [
    `${result.accepted.length} record(s) verified, ${result.rejected.length} discarded`,
    ...result.rejected.map(
      (entry) => `  discarded [${label(entry.record)}] (${entry.reason}): ${entry.detail}`,
    ),
  ];
  return `${lines.join('\n')}\n`;
};

/**
 * What a session should do about each reason. Instructions, not explanations:
 * the session is being asked to act, and "drop the record" is on every one of
 * them because dropping is always a correct answer here.
 */
const REPAIR_GUIDANCE: Readonly<Record<RejectionReason, string>> = {
  'evidence-not-found':
    'Copy the quote out of the transcript or the diff character for character. ' +
    'Only whitespace may differ. If you cannot find the sentence, drop the record.',
  'evidence-missing':
    'Add a citation for every decision-context key the record carries, or drop the record.',
  'ruled-out-no-rejection':
    'Quote the place where the alternative was actually turned down, not where it was ' +
    'first suggested. If the source only mentions the alternative, drop the Ruled-out trailer.',
  enum: 'Use one of the values listed for that key, exactly. A synonym is a violation, not a shortcut.',
  format: 'Match the value grammar the vocabulary states for that key.',
  'unknown-key': 'Use a key from the vocabulary, or an X-<Name> extension key.',
};

const trailerLines = (record: DraftRecord): string[] =>
  record.trailers.map((trailer) => `     ${trailer.key}: ${brief(trailer.value)}`);

/**
 * Builds the text handed back to the draft generator for another attempt.
 *
 * This function generates a prompt; it does not run one. The CLI holds no key
 * and calls no model (ADR-0006) — regeneration happens inside the user's own
 * session, which is the only place a model was ever going to be free.
 *
 * Returns the empty string when nothing was rejected: there is nothing to
 * repair, and a repair prompt with no failures in it is an invitation to invent.
 */
export const buildRepairFeedback = (rejected: readonly RejectedRecord[]): string => {
  if (rejected.length === 0) return '';

  const entries = rejected.flatMap((entry, index) => [
    `${index + 1}. ${entry.reason} — ${entry.detail}`,
    '   Trailers:',
    ...trailerLines(entry.record),
    `   Fix: ${REPAIR_GUIDANCE[entry.reason]}`,
    '',
  ]);

  return [
    '# CommitLore harvest — repair',
    '',
    `The verifier discarded ${rejected.length} record(s) from your draft. It is not a`,
    'model: it re-reads the transcript and the diff you were given and keeps only what',
    'it can find there, so every failure below is a fact about your draft, not an opinion.',
    '',
    '## Discarded',
    '',
    ...entries,
    '## What to emit',
    '',
    'Emit the whole draft again as one JSON object in the same format, with each record',
    'above either fixed or removed. Removing a record is always allowed and is usually',
    'the right answer — a missing record is better than a false one. Do not add records',
    'that were not in your previous draft, and do not weaken a quote to make it match.',
    '',
  ].join('\n');
};

/** One iteration of the bounded repair loop (ADR-0006 §5, PRD-F4 요구 4). */
export interface RepairRound {
  round: number;
  rejected: RejectedRecord[];
  feedbackPrompt: string;
}

/**
 * The ceiling on repair attempts. Two, and then the commit proceeds with
 * whatever passed. An unbounded loop against a model that keeps producing the
 * same unfindable quote is a hang, and a hang at commit time is worse than an
 * empty record.
 */
export const MAX_REPAIR_ROUNDS = 2;

/**
 * The next repair round, or `null` when there is not one — either everything
 * passed or the budget is spent. Termination is structural rather than
 * conventional: a caller that loops until this returns `null` cannot spin,
 * whatever the model does.
 *
 * `attempted` is the number of rounds already run, so the first call passes 0.
 */
export const planRepair = (
  attempted: number,
  rejected: readonly RejectedRecord[],
): RepairRound | null => {
  if (attempted >= MAX_REPAIR_ROUNDS || rejected.length === 0) return null;
  return {
    round: attempted + 1,
    rejected: [...rejected],
    feedbackPrompt: buildRepairFeedback(rejected),
  };
};
