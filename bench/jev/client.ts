/**
 * One bounded request to TypeSafe — #1046, ADR #1045 D4.
 *
 * Built-in `fetch`, one POST, one deadline, no retries, no SDK, no provider
 * abstraction and no initialization ping. The whole surface is `askJev`, and the
 * only caller is the optional producer.
 *
 * ## Shape of the call
 *
 * `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer` and
 * `{model, state, questions}`. `questions` is a map of id → Choice, where a
 * Choice is `{type: 'choice', instructions, criteria}` and `criteria` maps each
 * option to a description. The response is `{model, answers, usage}`, where each
 * answer is `{type: 'choice', choice, probabilities, confidence}`.
 *
 * ## Why every field is checked and nothing is coerced
 *
 * The answer authorizes a record that lands in git history. A `"0.95"` quietly
 * read as a number, a `probabilities` map renormalized because it summed to
 * 1.04, or a `choice` that is not the argmax are each a decision made by this
 * code rather than by the model — and a decision this code cannot defend. So an
 * answer that does not arrive in the declared shape authorizes nothing. There is
 * no numeric-string coercion and no renormalization anywhere below.
 *
 * A tie is its own case. Two options within `TIE_EPSILON` mean the model did not
 * choose, whatever `choice` says, so the answer cannot act.
 *
 * ## Why not-sent, unavailable and answered are three outcomes
 *
 * "No record was created" has three causes and they are not interchangeable.
 * Nothing was dispatched; something was dispatched and did not come back usable;
 * or answers arrived. Collapsing the first two into "no useful decision found"
 * is the reporting failure the PRD names — and the second cannot claim delivery
 * to the provider either, because a socket that closes mid-flight may or may not
 * have been read.
 *
 * `usage` is parsed independently of the answers. A response whose answers are
 * malformed may still have consumed tokens, and reporting that as zero spend
 * would understate a bill. Absent usage after a dispatch is unknown, not zero.
 */

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

/** Pinned, not `jev-latest`: an alias that moves changes behaviour silently. */
export const JEV_MODEL = 'jev-1.13.0';

/** Resource bounds from ADR D4. Byte counts, UTF-8, not character counts. */
export const STATE_BYTE_LIMIT = 64 * 1024;
export const REQUEST_BYTE_LIMIT = 128 * 1024;
export const RESPONSE_BYTE_LIMIT = 256 * 1024;

/**
 * One deadline, covering headers and the body read.
 *
 * A timeout on headers alone leaves a response that trickles forever, which is
 * the same hang with more steps. This is a resource bound on the HTTP call and
 * not a promise about the commit: local git work, verification and validation
 * all happen outside it.
 */
export const HTTP_DEADLINE_MS = 3000;

/** Two options this close mean the model did not choose (ADR D4). */
export const TIE_EPSILON = 1e-6;

/** How far `probabilities` may be from summing to 1 (ADR D4). */
export const SUM_TOLERANCE = 1e-3;

/** Input price per token for the checked model, docs read 2026-09-18. */
export const INPUT_TOKEN_USD = 0.042 / 1e6;

export interface JevChoiceQuestion {
  /** Map key in the request. Never sent as inference context. */
  readonly id: string;
  /** What the model is asked. Names the candidate; see #1047. */
  readonly instructions: string;
  /** Option label → what it means. The label set is the answer's domain. */
  readonly criteria: Readonly<Record<string, string>>;
}

export interface JevAnswer {
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export interface JevUsage {
  /** Null means the response did not report it — unknown, never zero. */
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Estimated from `inputTokens`. An estimate, never an invoice. */
  readonly estimatedUsd: number | null;
}

/**
 * Why nothing was dispatched, or why a dispatch produced nothing usable.
 *
 * A closed set: these strings reach a diagnostic file, and a provider's error
 * prose reaching one is how a response body ends up in an issue report.
 */
export type JevFailure =
  | 'state-too-large'
  | 'request-too-large'
  | 'no-questions'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'redirect'
  | 'http-error'
  | 'response-too-large'
  | 'malformed-response'
  | 'unexpected-model';

export interface JevNotSent {
  readonly status: 'not-sent';
  readonly failure: JevFailure;
  /** Nothing left the machine, so there is no usage to report. */
  readonly usage: null;
}

export interface JevUnavailable {
  readonly status: 'unavailable';
  readonly failure: JevFailure;
  /** A dispatch may have been billed even when its answers were unusable. */
  readonly usage: JevUsage | null;
  /** Present for `http-error`. The status only — never the body. */
  readonly httpStatus?: number;
}

export interface JevAnswered {
  readonly status: 'answered';
  /** Keyed by question id. Only answers that passed every check appear. */
  readonly answers: ReadonlyMap<string, JevAnswer>;
  /** Ids that were asked and came back unusable. Not the same as unanswered. */
  readonly unusable: readonly string[];
  readonly usage: JevUsage | null;
}

export type JevOutcome = JevNotSent | JevUnavailable | JevAnswered;

export interface AskJevOptions {
  readonly key: string;
  readonly state: string;
  readonly questions: readonly JevChoiceQuestion[];
  /** Caller cancellation. Aborts the socket and the body read. */
  readonly signal?: AbortSignal;
  /** Injected by tests. Defaults to the runtime's own `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Injected by tests so a deadline can be exercised without waiting. */
  readonly deadlineMs?: number;
}

const bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A finite number and nothing else.
 *
 * `typeof NaN === 'number'` and `typeof Infinity === 'number'`, and both survive
 * every comparison below by being false everywhere — a NaN confidence would
 * pass a `>= 0.9` test by failing it, which is the right direction only by
 * accident. A string is rejected rather than parsed (ADR D4: no coercion).
 */
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Usage, parsed on its own so a rejected answer still reports its cost.
 *
 * Deliberately tolerant in one direction only: a missing or malformed field
 * becomes `null` (unknown) rather than 0, because 0 is a claim about a bill.
 */
const parseUsage = (value: unknown): JevUsage | null => {
  if (!isRecord(value)) return null;
  const inputTokens = finite(value['input_tokens']);
  const outputTokens = finite(value['output_tokens']);
  if (inputTokens === null && outputTokens === null) return null;
  return {
    inputTokens,
    outputTokens,
    estimatedUsd: inputTokens === null ? null : inputTokens * INPUT_TOKEN_USD,
  };
};

/**
 * One answer, or null.
 *
 * Every rejection here is a rejection the ADR names, in the order that makes the
 * cheapest check first:
 *
 * 1. `type` must be the declared `choice`.
 * 2. `probabilities` keys must be exactly the option labels that were asked.
 *    Not a subset, not a superset — a label the request never declared is a
 *    different question being answered.
 * 3. Every probability finite and within [0, 1].
 * 4. The distribution sums to 1 within `SUM_TOLERANCE`. Not renormalized.
 * 5. `choice` is a declared label and is the *unique* maximum, with no runner-up
 *    within `TIE_EPSILON`.
 * 6. `confidence` finite and within [0, 1].
 */
const parseAnswer = (
  value: unknown,
  question: JevChoiceQuestion,
): JevAnswer | null => {
  if (!isRecord(value)) return null;
  if (value['type'] !== 'choice') return null;

  const distribution = value['probabilities'];
  if (!isRecord(distribution)) return null;

  const declared = Object.keys(question.criteria).sort();
  const returned = Object.keys(distribution).sort();
  if (declared.length !== returned.length) return null;
  if (declared.some((label, index) => label !== returned[index])) return null;

  const probabilities: Record<string, number> = {};
  let sum = 0;
  for (const label of declared) {
    const probability = finite(distribution[label]);
    if (probability === null || probability < 0 || probability > 1) return null;
    probabilities[label] = probability;
    sum += probability;
  }
  if (Math.abs(sum - 1) > SUM_TOLERANCE) return null;

  const choice = value['choice'];
  if (typeof choice !== 'string') return null;
  const chosen = probabilities[choice];
  if (chosen === undefined) return null;

  // Unique maximum. A runner-up within TIE_EPSILON means the model expressed no
  // preference, and acting on `choice` would be acting on a tiebreak nobody made.
  for (const [label, probability] of Object.entries(probabilities)) {
    if (label === choice) continue;
    if (probability > chosen) return null;
    if (Math.abs(probability - chosen) <= TIE_EPSILON) return null;
  }

  const confidence = finite(value['confidence']);
  if (confidence === null || confidence < 0 || confidence > 1) return null;

  return { choice, probabilities, confidence };
};

const notSent = (failure: JevFailure): JevNotSent => ({
  status: 'not-sent',
  failure,
  usage: null,
});

const unavailable = (
  failure: JevFailure,
  usage: JevUsage | null = null,
  httpStatus?: number,
): JevUnavailable => ({
  status: 'unavailable',
  failure,
  usage,
  ...(httpStatus === undefined ? {} : { httpStatus }),
});

/**
 * Reads at most `RESPONSE_BYTE_LIMIT` bytes, then gives up on the stream.
 *
 * `response.text()` has no bound, so a response that keeps producing bytes
 * inside the deadline is a memory problem rather than a timeout. The reader is
 * cancelled on every exit path, including the oversized one: a stream left open
 * holds the socket, and a hook that leaks one per commit runs out of them.
 */
const readBounded = async (response: Response): Promise<string | null> => {
  const body = response.body;
  if (body === null) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > RESPONSE_BYTE_LIMIT) return null;
      chunks.push(value);
    }
  } finally {
    // `cancel` on an already-drained reader is a no-op, so this is safe on the
    // success path too and does not need a flag to tell the cases apart.
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * The one request.
 *
 * Never throws. Every failure is an outcome, because the caller is a git hook:
 * an exception escaping here would have to be caught by the hook anyway, and a
 * catch around the whole optional path is exactly the construct ADR D1 forbids
 * near native validation.
 */
export const askJev = async (opts: AskJevOptions): Promise<JevOutcome> => {
  if (opts.questions.length === 0) return notSent('no-questions');
  if (bytes(opts.state) > STATE_BYTE_LIMIT) return notSent('state-too-large');

  const questions: Record<string, unknown> = {};
  for (const question of opts.questions) {
    questions[question.id] = {
      type: 'choice',
      instructions: question.instructions,
      criteria: question.criteria,
    };
  }
  const body = JSON.stringify({ model: JEV_MODEL, state: opts.state, questions });
  if (bytes(body) > REQUEST_BYTE_LIMIT) return notSent('request-too-large');

  const controller = new AbortController();
  const deadline = opts.deadlineMs ?? HTTP_DEADLINE_MS;
  /*
   * Set by the timer itself, not by a listener on `controller.signal`.
   *
   * Both the deadline and a caller cancellation abort the same controller, so a
   * listener there cannot tell them apart — it fires for either and reported
   * every caller abort as a timeout. The flag belongs to the cause, and the
   * classification below reads the caller's own signal first.
   */
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('deadline'));
  }, deadline);
  // `unref` so a hook that has finished its work is not held open by a pending
  // timer. Node's types put this on the Timeout object, not on the return of
  // the DOM-shaped `setTimeout` the lib target picks.
  (timer as unknown as { unref?: () => void }).unref?.();

  const onCallerAbort = (): void => {
    controller.abort(new Error('caller'));
  };
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true });

  const send = opts.fetchImpl ?? fetch;
  try {
    const response = await send(JEV_ENDPOINT, {
      method: 'POST',
      // Rejected rather than followed. A redirect moves a Bearer token to a
      // host this code never named, and `manual` on the fetch API returns an
      // opaque response rather than throwing, which reads as a bad response
      // instead of as a bad destination.
      redirect: 'error',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${opts.key}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body,
    });

    if (!response.ok) {
      // No retry on any of them, 429 and 529 included. A hook that retries has
      // doubled the latency of a commit to improve the odds of an optional
      // extra, and a rate limit answered with a second request is the request
      // the limit was asking not to receive.
      const text = await readBounded(response).catch(() => null);
      const usage = text === null ? null : parseUsage(safeParse(text)?.['usage']);
      return unavailable('http-error', usage, response.status);
    }

    const text = await readBounded(response);
    if (text === null) return unavailable('response-too-large');

    const parsed = safeParse(text);
    if (parsed === null) return unavailable('malformed-response');

    const usage = parseUsage(parsed['usage']);
    if (parsed['model'] !== JEV_MODEL) return unavailable('unexpected-model', usage);

    const answersField = parsed['answers'];
    if (!isRecord(answersField)) return unavailable('malformed-response', usage);

    const answers = new Map<string, JevAnswer>();
    const unusable: string[] = [];
    for (const question of opts.questions) {
      const answer = parseAnswer(answersField[question.id], question);
      if (answer === null) unusable.push(question.id);
      else answers.set(question.id, answer);
    }
    return { status: 'answered', answers, unusable, usage };
  } catch (error) {
    // The caller's signal first: a cancellation that races the deadline is
    // still a cancellation, and reporting it as a timeout would blame the
    // provider for the caller's own decision.
    if (opts.signal?.aborted === true) return unavailable('aborted');
    if (timedOut) return unavailable('timeout');
    // `redirect: 'error'` surfaces as a TypeError like any other fetch failure,
    // and the two are told apart by the message rather than by a type. Matching
    // loosely and defaulting to `network` keeps a misclassification from
    // becoming a wrong claim: both are "dispatched, nothing usable came back".
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('redirect')) return unavailable('redirect');
    return unavailable('network');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onCallerAbort);
  }
};

const safeParse = (text: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** A sentence for a diagnostic. Carries no provider prose and no key. */
export const describeOutcome = (outcome: JevOutcome): string => {
  if (outcome.status === 'answered') {
    return `answered: ${String(outcome.answers.size)} usable, ${String(outcome.unusable.length)} unusable`;
  }
  const status = outcome.status === 'not-sent' ? 'not sent' : 'unavailable';
  const http =
    outcome.status === 'unavailable' && outcome.httpStatus !== undefined
      ? ` (HTTP ${String(outcome.httpStatus)})`
      : '';
  return `${status}: ${outcome.failure}${http}`;
};
