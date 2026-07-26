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
 * 3. AnnalsBench (T-702) measures the re-proposal rate this route suppresses.
 *    A stochastic matcher would make the metric measure the matcher.
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
 * - **Distinctive-keyword coverage** (`KEYWORD_WEIGHT`) — the fraction of the
 *   alternative's *distinctive* tokens (see `GENERIC_TERMS`) that appear in the
 *   proposal. This is containment rather than similarity, which is what
 *   survives a proposal the size of a diff: "redis" is still in there.
 * - **`Record-Id:` hit** (`RECORD_ID_WEIGHT`) — the proposal names the record
 *   itself. Not similarity at all; an explicit reference.
 *
 * Jaccard alone answers "is this the same sentence"; coverage alone answers "is
 * the rejected thing named in here". Either question answered wrongly on its
 * own is a bad guard, which is why both are weighted and neither is a gate.
 *
 * ## What this cannot see
 *
 * A revival phrased without any of the rejected alternative's words — "let's
 * put the sessions in a service both boxes can reach", for a ruled-out
 * `shared Redis cache` — scores zero here. That is the honest limit of lexical
 * matching, and the reason `guard` is a warning route rather than a block.
 */

import { normalizeForMatch } from './grade.js';
import { RULED_OUT_KEY, runQuery, valuesOf, type GradedRecord } from './query.js';

export interface GuardMatch {
  recordId?: string;
  sha: string;
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

export interface GuardOptions {
  proposal: string;
  paths?: readonly string[];
  threshold?: number;
  at?: Date;
  cwd?: string;
  noIndex?: boolean;
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
 * 0.35 was chosen to sit in the gap the three weights create, and the gap is
 * wide:
 *
 * - **Fires.** One distinctive token, present (coverage 1.0) → 0.50, before any
 *   Jaccard. This is the floor case the ticket requires: `shared Redis cache`
 *   against "use a redis instance to store sessions" scores 0.58 — the wording
 *   shares one word out of six, and it must still fire.
 * - **Does not fire.** Coverage 1/3 — one of three distinctive tokens — is
 *   0.167, and needs Jaccard ≥ 0.37 to reach the threshold, i.e. more than a
 *   third of the combined vocabulary shared. `pgbouncer in transaction mode`
 *   against "wrap the writes in a transaction" scores 0.27.
 * - **Does not fire.** Jaccard alone must reach 0.70 — near restatement — to
 *   flag a proposal that names none of the alternative's distinctive tokens.
 *
 * Measured against the ten unrelated proposals in `spec/fixtures/guard/`, the
 * highest score is 0.10 (`test/guard.test.ts`), leaving 0.25 of headroom. The
 * threshold was not tuned down to that measurement: room above the noise is
 * what keeps a hook that runs on every Edit from being disabled.
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
  'thread', 'time', 'timeout', 'token', 'tool', 'type', 'update', 'url', 'user', 'value', 'version',
  'view', 'worker',
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

/** Words glued together by camelCase carry meaning: `SessionStore` is two tokens. */
const splitCamel = (text: string): string => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

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
 */
const tokenize = (text: string): Tokens => {
  const stems = new Set<string>();
  const surface = new Map<string, string>();

  for (const raw of normalizeForMatch(splitCamel(text)).split(/[^a-z0-9]+/)) {
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

interface Coverage {
  fraction: number;
  /** Surface forms of the distinctive tokens that hit, alphabetical. */
  hits: string[];
}

/**
 * The fraction of the alternative's distinctive tokens present in the proposal.
 *
 * Falling back to every content token when nothing survives `GENERIC_STEMS` is
 * not a formality: `shared cache` and `in-process map` are real rejected
 * alternatives made entirely of generic words, and dropping them from the guard
 * would mean the vaguer the rejection, the weaker the protection.
 */
const keywordCoverage = (alternative: Tokens, proposal: Tokens): Coverage => {
  const distinctive = [...alternative.stems].filter((token) => !GENERIC_STEMS.has(token));
  const considered = distinctive.length === 0 ? [...alternative.stems] : distinctive;
  if (considered.length === 0) return { fraction: 0, hits: [] };

  const hits = considered
    .filter((token) => proposal.stems.has(token))
    .map((token) => alternative.surface.get(token) ?? token)
    .sort();

  return { fraction: hits.length / considered.length, hits };
};

/** `alternative | reason` (SPEC §3.1). Only the first `|` separates. */
interface RuledOut {
  alternative: string;
  reason: string;
  malformed: boolean;
}

/** Folded continuations arrive as one line already; this only tidies runs of spaces. */
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const parseRuledOut = (value: string): RuledOut => {
  const at = value.indexOf('|');
  // A value with no separator violates SPEC §3.1 and `commitlore validate`
  // reports it. Guarding on it anyway is deliberate: refusing to match a
  // malformed record would turn a formatting mistake into a silent loss of the
  // protection the record was written to provide.
  if (at === -1) return { alternative: collapse(value), reason: '', malformed: true };
  return {
    alternative: collapse(value.slice(0, at)),
    reason: collapse(value.slice(at + 1)),
    malformed: false,
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

const matchOne = (
  record: GradedRecord,
  value: string,
  proposal: Tokens,
  idHit: boolean,
): GuardMatch => {
  const { alternative, reason, malformed } = parseRuledOut(value);
  const tokens = alternative === '' ? EMPTY_TOKENS : tokenize(alternative);

  const similarity = jaccard(tokens.stems, proposal.stems);
  const coverage = keywordCoverage(tokens, proposal);
  const score = round(
    Math.min(
      1,
      JACCARD_WEIGHT * similarity +
        KEYWORD_WEIGHT * coverage.fraction +
        (idHit ? RECORD_ID_WEIGHT : 0),
    ),
  );

  const signals = [
    ...(idHit ? [`record-id:${record.recordId ?? ''}`] : []),
    ...coverage.hits.map((hit) => `keyword:${hit}`),
    ...(similarity > 0 ? [`jaccard:${round(similarity).toFixed(2)}`] : []),
    ...(malformed ? ['malformed:no-separator'] : []),
  ];

  return {
    sha: record.sha,
    alternative,
    reason,
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
 * The query's own diagnostics are not returned: the ticket fixes this signature
 * at `GuardMatch[]`, and the one diagnostic that changes what an empty answer
 * means — several paths, so renames were not followed — is a property of the
 * caller's own arguments, which `commands/guard.ts` reports without asking.
 */
export const guard = (opts: GuardOptions): GuardMatch[] => {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const proposal = tokenize(opts.proposal);
  const ids = recordIdsIn(opts.proposal);

  // An empty proposal names nothing. Running the query to prove it would make
  // the no-op case the slowest one on a hook that fires constantly.
  if (proposal.stems.size === 0 && ids.size === 0) return [];

  const result = runQuery({
    keys: [RULED_OUT_KEY],
    ...(opts.paths === undefined ? {} : { paths: opts.paths }),
    ...(opts.at === undefined ? {} : { at: opts.at }),
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    ...(opts.noIndex === undefined ? {} : { noIndex: opts.noIndex }),
  });

  return result.records
    .flatMap((record) => {
      const idHit = record.recordId !== undefined && ids.has(record.recordId);
      return valuesOf(record, RULED_OUT_KEY).map((value) =>
        matchOne(record, value, proposal, idHit),
      );
    })
    .filter((match) => match.score >= threshold)
    .sort(compareMatches);
};
