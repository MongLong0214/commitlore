/**
 * `commitlore guard` — the consumer route SPEC §5 assigns to `Ruled-out:`.
 *
 * This is the claim the whole project rests on: an alternative that was
 * evaluated and dropped stays dropped, and the agent that proposes it again
 * three weeks later is told so *before* it executes. Every other route surfaces
 * knowledge; this one refuses a repeat.
 *
 * ## Why the matcher is deterministic
 *
 * No LLM call, no embedding, no network. Three reasons, in order of weight:
 *
 * 1. It runs on the hot path. The design intent (ADR-0006) is a PreToolUse
 *    hook — every Edit an agent proposes. A matcher with a per-call cost, a
 *    latency floor, or an API key is a matcher that gets uninstalled.
 * 2. A guard that answers differently on the second run cannot be argued with.
 *    A maintainer who thinks a flag is wrong must be able to see *which token
 *    hit*, which is why `GuardMatch.signals` exists and why a bare score would
 *    not be enough.
 * 3. A stochastic matcher would make any benchmark of this route measure the
 *    matcher rather than the protocol.
 *
 * That third reason described a measurement that has not happened. T-702 ran
 * the re-proposal matrix with `Ruled-out:` delivered as *injected context* —
 * the route SPEC §5 assigns to `Limit:` and `Warn:` — and never invoked guard
 * at all. This route, the one §5 actually assigns to `Ruled-out:`, is still
 * unmeasured end to end. `bench/ROUTE-GAP.md` records what replaying the
 * recorded runs through it showed, and #37 is the experiment that would close
 * it.
 *
 * The cost is recall: this finds lexical revivals, not semantic ones. See
 * "What this cannot see" at the bottom of this comment.
 *
 * ## The three signals
 *
 * `Ruled-out: <alternative> | <reason>` (SPEC §3.1). Only the alternative half
 * is matched against — the reason is prose about *why not*, and matching it
 * would flag every proposal that shares the objection's vocabulary.
 *
 * - **Token Jaccard** (`JACCARD_WEIGHT`) — overall similarity between the
 *   proposal and the alternative, over normalized, stopworded, lightly stemmed
 *   token sets. Symmetric, so it rewards a short focused proposal and decays on
 *   a long one.
 * - **Distinctive-keyword strength** (`KEYWORD_WEIGHT`) — how much of the
 *   alternative's *identity* the proposal names: its distinctive tokens (see
 *   `GENERIC_TERMS`), weighted by how rare each one is across the rejection
 *   corpus (see `Corpus`) and corroborated by their unweighted coverage.
 *   Containment rather than similarity is what survives a proposal the size
 *   of a diff: "redis" is still in there.
 * - **`Record-Id:` hit** (`RECORD_ID_WEIGHT`) — the proposal names the record
 *   itself. Not similarity at all; an explicit reference.
 *
 * Jaccard alone answers "is this the same sentence"; keyword strength answers
 * "is the rejected thing named in here". Either question answered wrongly on
 * its own is a bad guard, which is why both are weighted.
 *
 * ## Why the score is not the whole decision
 *
 * A weighted sum is an average, and an average cannot tell "one common word
 * matched hard" from "this is the same idea". Measured on this repository's own
 * history, a flat keyword rule flagged four of ten ordinary proposals — `rename
 * a variable`, `document the exit codes` — each on a single word that recurs
 * across dozens of rejections. Raising the threshold does not fix that; it
 * trades a discrimination problem for a sensitivity one, since real matches sat
 * in the same band. So a flag needs two things: a score at or above
 * `DEFAULT_THRESHOLD`, and corroboration (see `corroborated`).
 *
 * ## What this cannot see
 *
 * A revival phrased without any of the rejected alternative's words — "let's
 * put the sessions in a service both boxes can reach", for a ruled-out
 * `shared Redis cache` — scores zero here. So does a rename: an alternative
 * written `SessionStore` is one token, and a proposal saying "session store" is
 * two. And corroboration costs recall of its own: a proposal that names one
 * word of a long rejected alternative, and nothing else, is now let through.
 * All three are the honest limit of lexical matching, and the reason `guard`
 * warns rather than blocks.
 */

import {
  BLOCKED_RECORD_WITHHELD,
  identityCarriesInjection,
  normalizeForMatch,
  scanInjection,
} from './grade.js';
import { RECORD_ID_RE } from './types.js';
import type { HistoryAvailability } from './git.js';
import type { NotesAvailability } from './notes.js';
import { splitRuledOut, type RuledOutValue } from './trailers.js';
import {
  RULED_OUT_KEY,
  runQuery,
  valuesOf,
  type GradedRecord,
  type TrustGrade,
} from './query.js';

export interface GuardMatch {
  recordId?: string;
  sha: string;
  trust: TrustGrade;
  /** The alternative half of the `Ruled-out:` value — everything before the `|`. */
  alternative: string;
  /**
   * Why it was rejected — everything after the `|`. Empty only when the record
   * is malformed (SPEC §3.1 requires the separator), which `signals` reports.
   */
  reason: string;
  /** 0..1, rounded to four places. Only scores at or above the threshold are returned. */
  score: number;
  /** What hit, in a fixed order: the record id, then keywords, then the Jaccard value. */
  signals: string[];
}

export interface GuardResult {
  matches: GuardMatch[];
  /** Whether the check could actually be performed. */
  history: HistoryAvailability;
  shallow: boolean;
  notes: NotesAvailability;
  /** True when history is 'unavailable' or notes is 'unfetched'. */
  incomplete: boolean;
}

interface RenderedGuardMatchIdentity {
  recordId: string | null;
  sha: string;
  score: number;
  signals: string[];
}

export type RenderedGuardMatch =
  | (RenderedGuardMatchIdentity & {
      trust: 'blocked';
      withheld: string;
    })
  | (RenderedGuardMatchIdentity & {
      trust: 'directive' | 'claim';
      alternative: string;
      reason: string;
    });

/**
 * The raw blocked content remains available to trusted program logic, while
 * every output surface receives a shape that cannot quote it accidentally.
 */
export const renderGuardMatch = (match: GuardMatch): RenderedGuardMatch => {
  switch (match.trust) {
    case 'blocked': {
      const rawId = match.recordId ?? null;
      const identityUnsafe =
        rawId !== null && (!RECORD_ID_RE.test(rawId) || identityCarriesInjection(rawId));
      return {
        recordId: identityUnsafe ? null : rawId,
        sha: match.sha,
        score: match.score,
        signals: match.signals.filter((signal) => {
          if (identityUnsafe && rawId !== null && signal.includes(rawId)) return false;
          return scanInjection(signal).length === 0;
        }),
        trust: match.trust,
        withheld: BLOCKED_RECORD_WITHHELD,
      };
    }
    case 'claim':
    case 'directive':
      return {
        recordId: match.recordId ?? null,
        sha: match.sha,
        score: match.score,
        signals: [...match.signals],
        trust: match.trust,
        alternative: match.alternative,
        reason: match.reason,
      };
  }
};

export interface GuardOptions {
  proposal: string;
  paths?: readonly string[];
  threshold?: number;
  at?: Date;
  cwd?: string;
  noIndex?: boolean;
  /** Authors whose records may render as directives. The caller supplies trust. */
  trustedAuthors?: readonly string[];
  /** Opt-in: an otherwise eligible directive must have Git's verified `G` status. */
  requireSignedDirective?: boolean;
  /**
   * Refuse to flag on a `Record-Id:` reference alone.
   *
   * The informational default is deliberate (see `RECORD_ID_WEIGHT`): naming a
   * record is a good reason to print what it ruled out. A blocking hook needs
   * the opposite, because citing a record is what compliance looks like.
   */
  requireContent?: boolean;
}

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

/**
 * Weight on token Jaccard. Equal to `KEYWORD_WEIGHT` because the two signals
 * fail in opposite directions: Jaccard collapses when the proposal is long
 * (a diff shares few tokens with a three-word alternative), coverage fires on a
 * single word when the alternative has only one distinctive token. Weighting
 * either above the other picks a favourite failure mode.
 */
export const JACCARD_WEIGHT = 0.5;

/** Weight on distinctive-keyword coverage. See `JACCARD_WEIGHT`. */
export const KEYWORD_WEIGHT = 0.5;

/**
 * Distinct distinctive tokens that corroborate a flag on count alone.
 *
 * Two is the smallest number that cannot be reached by one common word, and
 * every false positive measured on this repository's history was one word:
 * `rename`, `document`, `readme`, `regex`.
 */
export const MIN_KEYWORD_HITS = 2;

/**
 * The strength of the alternative's covered keywords that corroborates a flag
 * on its own. IDF-weighted mass is multiplied by ordinary token coverage so a
 * rare filename cannot erase unmatched subject words merely because those words
 * are common in the corpus. A *single* word is still enough when the alternative
 * is essentially that word.
 *
 * The line stays at half because a one-token alternative such as `redis` still
 * reaches **1.00**, while multiplication cannot increase the measured unrelated
 * keyword masses (the old maximum was **0.37**). A partial hit now preserves the
 * absent tokens' vote even when corpus frequency drives their IDF weight down.
 */
export const STRONG_KEYWORD_STRENGTH = 0.5;

/**
 * @deprecated Use `STRONG_KEYWORD_STRENGTH`. Kept because the generated
 * `dist/core/guard.js` is a supported clone-first import surface.
 */
export const STRONG_KEYWORD_MASS = STRONG_KEYWORD_STRENGTH;

/**
 * The token overlap that corroborates a flag with no keyword evidence at all —
 * the two texts are restatements of each other. Measured, the highest Jaccard
 * any of the ten unrelated proposals reaches against any rejection in this
 * repository is 0.29 ("document the exit codes in the README" against "rename
 * code and spec first, documents later"), so 0.4 clears the whole population.
 */
export const MIN_JACCARD = 0.4;

/**
 * Weight on a `Record-Id:` hit. Above `DEFAULT_THRESHOLD` on its own: a
 * proposal that names `r-7c1a45` is discussing that record, and printing what
 * it ruled out and why is the correct response whether the proposal is reviving
 * the alternative or merely citing it. Below 1.0 so the id is a strong signal
 * rather than a verdict — the reported score still separates "named the record"
 * from "named the record and restated the alternative".
 */
export const RECORD_ID_WEIGHT = 0.6;

/**
 * The score at which a proposal is flagged. Comparison is `>=`: this is the
 * minimum score that fires, not a value that must be exceeded.
 *
 * The threshold is the *second* of two conditions. `corroborated` runs first,
 * and it is what separates a re-proposal from a proposal that happens to share
 * a word; the threshold only decides how strong a corroborated match must be.
 * Raising the threshold alone was tried and rejected — the four false positives
 * measured on this repository sat at 0.44–0.54, and a threshold above them also
 * excludes real matches at 0.54.
 *
 * At 0.35 the corroborated cases land like this:
 *
 * - **0.58** — `shared Redis cache` against "use a redis instance to store
 *   sessions". One word shared out of six, but that word is the whole identity
 *   of the alternative (`STRONG_KEYWORD_STRENGTH`), so it fires and must.
 * - **0.60** — a `Record-Id:` reference alone.
 * - **0.83, 1.00** — the two re-proposals measured against this repository's
 *   own history (`hardcode the adoption commit sha`, `print the matched
 *   credential…`), which are what the ceiling looks like.
 *
 * Against the unrelated proposal corpus in `spec/fixtures/guard/proposals.json`,
 * both the seeded records and this repository's real history are quiet. The
 * threshold was not tuned down to that measurement: room above the noise is
 * what keeps a hook that runs on every Edit from being switched off.
 */
export const DEFAULT_THRESHOLD = 0.35;

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/**
 * Function words and proposal filler. Removed from both sides, so their only
 * effect is on the Jaccard denominator — a proposal and an alternative that
 * share nothing but "the" and "add" should share nothing.
 *
 * Inflections are handled by `stem`, so this lists base forms plus the few
 * (`using`, `made`) the light stemmer cannot reach.
 */
const STOPWORDS: readonly string[] = [
  'a', 'about', 'add', 'after', 'again', 'all', 'already', 'also', 'always', 'an', 'and', 'another',
  'any', 'anything', 'are', 'as', 'at', 'back', 'be', 'because', 'been', 'before', 'being', 'best',
  'better', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'done', 'down', 'each',
  'either', 'else', 'even', 'every', 'first', 'for', 'from', 'get', 'go', 'going', 'good', 'had',
  'has', 'have', 'here', 'how', 'however', 'i', 'if', 'in', 'instead', 'into', 'is', 'it', 'its',
  'just', 'keep', 'let', 'like', 'made', 'make', 'many', 'may', 'maybe', 'me', 'might', 'more',
  'most', 'much', 'must', 'my', 'need', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'one',
  'only', 'or', 'other', 'our', 'out', 'over', 'own', 'perhaps', 'probably', 'put', 'rather',
  'really', 'same', 'shall', 'should', 'since', 'so', 'some', 'something', 'still', 'such', 'sure',
  'take', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'thing',
  'think', 'this', 'those', 'through', 'to', 'too', 'try', 'under', 'until', 'up', 'us', 'use',
  'using', 'very', 'want', 'was', 'we', 'well', 'were', 'what', 'when', 'where', 'whether', 'which',
  'while', 'who', 'why', 'will', 'with', 'without', 'would', 'yet', 'you', 'your',
];

/**
 * Tokens that are true of nearly every software proposal and therefore carry no
 * evidence that *this* alternative is being revived. They are removed from the
 * alternative's keyword set only — never from either token set, because
 * "cache" appearing on both sides is still real Jaccard similarity.
 *
 * This is a static stand-in for corpus IDF. Deriving the list from the
 * repository's own `Ruled-out:` records was rejected: it would make one
 * record's score depend on which other records happen to be in scope, so adding
 * an unrelated record could silently un-flag a proposal. A guard whose answer
 * moves for reasons the caller cannot see is worse than one with a fixed list.
 *
 * When an alternative consists only of generic terms, `keywordCoverage` falls
 * back to all of its content tokens — a rejected `shared cache` must still be
 * matchable.
 */
const GENERIC_TERMS: readonly string[] = [
  'api', 'app', 'application', 'approach', 'base', 'build', 'cache', 'call', 'change', 'check',
  'class', 'client', 'code', 'column', 'component', 'config', 'configuration', 'connection',
  'core', 'data', 'database', 'db', 'default', 'dependency', 'deploy', 'disk', 'endpoint', 'entry',
  'error', 'event', 'fast', 'field', 'file', 'fix', 'flag', 'function', 'global', 'handler', 'hook',
  'http', 'id', 'index', 'instance', 'interface', 'job', 'key', 'large', 'layer', 'library',
  'limit', 'list', 'local', 'log', 'main', 'map', 'memory', 'message', 'method', 'migration',
  'mode', 'model', 'module', 'name', 'network', 'new', 'node', 'number', 'object', 'old', 'option',
  'package', 'page', 'path', 'pool', 'process', 'query', 'queue', 'remote', 'request', 'response',
  'route', 'row', 'schema', 'script', 'server', 'service', 'session', 'set', 'shared', 'simple',
  'size', 'slow', 'small', 'state', 'storage', 'store', 'string', 'system', 'table', 'task', 'test',
  'thread', 'time', 'timeout', 'token', 'tool', 'transaction', 'type', 'update', 'url', 'user',
  'value', 'version', 'view', 'worker',
];

/**
 * Light suffix stripping — plurals, `-ing`, `-ed`, and a trailing `e`.
 *
 * The trailing-`e` rule is what makes the other two work: without it
 * `caching` → `cach` and `cache` → `cache` are different tokens, which is
 * exactly the "표현이 다른 명중" case the route exists for. Length floors keep
 * short identifiers (`db`, `s3`, `bus`) intact.
 *
 * Deliberately not Porter: every extra rule is another chance to collide two
 * unrelated words into one stem, and a false stem collision here is a false
 * flag on the hot path.
 */
const stem = (token: string): string => {
  let word = token;

  if (word.endsWith('ies') && word.length >= 5) word = `${word.slice(0, -3)}y`;
  else if (/(?:ss|sh|ch|x)es$/.test(word) && word.length >= 5) word = word.slice(0, -2);
  else if (word.endsWith('s') && !word.endsWith('ss') && word.length >= 4) word = word.slice(0, -1);

  if (word.endsWith('ing') && word.length >= 6) word = word.slice(0, -3);
  else if (word.endsWith('ed') && word.length >= 5) word = word.slice(0, -2);

  if (word.endsWith('e') && word.length >= 4) word = word.slice(0, -1);

  return word;
};

const stemsOf = (words: readonly string[]): ReadonlySet<string> =>
  new Set(words.flatMap((word) => [word, stem(word)]));

const STOPWORD_STEMS = stemsOf(STOPWORDS);
const GENERIC_STEMS = stemsOf(GENERIC_TERMS);

/**
 * `Record-Id:` occurrences in free text. `RECORD_ID_RE` in `core/types.ts` is
 * anchored, so scanning needs its own copy of the grammar; the two must stay in
 * step, and `test/guard.test.ts` asserts a value matching one matches the other.
 */
const RECORD_ID_SCAN = 'r-[a-z0-9]{6,}';

interface Tokens {
  /** Stemmed content tokens, deduplicated. */
  stems: ReadonlySet<string>;
  /** stem → the first surface form it was produced from, so signals stay readable. */
  surface: ReadonlyMap<string, string>;
}

const EMPTY_TOKENS: Tokens = { stems: new Set(), surface: new Map() };

/**
 * Text → the token set everything else here compares.
 *
 * `normalizeForMatch` (core/grade.ts) does the Unicode half: NFKC, invisibles,
 * case, accents and confusables. Reusing it means a proposal written with a
 * Cyrillic `е` in "redis" tokenizes the same as one without — the same evasion
 * the injection scanner already had to defend against.
 *
 * camelCase is deliberately *not* split. Splitting would make `MongoDB` two
 * tokens and `mongodb` one, so the two spellings of the same product would stop
 * matching — and product names are what ruled-out alternatives are made of.
 * The price is that `SessionStore` does not match "session store".
 */
const tokenize = (text: string): Tokens => {
  const stems = new Set<string>();
  const surface = new Map<string, string>();

  for (const raw of normalizeForMatch(text).split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue;
    const stemmed = stem(raw);
    if (STOPWORD_STEMS.has(raw) || STOPWORD_STEMS.has(stemmed)) continue;
    stems.add(stemmed);
    if (!surface.has(stemmed)) surface.set(stemmed, raw);
  }

  return { stems, surface };
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const jaccard = (left: ReadonlySet<string>, right: ReadonlySet<string>): number => {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
};

/** Four places: enough to order matches, few enough that the output is stable text. */
const round = (value: number): number => Math.round(value * 10000) / 10000;

/**
 * Token weights derived from the corpus of ruled-out alternatives in scope.
 *
 * `GENERIC_TERMS` is a fixed list and cannot know what *this* repository says
 * often. In CommitLore's own history `rename`, `document`, `readme` and `spec`
 * are spread across dozens of rejections; a proposal that says "rename" has
 * named nothing. Document frequency over the rejection corpus is the only
 * signal that adapts, and it needs no data the guard is not already holding —
 * the corpus is exactly the record set the query returned.
 *
 * The cost, stated plainly: a token's weight now depends on the other records
 * in scope, so the same proposal can score differently under `-- src/auth` than
 * unscoped. That is real, and it is the price of discrimination that scales
 * past a hand-maintained word list. The corroboration gate below is written not
 * to depend on it, so a one-record scope cannot turn the guard into a
 * single-word tripwire.
 */
interface Corpus {
  /** How many alternatives the frequencies were counted over. */
  size: number;
  /** Smoothed, normalized inverse document frequency in 0..1. Rare → 1. */
  weight: (stem: string) => number;
}

/**
 * `ln((N + 1) / (df + 0.5))`, normalized by its own maximum.
 *
 * Smoothed because the unsmoothed form collapses on the small corpora that are
 * normal here: a repository with one rejection has `ln(1/1) = 0` for every
 * token, and every score would be zero. With the offsets, a lone alternative
 * still weights its tokens at 1, and a token in every alternative approaches 0.
 */
const buildCorpus = (alternatives: readonly Tokens[]): Corpus => {
  const seen = new Map<string, number>();
  for (const tokens of alternatives) {
    for (const token of tokens.stems) seen.set(token, (seen.get(token) ?? 0) + 1);
  }

  const size = alternatives.length;
  const ceiling = Math.log((size + 1) / 1.5);
  return {
    size,
    // An empty corpus produces no candidates to score, so the guard here is
    // only about never dividing by a non-positive ceiling.
    weight: (token) => {
      if (ceiling <= 0) return 1;
      const documents = seen.get(token) ?? 1;
      const value = Math.log((size + 1) / (documents + 0.5)) / ceiling;
      return Math.min(1, Math.max(0, value));
    },
  };
};

interface Coverage {
  strength: number;
  /** Surface forms of the distinctive tokens that hit, alphabetical. */
  hits: string[];
}

/**
 * How much of what makes this alternative *this* alternative the proposal named.
 *
 * Corpus weights separate rare words from common ones; multiplying by the
 * plain hit fraction keeps a common unmatched word from disappearing from the
 * denominator. Either factor alone produced a measured false-positive class.
 *
 * Falling back to every content token when nothing survives `GENERIC_STEMS` is
 * not a formality: `shared cache` and `in-process map` are real rejected
 * alternatives made entirely of generic words, and dropping them from the guard
 * would mean the vaguer the rejection, the weaker the protection.
 */
const keywordCoverage = (alternative: Tokens, proposal: Tokens, corpus: Corpus): Coverage => {
  const distinctive = [...alternative.stems].filter((token) => !GENERIC_STEMS.has(token));
  const considered = distinctive.length === 0 ? [...alternative.stems] : distinctive;
  if (considered.length === 0) return { strength: 0, hits: [] };

  let total = 0;
  let named = 0;
  const hits: string[] = [];
  for (const token of considered) {
    const weight = corpus.weight(token);
    total += weight;
    if (!proposal.stems.has(token)) continue;
    named += weight;
    hits.push(alternative.surface.get(token) ?? token);
  }

  const weightedMass = total === 0 ? 0 : named / total;
  return {
    strength: weightedMass * (hits.length / considered.length),
    hits: hits.sort(),
  };
};

/**
 * Whether anything corroborates the score, and the reason a high score is not
 * on its own enough to flag.
 *
 * Weighted sums are averages, and an average cannot distinguish "one common
 * word matched hard" from "this is the same idea". Both reach 0.45 on this
 * repository, and only one of them is a re-proposal. So the flag needs a second
 * opinion, and any one of four will do:
 *
 * - the proposal named the record itself;
 * - it named two distinct distinctive tokens (`MIN_KEYWORD_HITS`);
 * - the tokens it named carry most of the alternative's keyword strength
 *   (`STRONG_KEYWORD_STRENGTH`) — one word is enough when the alternative *is*
 *   that word, which is why `shared Redis cache` still fires on "redis";
 * - or the two texts overlap enough to be restatements (`MIN_JACCARD`).
 *
 * None of the four can be reached by a single common word in a long
 * alternative, which is the whole shape of the false positive.
 */
const corroborated = (
  idHit: boolean,
  coverage: Coverage,
  similarity: number,
  requireContent = false,
): boolean =>
  (idHit && !requireContent) ||
  coverage.hits.length >= MIN_KEYWORD_HITS ||
  coverage.strength >= STRONG_KEYWORD_STRENGTH ||
  similarity >= MIN_JACCARD;

/** Folded continuations arrive as one line already; this only tidies runs of spaces. */
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * `core/trailers.ts` owns the grammar; this only tidies whitespace for matching.
 *
 * A malformed or ambiguous value is still guarded on, not skipped. Refusing to
 * match one would turn a formatting mistake into a silent loss of the
 * protection the record was written to provide — which is the whole failure
 * this route exists to prevent. What the caller gets instead is the fact,
 * carried in `signals` next to the score.
 */
const parseRuledOut = (value: string): RuledOutValue => {
  const split = splitRuledOut(value);
  return {
    ...split,
    alternative: collapse(split.alternative),
    reason: collapse(split.reason),
  };
};

/** Built fresh per call so no `g`-flag `lastIndex` state is shared (as in core/grade.ts). */
const recordIdsIn = (proposal: string): ReadonlySet<string> =>
  new Set(normalizeForMatch(proposal).match(new RegExp(`\\b${RECORD_ID_SCAN}\\b`, 'g')) ?? []);

/** Score descending, then sha and alternative ascending so the order is total. */
const compareMatches = (a: GuardMatch, b: GuardMatch): number => {
  if (a.score !== b.score) return b.score - a.score;
  if (a.sha !== b.sha) return a.sha < b.sha ? -1 : 1;
  return a.alternative < b.alternative ? -1 : a.alternative > b.alternative ? 1 : 0;
};

/** One `Ruled-out:` value, parsed and tokenized once so the corpus can count it. */
interface Candidate {
  record: GradedRecord;
  parsed: RuledOutValue;
  tokens: Tokens;
  idHit: boolean;
}

const matchOne = (
  candidate: Candidate,
  proposal: Tokens,
  corpus: Corpus,
  requireContent = false,
): GuardMatch | null => {
  const { record, parsed, tokens, idHit } = candidate;

  const similarity = jaccard(tokens.stems, proposal.stems);
  const coverage = keywordCoverage(tokens, proposal, corpus);
  if (!corroborated(idHit, coverage, similarity, requireContent)) return null;

  // Under `requireContent` the record id contributes nothing to the score
  // either. Naming a record is evidence that the proposal *refers* to it, and
  // a well-behaved agent refers to it precisely when it is complying: measured
  // against 30 recorded agent runs, the two highest-scoring flags were both an
  // agent citing the record it was obeying — one wrote `Constraints (from
  // r-2d55a9)`, the other used the id as a documentation example. Both scored
  // 1.00 on the id alone with a token overlap of 0.01.
  const score = round(
    Math.min(
      1,
      JACCARD_WEIGHT * similarity +
        KEYWORD_WEIGHT * coverage.strength +
        (idHit && !requireContent ? RECORD_ID_WEIGHT : 0),
    ),
  );

  const signals = [
    ...(idHit ? [`record-id:${record.recordId ?? ''}`] : []),
    ...coverage.hits.map((hit) => `keyword:${hit}`),
    ...(coverage.hits.length === 0
      ? []
      : [`keyword-strength:${round(coverage.strength).toFixed(2)}`]),
    ...(similarity > 0 ? [`jaccard:${round(similarity).toFixed(2)}`] : []),
    ...(parsed.malformed ? ['malformed:no-separator'] : []),
    // The score says how well the proposal matched the alternative; this says
    // whether that alternative is the one the author wrote (issue #372).
    ...(parsed.ambiguous ? ['malformed:ambiguous-separator'] : []),
  ];

  return {
    sha: record.sha,
    trust: record.trust ?? 'claim',
    alternative: parsed.alternative,
    reason: parsed.reason,
    score,
    signals,
    ...(record.recordId === undefined ? {} : { recordId: record.recordId }),
  };
};

/**
 * Every active `Ruled-out:` alternative in scope that this proposal revives,
 * strongest first.
 *
 * The record set comes from `core/query.ts`, which already applies the path
 * scope (following renames), the lifecycle fold — a `Supersedes:` retires the
 * rejection, and a rejection that no longer holds must not block anything — and
 * the `--at` replay. Guard adds matching and nothing else.
 *
 * Availability now travels with the matches because an empty result is only
 * actionable when git history was readable and the notes mirror was fetched.
 * The command still owns path-scope caveats because they derive from its input.
 */
export const guard = (opts: GuardOptions): GuardResult => {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const proposal = tokenize(opts.proposal);
  const ids = recordIdsIn(opts.proposal);

  const result = runQuery({
    keys: [RULED_OUT_KEY],
    ...(opts.paths === undefined ? {} : { paths: opts.paths }),
    ...(opts.at === undefined ? {} : { at: opts.at }),
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    ...(opts.noIndex === undefined ? {} : { noIndex: opts.noIndex }),
    ...(opts.trustedAuthors === undefined ? {} : { trustedAuthors: opts.trustedAuthors }),
    ...(opts.requireSignedDirective === true ? { requireSignedDirective: true } : {}),
  });
  const availability = {
    history: result.history,
    shallow: result.shallow,
    notes: result.notes,
    incomplete:
      result.history === 'unavailable' ||
      result.notes === 'unfetched' ||
      result.unreadCommits > 0,
  };

  if (proposal.stems.size === 0 && ids.size === 0) {
    return { matches: [], ...availability };
  }

  // Two passes, because the weight of a token is a property of the corpus:
  // every alternative is parsed and tokenized first, then scored against
  // frequencies counted over all of them.
  const candidates: Candidate[] = result.records.flatMap((record) => {
    const idHit = record.recordId !== undefined && ids.has(record.recordId);
    return valuesOf(record, RULED_OUT_KEY).map((value) => {
      const parsed = parseRuledOut(value);
      return {
        record,
        parsed,
        tokens: parsed.alternative === '' ? EMPTY_TOKENS : tokenize(parsed.alternative),
        idHit,
      };
    });
  });

  const corpus = buildCorpus(candidates.map((candidate) => candidate.tokens));

  return {
    matches: candidates
      .map((candidate) => matchOne(candidate, proposal, corpus, opts.requireContent ?? false))
      .filter((match): match is GuardMatch => match !== null && match.score >= threshold)
      .sort(compareMatches),
    ...availability,
  };
};
