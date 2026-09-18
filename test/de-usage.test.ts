/**
 * Whole-host token accounting — #1035, revision `native-efficacy-r6.1`.
 *
 * Transcribed from the issue body, including the case it names outright:
 * "categories100+200+300+40=640". That total is the point of the module. The
 * legacy driver would report 340 for the same request, because it excludes cache
 * reads on purpose — correct for bounding work under a global cap, wrong for
 * comparing cost between two arms, since the arm that reads a larger cached
 * prefix would look cheaper.
 *
 * The other rules pinned here are the ones whose violation yields a plausible
 * number rather than an error:
 *
 *   - "No numeric coercion or `value || 0`; counters are finite nonnegative safe
 *      integers or null."
 *   - "Deduplicate content blocks by real request identity; cumulative output
 *      uses the latest complete value."
 *   - "Distinct observed requests/retries/auxiliary calls remain included."
 *   - "If final usage is missing or reports zero despite observed earlier
 *      consumption, retain known lower/subtotals and unknown complete usage."
 */

import { describe, expect, it } from 'vitest';

import {
  accountUsage,
  categoriesOf,
  counterOf,
  totalOf,
  type ObservedRequest,
  type UsageCategories,
} from '../bench/de/usage.ts';

const categories = (
  input: number | null,
  cache_creation: number | null,
  cache_read: number | null,
  output: number | null,
): UsageCategories => ({ input, cache_creation, cache_read, output });

const request = (over: Partial<ObservedRequest> = {}): ObservedRequest => ({
  request_id: 'req-1',
  model: 'claude-opus-5',
  role: 'main',
  sequence: 0,
  usage: categories(100, 200, 300, 40),
  ...over,
});

describe('#1035 the four categories are counted, cache reads included', () => {
  it('totals 100 + 200 + 300 + 40 = 640', () => {
    const account = accountUsage([request()], { scope: 'host_total' });

    expect(account.totals).toEqual(categories(100, 200, 300, 40));
    expect(account.total).toBe(640);
    expect(account.completeness).toBe('complete');
  });

  it('keeps the categories apart rather than reporting one number', () => {
    // They are priced differently and a single total cannot be re-derived into
    // them, so the split is the report's unit rather than a convenience.
    const account = accountUsage([request()], { scope: 'host_total' });

    expect(account.totals.cache_read).toBe(300);
    expect(account.totals.output).toBe(40);
  });

  it('reads cache_read_input_tokens out of a raw usage object', () => {
    // The legacy driver drops this field deliberately. The measured path must
    // not inherit that, which is the one behaviour #1035 names twice.
    expect(categoriesOf({
      input_tokens: 100,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 300,
      output_tokens: 40,
    })).toEqual(categories(100, 200, 300, 40));
  });
});

describe('#1035 missing is null, never zero', () => {
  it('rejects every value that is not a finite non-negative safe integer', () => {
    expect(counterOf(0)).toBe(0);
    expect(counterOf(41)).toBe(41);
    expect(counterOf(undefined)).toBeNull();
    expect(counterOf(null)).toBeNull();
    expect(counterOf('100')).toBeNull();
    expect(counterOf(1.5)).toBeNull();
    expect(counterOf(-1)).toBeNull();
    expect(counterOf(Number.NaN)).toBeNull();
    expect(counterOf(Number.POSITIVE_INFINITY)).toBeNull();
    expect(counterOf(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
  });

  it('reads an absent field as null rather than zero', () => {
    expect(categoriesOf({ input_tokens: 100 })).toEqual(categories(100, null, null, null));
    expect(categoriesOf(null)).toEqual(categories(null, null, null, null));
  });

  it('makes the total unknown when any category is unknown', () => {
    // Treating null as zero would turn "we do not know what this cost" into
    // "this was free", and the arm with the broken reporter would win.
    expect(totalOf(categories(100, 200, null, 40))).toBeNull();
  });

  it('reports a lower bound rather than a total when a request did not report', () => {
    const account = accountUsage(
      [request(), request({ request_id: 'req-2', usage: categories(null, null, null, null) })],
      { scope: 'host_total' },
    );

    expect(account.total).toBeNull();
    expect(account.completeness).toBe('lower_bound');
    expect(account.notes.join(' ')).toMatch(/lower bound/);
  });

  it('distinguishes no request observed from a run that cost nothing', () => {
    const account = accountUsage([], { scope: 'unknown' });

    expect(account.completeness).toBe('unknown');
    expect(account.requests).toBe(0);
    expect(account.notes.join(' ')).toMatch(/not the same as a run that cost nothing/);
  });
});

describe('#1035 deduplication by real request identity', () => {
  it('collapses repeated content blocks to the latest cumulative value', () => {
    // A stream repeats a request's usage per content block with the output
    // figure growing. Summing the blocks multiplies the input by the number of
    // blocks, which is how one request becomes three.
    const account = accountUsage(
      [
        request({ sequence: 0, usage: categories(100, 200, 300, 4) }),
        request({ sequence: 1, usage: categories(100, 200, 300, 22) }),
        request({ sequence: 2, usage: categories(100, 200, 300, 40) }),
      ],
      { scope: 'host_total' },
    );

    expect(account.requests).toBe(1);
    expect(account.total).toBe(640);
    expect(account.notes.join(' ')).toMatch(/collapsed to their latest value/);
  });

  it('keeps distinct requests, retries and auxiliary calls', () => {
    // "Distinct observed requests/retries/auxiliary calls remain included."
    const account = accountUsage(
      [
        request({ request_id: 'req-1', usage: categories(100, 0, 0, 10) }),
        request({ request_id: 'req-1-retry', usage: categories(100, 0, 0, 10) }),
        request({
          request_id: 'aux-1',
          role: 'auxiliary',
          model: 'claude-haiku-4-5',
          usage: categories(20, 0, 0, 5),
        }),
      ],
      { scope: 'host_total' },
    );

    expect(account.requests).toBe(3);
    expect(account.total).toBe(245);
    expect(account.by_model['claude-haiku-4-5']).toEqual(categories(20, 0, 0, 5));
    expect(account.by_model['claude-opus-5']).toEqual(categories(200, 0, 0, 20));
  });
});

describe('#1035 a final zero after observed spend is a lower bound', () => {
  it('retains the observed subtotal and marks the complete usage unknown', () => {
    const account = accountUsage([request()], {
      scope: 'host_total',
      reportedFinal: categories(0, 0, 0, 0),
    });

    expect(account.totals).toEqual(categories(100, 200, 300, 40));
    expect(account.completeness).toBe('lower_bound');
    expect(account.notes.join(' ')).toMatch(/final total of 0 after 640 observed token/);
  });

  it('keeps both totals when the host and the reconstruction disagree', () => {
    // "Host aggregates and per-request reconstruction are alternative totals."
    // The disagreement is information; resolving it silently would hide whether
    // the host's aggregate covers subagents.
    const account = accountUsage([request()], {
      scope: 'main_loop',
      reportedFinal: categories(100, 200, 300, 900),
    });

    expect(account.total).toBe(640);
    expect(account.completeness).toBe('complete');
    expect(account.notes.join(' ')).toMatch(/disagree; both are retained/);
  });

  it('says nothing when the host agrees with the reconstruction', () => {
    const account = accountUsage([request()], {
      scope: 'host_total',
      reportedFinal: categories(100, 200, 300, 40),
    });

    expect(account.notes).toEqual([]);
    expect(account.completeness).toBe('complete');
  });
});

describe('#1035 the scope of the total is explicit', () => {
  it('carries the scope it was accounted under', () => {
    // "Scope is explicit: host_total/main_loop/partial/unknown." A number whose
    // scope is unstated cannot be compared with another arm's.
    expect(accountUsage([request()], { scope: 'partial' }).scope).toBe('partial');
    expect(accountUsage([request()], { scope: 'main_loop' }).scope).toBe('main_loop');
  });
});
