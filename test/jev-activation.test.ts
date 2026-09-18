/**
 * #1046: the gate between a default installation and the optional prototype.
 *
 * Everything in `src/jev/` is unreachable unless this function says so, which
 * makes it the one place a no-key guarantee can be established rather than
 * asserted. The tests below are in three groups: what enables, what does not,
 * and what the enabled value refuses to leak.
 *
 * The keys here are synthetic strings of the right shape. None was ever issued.
 */

import { describe, expect, it } from 'vitest';

import { describeActivation, resolveJevActivation } from '../src/jev/activation.js';

/** Long enough to pass the length floor, and obviously not a credential. */
const DEDICATED = 'apikey_test_dedicated_000000000000000000';
const STANDARD = 'apikey_test_standard_0000000000000000000';

describe('#1046 what enables the prototype', () => {
  it('is disabled with an empty environment', () => {
    // The default state of every installation. `no-key` rather than `off`,
    // because nobody turned it off — it was never on.
    const activation = resolveJevActivation({});
    expect(activation.enabled).toBe(false);
    expect(activation.enabled === false && activation.reason).toBe('no-key');
    expect(activation.mode).toBe('auto');
  }, 300_000);

  it('enables on the dedicated key alone', () => {
    const activation = resolveJevActivation({ COMMITLORE_JEV_API_KEY: DEDICATED });
    expect(activation.enabled).toBe(true);
    expect(activation.enabled && activation.keySource).toBe('COMMITLORE_JEV_API_KEY');
    expect(activation.enabled && activation.key).toBe(DEDICATED);
  }, 300_000);

  it('does not enable on a bare TypeSafe key', () => {
    // `TYPESAFE_API_KEY` is a standard variable a machine may have set for
    // something else entirely. Treating it as consent to this would enrol a
    // user who never asked, and bill an account they set up for another tool.
    const activation = resolveJevActivation({ TYPESAFE_API_KEY: STANDARD });
    expect(activation.enabled).toBe(false);
    expect(activation.enabled === false && activation.reason).toBe('no-key');
  }, 300_000);

  it('accepts the standard key only under an explicit `on`', () => {
    const activation = resolveJevActivation({
      COMMITLORE_JEV: 'on',
      TYPESAFE_API_KEY: STANDARD,
    });
    expect(activation.enabled).toBe(true);
    expect(activation.enabled && activation.keySource).toBe('TYPESAFE_API_KEY');
  }, 300_000);

  it('prefers the dedicated key under `on`', () => {
    const activation = resolveJevActivation({
      COMMITLORE_JEV: 'on',
      COMMITLORE_JEV_API_KEY: DEDICATED,
      TYPESAFE_API_KEY: STANDARD,
    });
    expect(activation.enabled && activation.keySource).toBe('COMMITLORE_JEV_API_KEY');
    expect(activation.enabled && activation.key).toBe(DEDICATED);
  }, 300_000);
});

describe('#1046 what disables it', () => {
  it('off wins over every key', () => {
    for (const env of [
      { COMMITLORE_JEV: 'off', COMMITLORE_JEV_API_KEY: DEDICATED },
      { COMMITLORE_JEV: 'off', TYPESAFE_API_KEY: STANDARD },
      { COMMITLORE_JEV: 'off', COMMITLORE_JEV_API_KEY: DEDICATED, TYPESAFE_API_KEY: STANDARD },
    ]) {
      const activation = resolveJevActivation(env);
      expect(activation.enabled).toBe(false);
      expect(activation.enabled === false && activation.reason).toBe('off');
    }
  }, 300_000);

  it('treats a blank value as absent, not as a setting', () => {
    // A variable set to spaces is a variable somebody cleared. Reading it as a
    // mode would be an "invalid-mode" refusal for an unset variable.
    expect(resolveJevActivation({ COMMITLORE_JEV: '   ' }).mode).toBe('auto');
    const blankKey = resolveJevActivation({ COMMITLORE_JEV_API_KEY: '  ' });
    expect(blankKey.enabled).toBe(false);
    expect(blankKey.enabled === false && blankKey.reason).toBe('no-key');
  }, 300_000);

  it('refuses a mode it does not recognise, without echoing it', () => {
    const activation = resolveJevActivation({
      COMMITLORE_JEV: 'yes-please',
      COMMITLORE_JEV_API_KEY: DEDICATED,
    });
    expect(activation.enabled).toBe(false);
    expect(activation.enabled === false && activation.reason).toBe('invalid-mode');
    expect(describeActivation(activation)).not.toContain('yes-please');
  }, 300_000);

  it('refuses a header-unsafe key without displaying it', () => {
    // A newline *inside* a Bearer value is header injection; a non-ASCII byte
    // makes `fetch` throw from inside the header setter, far from the variable
    // that caused it; something too short to be a key is a misconfiguration.
    for (const bad of [
      `${DEDICATED}\nx-injected: 1`,
      `apikey_test\rx-injected: 1${DEDICATED}`,
      `apikey_test\tpadded${DEDICATED}`,
      'apikey_éééééééééééééééé',
      'short',
    ]) {
      const activation = resolveJevActivation({ COMMITLORE_JEV_API_KEY: bad });
      expect(activation.enabled, `accepted ${JSON.stringify(bad.slice(0, 12))}`).toBe(false);
      expect(activation.enabled === false && activation.reason).toBe('unusable-key');
      expect(describeActivation(activation)).not.toContain(bad.trim());
    }
  }, 300_000);

  it('trims surrounding whitespace rather than calling it unusable', () => {
    // `export KEY=$(cat keyfile)` picks up a trailing newline routinely, and the
    // trimmed result carries no control character — so this is a usable key, not
    // an injection. Asserted because the boundary between the two is exactly
    // where a "reject anything with a newline in it" rule goes wrong.
    const activation = resolveJevActivation({ COMMITLORE_JEV_API_KEY: `  ${DEDICATED}\n` });
    expect(activation.enabled).toBe(true);
    expect(activation.enabled && activation.key).toBe(DEDICATED);
  }, 300_000);

  it('does not fall through from an unusable dedicated key to another account', () => {
    // The rule this file exists for. Reaching past a configured-but-broken
    // `COMMITLORE_JEV_API_KEY` would export source text and bill tokens against
    // a *different* account than the operator configured — a wrong answer that
    // looks like a working one.
    const activation = resolveJevActivation({
      COMMITLORE_JEV: 'on',
      COMMITLORE_JEV_API_KEY: `${DEDICATED}\nx-injected: 1`,
      TYPESAFE_API_KEY: STANDARD,
    });
    expect(activation.enabled).toBe(false);
    expect(activation.enabled === false && activation.reason).toBe('unusable-key');
  }, 300_000);
});

describe('#1046 the enabled value does not leak its key', () => {
  const activation = resolveJevActivation({ COMMITLORE_JEV_API_KEY: DEDICATED });

  it('is absent from JSON.stringify', () => {
    // The one that matters most: `--json` payloads, pending records and the
    // diagnostic file are all JSON, and a key reaching any of them is permanent
    // in a way the environment variable is not.
    expect(JSON.stringify(activation)).not.toContain(DEDICATED);
    expect(JSON.stringify({ wrapped: activation })).not.toContain(DEDICATED);
  }, 300_000);

  it('is absent from a spread and from Object.keys', () => {
    expect(JSON.stringify({ ...activation })).not.toContain(DEDICATED);
    expect(Object.keys(activation)).not.toContain('key');
  }, 300_000);

  it('is redacted by util.inspect, which is what console.log uses', async () => {
    const { inspect } = await import('node:util');
    expect(inspect(activation)).not.toContain(DEDICATED);
    expect(inspect(activation)).toContain('[redacted]');
  }, 300_000);

  it('is still readable by the client that needs it', () => {
    // The control. A hiding scheme that also hid the key from its one legitimate
    // reader would pass every assertion above and break the feature.
    expect(activation.enabled && activation.key).toBe(DEDICATED);
  }, 300_000);

  it('never appears in the sentence doctor prints', () => {
    expect(describeActivation(activation)).not.toContain(DEDICATED);
    expect(describeActivation(activation)).toContain('COMMITLORE_JEV_API_KEY');
  }, 300_000);
});
