/**
 * #1046: one bounded request, and an answer that authorizes nothing unless it
 * arrives in the declared shape.
 *
 * `fetch` is injected throughout, so none of this needs a key or a network. What
 * is being pinned is the *contract*: the exact request shape, the bounds, and
 * every rejection the ADR names. The rejections are the substance — an answer
 * this client accepts becomes a trailer in git history, so each check below is a
 * thing the code must refuse to decide on the model's behalf.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  askJev,
  describeOutcome,
  HTTP_DEADLINE_MS,
  INPUT_TOKEN_USD,
  JEV_ENDPOINT,
  JEV_MODEL,
  REQUEST_BYTE_LIMIT,
  RESPONSE_BYTE_LIMIT,
  STATE_BYTE_LIMIT,
  type JevChoiceQuestion,
} from '../src/jev/client.js';

const KEY = 'apikey_test_client_00000000000000000000';

const QUESTION: JevChoiceQuestion = {
  id: 'kind:c0',
  instructions: 'Assess candidate c0.',
  criteria: { limit: 'a constraint', none: 'not a decision' },
};

const answered = (body: unknown, init: ResponseInit = {}): typeof fetch =>
  vi.fn(async () =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      }),
    ),
  ) as unknown as typeof fetch;

const goodAnswer = {
  model: JEV_MODEL,
  answers: {
    'kind:c0': {
      type: 'choice',
      choice: 'limit',
      probabilities: { limit: 0.95, none: 0.05 },
      confidence: 0.93,
    },
  },
  usage: { input_tokens: 312, output_tokens: 48 },
};

describe('#1046 the request', () => {
  it('posts the documented shape to the documented endpoint', async () => {
    const send = answered(goodAnswer);
    await askJev({ key: KEY, state: 'SOURCE', questions: [QUESTION], fetchImpl: send });

    const mock = send as unknown as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(JEV_ENDPOINT);
    expect(init.method).toBe('POST');
    // Rejected, not followed: a redirect moves a Bearer token to a host this
    // code never named.
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${KEY}`);

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body['model']).toBe(JEV_MODEL);
    expect(body['state']).toBe('SOURCE');
    // `questions` is a map keyed by id, and the Choice carries `instructions`
    // and `criteria` — the shape the API documents.
    expect(body['questions']).toEqual({
      'kind:c0': {
        type: 'choice',
        instructions: 'Assess candidate c0.',
        criteria: { limit: 'a constraint', none: 'not a decision' },
      },
    });
  }, 300_000);

  it('pins the model rather than sending an alias', async () => {
    // `jev-latest` moves. A pinned id makes a model change a visible failure
    // (`unexpected-model`) instead of a silent behaviour change.
    expect(JEV_MODEL).toBe('jev-1.13.0');
  }, 300_000);

  it('sends nothing at all when there is nothing to ask', async () => {
    const send = answered(goodAnswer);
    const outcome = await askJev({ key: KEY, state: 'x', questions: [], fetchImpl: send });
    expect(outcome.status).toBe('not-sent');
    expect(outcome.status === 'not-sent' && outcome.failure).toBe('no-questions');
    expect(send as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  }, 300_000);

  it('refuses an oversized state before dispatching', async () => {
    const send = answered(goodAnswer);
    const outcome = await askJev({
      key: KEY,
      state: 'x'.repeat(STATE_BYTE_LIMIT + 1),
      questions: [QUESTION],
      fetchImpl: send,
    });
    expect(outcome.status === 'not-sent' && outcome.failure).toBe('state-too-large');
    expect(outcome.usage).toBeNull();
    expect(send as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  }, 300_000);

  it('refuses an oversized whole request before dispatching', async () => {
    // A state inside its own bound can still make an over-limit request once
    // the questions are attached, and the byte count is over the serialized
    // body rather than over the state alone.
    const send = answered(goodAnswer);
    const many: JevChoiceQuestion[] = Array.from({ length: 16 }, (_, index) => ({
      id: `q${String(index)}`,
      instructions: 'y'.repeat(9000),
      criteria: { a: 'a', b: 'b' },
    }));
    const outcome = await askJev({ key: KEY, state: 'small', questions: many, fetchImpl: send });
    expect(outcome.status === 'not-sent' && outcome.failure).toBe('request-too-large');
    expect(send as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(REQUEST_BYTE_LIMIT).toBe(128 * 1024);
  }, 300_000);

  it('counts UTF-8 bytes, not characters', async () => {
    // A budget measured in characters is roughly a third of the real one for
    // Korean or Japanese text, so a conversation in either would be refused
    // while fitting comfortably.
    const send = answered(goodAnswer);
    const state = '한'.repeat(Math.floor(STATE_BYTE_LIMIT / 3) + 100);
    expect(state.length).toBeLessThan(STATE_BYTE_LIMIT);
    const outcome = await askJev({ key: KEY, state, questions: [QUESTION], fetchImpl: send });
    expect(outcome.status === 'not-sent' && outcome.failure).toBe('state-too-large');
  }, 300_000);
});

describe('#1046 the deadline and the bounds', () => {
  it('gives up on a response that never arrives, and does not retry', async () => {
    let calls = 0;
    const send = (async (_url: string, init?: RequestInit) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    }) as unknown as typeof fetch;

    const outcome = await askJev({
      key: KEY,
      state: 'x',
      questions: [QUESTION],
      fetchImpl: send,
      deadlineMs: 25,
    });
    expect(outcome.status).toBe('unavailable');
    expect(outcome.status === 'unavailable' && outcome.failure).toBe('timeout');
    expect(calls, 'a hook that retries has doubled the commit it is delaying').toBe(1);
  }, 300_000);

  it('bounds the body read, so a stream inside the deadline is still bounded', async () => {
    // `response.text()` has no ceiling: a response that keeps producing bytes
    // fast enough is a memory problem rather than a timeout.
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    let pushed = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pushed += chunk.byteLength;
        controller.enqueue(chunk);
        if (pushed > RESPONSE_BYTE_LIMIT * 2) controller.close();
      },
    });
    const send = (async () =>
      new Response(body, { status: 200 })) as unknown as typeof fetch;

    const outcome = await askJev({ key: KEY, state: 'x', questions: [QUESTION], fetchImpl: send });
    expect(outcome.status === 'unavailable' && outcome.failure).toBe('response-too-large');
  }, 300_000);

  it('reports a caller abort as an abort, not as a timeout', async () => {
    const controller = new AbortController();
    const send = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
        controller.abort();
      })) as unknown as typeof fetch;

    const outcome = await askJev({
      key: KEY,
      state: 'x',
      questions: [QUESTION],
      fetchImpl: send,
      signal: controller.signal,
    });
    expect(outcome.status === 'unavailable' && outcome.failure).toBe('aborted');
  }, 300_000);

  it('keeps the deadline off the local work', () => {
    // Stated as a constant rather than a promise about a commit: git reads,
    // native verification and validation all happen outside this.
    expect(HTTP_DEADLINE_MS).toBe(3000);
  }, 300_000);

  it('does not retry an error status, 429 included', async () => {
    for (const status of [401, 422, 429, 500, 529]) {
      let calls = 0;
      const send = (async () => {
        calls += 1;
        return new Response('{"error":"nope"}', { status });
      }) as unknown as typeof fetch;
      const outcome = await askJev({ key: KEY, state: 'x', questions: [QUESTION], fetchImpl: send });
      expect(calls, `retried on ${String(status)}`).toBe(1);
      expect(outcome.status === 'unavailable' && outcome.failure).toBe('http-error');
      expect(outcome.status === 'unavailable' && outcome.httpStatus).toBe(status);
      // The status, never the body: a provider's error prose in a diagnostic
      // file is a response body in somebody's pasted issue report.
      expect(describeOutcome(outcome)).not.toContain('nope');
    }
  }, 300_000);
});

describe('#1046 an answer that cannot act', () => {
  const ask = async (answers: unknown, model: unknown = JEV_MODEL): Promise<ReturnType<typeof askJev>> =>
    askJev({
      key: KEY,
      state: 'x',
      questions: [QUESTION],
      fetchImpl: answered({ model, answers, usage: { input_tokens: 10, output_tokens: 0 } }),
    });

  it('accepts the good answer — the control for everything below', async () => {
    const outcome = await ask(goodAnswer.answers);
    expect(outcome.status).toBe('answered');
    expect(outcome.status === 'answered' && outcome.answers.get('kind:c0')?.choice).toBe('limit');
    expect(outcome.status === 'answered' && outcome.unusable).toEqual([]);
  }, 300_000);

  it('refuses a model it did not ask for', async () => {
    const outcome = await ask(goodAnswer.answers, 'jev-2.0.0');
    expect(outcome.status === 'unavailable' && outcome.failure).toBe('unexpected-model');
    // Usage survives: the request was billed whatever the answer turned out to be.
    expect(outcome.usage?.inputTokens).toBe(10);
  }, 300_000);

  it('refuses a probability map whose labels are not the ones asked', async () => {
    // Not a subset and not a superset. A label the request never declared is a
    // different question being answered.
    for (const probabilities of [
      { limit: 1 },
      { limit: 0.5, none: 0.4, warn: 0.1 },
      { limit: 0.9, other: 0.1 },
    ]) {
      const outcome = await ask({
        'kind:c0': { type: 'choice', choice: 'limit', probabilities, confidence: 0.95 },
      });
      expect(outcome.status === 'answered' && outcome.unusable).toEqual(['kind:c0']);
    }
  }, 300_000);

  it('refuses a distribution that does not sum to one, rather than renormalizing', async () => {
    const outcome = await ask({
      'kind:c0': { type: 'choice', choice: 'limit', probabilities: { limit: 0.9, none: 0.4 }, confidence: 0.95 },
    });
    expect(outcome.status === 'answered' && outcome.unusable).toEqual(['kind:c0']);
  }, 300_000);

  it('refuses a choice that is not the maximum', async () => {
    const outcome = await ask({
      'kind:c0': { type: 'choice', choice: 'limit', probabilities: { limit: 0.2, none: 0.8 }, confidence: 0.95 },
    });
    expect(outcome.status === 'answered' && outcome.unusable).toEqual(['kind:c0']);
  }, 300_000);

  it('refuses a tie, whatever `choice` says', async () => {
    // Two options within 1e-6 mean the model expressed no preference, so acting
    // on `choice` would be acting on a tiebreak nobody made.
    const outcome = await ask({
      'kind:c0': {
        type: 'choice',
        choice: 'limit',
        probabilities: { limit: 0.5, none: 0.5 },
        confidence: 0.99,
      },
    });
    expect(outcome.status === 'answered' && outcome.unusable).toEqual(['kind:c0']);
  }, 300_000);

  it('does not coerce a numeric string', async () => {
    const outcome = await ask({
      'kind:c0': {
        type: 'choice',
        choice: 'limit',
        probabilities: { limit: '0.95', none: '0.05' },
        confidence: '0.93',
      },
    });
    expect(outcome.status === 'answered' && outcome.unusable).toEqual(['kind:c0']);
  }, 300_000);

  it('refuses a non-finite probability or confidence', async () => {
    // `typeof NaN === 'number'`, and NaN passes a `>= 0.9` test by failing it —
    // the right direction only by accident. JSON has no NaN literal, so this
    // arrives as the string form a lax parser would coerce.
    for (const answers of [
      { 'kind:c0': { type: 'choice', choice: 'limit', probabilities: { limit: 1e400, none: 0 }, confidence: 0.95 } },
      { 'kind:c0': { type: 'choice', choice: 'limit', probabilities: { limit: 1, none: 0 }, confidence: 1.5 } },
      { 'kind:c0': { type: 'choice', choice: 'limit', probabilities: { limit: 1, none: 0 }, confidence: -0.1 } },
    ]) {
      const outcome = await ask(answers);
      expect(outcome.status === 'answered' && outcome.unusable).toEqual(['kind:c0']);
    }
  }, 300_000);

  it('refuses an answer of the wrong type, and a missing one', async () => {
    const wrongType = await ask({
      'kind:c0': { type: 'text', choice: 'limit', probabilities: { limit: 1, none: 0 }, confidence: 0.95 },
    });
    expect(wrongType.status === 'answered' && wrongType.unusable).toEqual(['kind:c0']);

    const missing = await ask({ 'kind:other': goodAnswer.answers['kind:c0'] });
    expect(missing.status === 'answered' && missing.unusable).toEqual(['kind:c0']);
  }, 300_000);

  it('calls malformed JSON malformed, and still reports no usage it cannot read', async () => {
    const outcome = await askJev({
      key: KEY,
      state: 'x',
      questions: [QUESTION],
      fetchImpl: answered('{not json'),
    });
    expect(outcome.status === 'unavailable' && outcome.failure).toBe('malformed-response');
    expect(outcome.usage).toBeNull();
  }, 300_000);
});

describe('#1046 usage is reported honestly', () => {
  it('reads usage independently of the answers', async () => {
    // A rejected decision may still have been billed. Dropping its usage would
    // understate a bill by exactly the requests that went wrong.
    const outcome = await askJev({
      key: KEY,
      state: 'x',
      questions: [QUESTION],
      fetchImpl: answered({
        model: JEV_MODEL,
        answers: { 'kind:c0': { type: 'choice', choice: 'limit', probabilities: { limit: 0.5, none: 0.5 }, confidence: 1 } },
        usage: { input_tokens: 1000, output_tokens: 0 },
      }),
    });
    expect(outcome.status === 'answered' && outcome.unusable).toEqual(['kind:c0']);
    expect(outcome.usage?.inputTokens).toBe(1000);
  }, 300_000);

  it('calls missing usage unknown, never zero', async () => {
    const outcome = await askJev({
      key: KEY,
      state: 'x',
      questions: [QUESTION],
      fetchImpl: answered({ model: JEV_MODEL, answers: goodAnswer.answers }),
    });
    expect(outcome.usage, 'zero would be a claim about a bill').toBeNull();
  }, 300_000);

  it('estimates cost from the dated price, and says it is an estimate', async () => {
    // $42 per billion input tokens, output free — docs read 2026-09-18.
    expect(INPUT_TOKEN_USD).toBeCloseTo(0.042 / 1e6, 12);
    const outcome = await askJev({
      key: KEY,
      state: 'x',
      questions: [QUESTION],
      fetchImpl: answered(goodAnswer),
    });
    expect(outcome.usage?.estimatedUsd).toBeCloseTo(312 * (0.042 / 1e6), 12);
  }, 300_000);

  it('tells not-sent from dispatched-and-unusable', async () => {
    // "No record was created" has causes that are not interchangeable, and
    // collapsing them is the reporting failure the PRD names.
    const notSent = await askJev({ key: KEY, state: 'x', questions: [], fetchImpl: answered(goodAnswer) });
    const dispatched = await askJev({
      key: KEY,
      state: 'x',
      questions: [QUESTION],
      fetchImpl: (async () => {
        throw new Error('socket hang up');
      }) as unknown as typeof fetch,
    });
    expect(notSent.status).toBe('not-sent');
    expect(dispatched.status).toBe('unavailable');
    expect(dispatched.status === 'unavailable' && dispatched.failure).toBe('network');
    expect(describeOutcome(notSent)).toContain('not sent');
    expect(describeOutcome(dispatched)).toContain('unavailable');
  }, 300_000);
});
