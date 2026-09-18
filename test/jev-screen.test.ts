/**
 * #1046: screening every original outbound string, with the native rules.
 *
 * The detector is not reimplemented here — `scanForSecrets` is the one
 * `validate` runs. What this file pins is the *surface* it is applied to, and
 * the one behaviour that differs from the commit-message scanner: a `#` comment
 * line and everything below `commit -v` scissors are skipped for a commit
 * message, correctly, because git strips them — and must not be skipped for a
 * string that is about to leave the machine.
 *
 * Every value below is synthetic, generated for this test, and was never issued
 * as a credential. They are shaped to clear the deliberate placeholder
 * suppressors in `hooks/secret-rules.ts`.
 */

import { describe, expect, it } from 'vitest';

import { scanForSecrets } from '../src/core/secret-guard.js';
import { describeWithheld, isSafeToSend, screenText, screenUnits } from '../src/jev/screen.js';

const AWS = 'AKIA29326ML64LG2TJF8';
const GITHUB = 'ghp_u8jzPde0IgxLd6GncfBAepfJBd0Kh8oOL8dK';

describe('#1046 the outbound surface', () => {
  it('finds what the native scanner finds in ordinary text', () => {
    // The premise. Without it, everything below could describe a screen that
    // never fires.
    expect(screenText(`rotate ${AWS} today`).length).toBeGreaterThan(0);
    expect(isSafeToSend('the retry ceiling stays at three attempts')).toBe(true);
  }, 300_000);

  it('screens a `#` comment line the commit scanner drops', () => {
    // Git strips it, so a finding there is a finding about text that will never
    // exist in the repository — and an outbound request carries the string as
    // given.
    const text = `# leftover: ${AWS}\nthe ceiling stays at three`;
    expect(scanForSecrets(text), 'the native default should skip this line').toHaveLength(0);
    expect(screenText(text).length).toBeGreaterThan(0);
  }, 300_000);

  it('screens below `commit -v` scissors, where the pasted diff lives', () => {
    const text = [
      'a message',
      '# ------------------------ >8 ------------------------',
      `+const token = "${GITHUB}";`,
    ].join('\n');
    expect(scanForSecrets(text)).toHaveLength(0);
    expect(screenText(text).length).toBeGreaterThan(0);
  }, 300_000);

  it('screens the original string, not its JSON-escaped form', () => {
    // Escaping can break a rule's `\\b` boundaries, so screening the serialized
    // body would be a check that passes because the input changed shape.
    const original = `path C:\\keys\\aws.txt holds ${AWS}`;
    expect(screenText(original).length).toBeGreaterThan(0);
    // And the same content inside a JSON string is what would have been sent.
    expect(screenText(JSON.stringify({ state: original })).length).toBeGreaterThan(0);
  }, 300_000);
});

describe('#1046 withholding, not masking', () => {
  it('drops the unsafe unit and keeps the rest', () => {
    // A masked string is a different string: sending `AKIA…` in place of a
    // credential and then recording a decision as though the original passage
    // had been assessed attributes a judgement to text nobody saw.
    const units = [
      { id: 'a', text: `rotate ${AWS} before release` },
      { id: 'b', text: 'the vendor caps us at three retries per minute' },
    ];
    const result = screenUnits(units, (unit) => unit.text);

    expect(result.safe.map((unit) => unit.id)).toEqual(['b']);
    expect(result.withheld.map((entry) => entry.unit.id)).toEqual(['a']);
    // Nothing that leaves here carries the value, masked or otherwise.
    expect(JSON.stringify(result.safe)).not.toContain(AWS);
  }, 300_000);

  it('describes withheld units by rule, never by value', () => {
    const result = screenUnits([{ text: `rotate ${AWS}` }], (unit) => unit.text);
    const said = describeWithheld(result.withheld);
    expect(said).not.toBeNull();
    expect(said).toContain('withheld');
    expect(said).not.toContain(AWS);
    // Not even the scanner's own masked excerpt: a diagnostic in `.git` gets
    // pasted into issue reports, so it carries the shape and no part of the
    // value.
    expect(said).not.toContain('AKIA');
  }, 300_000);

  it('says nothing when nothing was withheld', () => {
    const result = screenUnits([{ text: 'the ceiling stays at three' }], (unit) => unit.text);
    expect(describeWithheld(result.withheld)).toBeNull();
  }, 300_000);
});

describe('#1046 the native default is unchanged', () => {
  it('leaves `scanForSecrets` behaving exactly as before for every existing caller', () => {
    // The option defaults to off. `validate`'s report must not start naming
    // findings in text git is about to discard, which would be a new class of
    // refused commit for no new risk.
    const message = `a message\n# note: ${AWS}\n`;
    expect(scanForSecrets(message)).toHaveLength(0);
    expect(scanForSecrets(message, { minConfidence: 'high' })).toHaveLength(0);
    expect(scanForSecrets(message, { includeIgnoredLines: true }).length).toBeGreaterThan(0);
  }, 300_000);

  it('still reports the line number of the original text', () => {
    const findings = screenText(`one\n# two ${AWS}\nthree`);
    expect(findings[0]?.line).toBe(2);
  }, 300_000);

  it('reports a masked excerpt and never the match', () => {
    const findings = screenText(`rotate ${AWS}`);
    expect(findings[0]?.redacted).toBe('AKIA…');
    expect(JSON.stringify(findings)).not.toContain(AWS);
  }, 300_000);
});
