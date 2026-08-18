/**
 * The README's top visual, as a contract rather than a habit.
 *
 * Two SVGs used to sit above the fold in incompatible art directions — a warm
 * editorial diagram and an animated dark terminal recording — so the first
 * screen read as two templates rather than one product. The recording is
 * retired and the hero replaced; these assertions are what stops either from
 * coming back by accident.
 *
 * They deliberately assert on the source rather than on a render. Nothing here
 * can tell you whether the diagram is legible, and one measurement says it is
 * marginal: the README embeds at `width="100%"`, so a 375px viewport scales the
 * 840px canvas by 0.446 and the 18px labels land near 8px. That is better than
 * the 1200px canvas it replaces (7.5px) and still under the 12px a caption
 * usually needs. It is recorded here because a number nobody wrote down is a
 * number nobody rechecks.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HERO = join(REPO_ROOT, 'assets', 'readme', 'hero.svg');
const READMES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md'];

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');
const hero = (): string => readFileSync(HERO, 'utf8');

describe('the README carries one visual', () => {
  it.each(READMES)('%s references the hero exactly once', (file) => {
    const matches = read(file).match(/assets\/readme\/hero\.svg/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it.each(READMES)('%s references no retired demo recording', (file) => {
    // The generator and the asset are gone; a reference left in one translation
    // would be a broken image in that language only, which is exactly the kind
    // of thing four hand-maintained files lose track of.
    expect(read(file)).not.toContain('commitlore-demo');
  });

  it.each(READMES)('%s has no second full-width visual before the install command', (file) => {
    const body = read(file);
    const install = body.indexOf('install.sh');
    expect(install, 'no install command found — the anchor for this check moved').toBeGreaterThan(0);
    const localImages = (body.slice(0, install).match(/<img[^>]*src="\.\//g) ?? []).length;
    expect(localImages).toBe(1);
  });
});

describe('the hero claims only what the product does', () => {
  // The alt has two contracts pulling opposite ways, and they collided once.
  //
  // `readme-positioning.test.ts` requires decision-authority framing in the
  // hero (ADR-0022), and the phrasings it accepts include absolute ones —
  // "must not revive", "되살려서는 안", "不得复活". The alt used to satisfy it
  // with exactly that, so removing the absolute claim removed the positioning
  // with it, in all four languages at once.
  //
  // The resolution is the non-absolute alternative each language already
  // allows: "decision authority", "결정 권위", "意思決定の権威", "决策权威".
  // An alt rewritten without one of those passes here and fails there.
  // The retired recording ended on "the agent cannot revive it", and the hero's
  // own alt text said the agent "must not revive" a reversed decision. Neither
  // is true: CommitLore does not deliver a superseded record as current
  // guidance, and it does not stop an agent from thinking of the same idea.
  const FORBIDDEN = ['must not', 'cannot revive', 'prevents', 'blocks the', 'never repeats'];

  it.each(READMES)('%s hero alt makes no absolute claim', (file) => {
    const alt = /<img src="\.\/assets\/readme\/hero\.svg"[^>]*alt="([^"]*)"/.exec(read(file))?.[1];
    expect(alt, 'hero image or its alt is missing').toBeTruthy();
    for (const phrase of FORBIDDEN) expect(alt!.toLowerCase()).not.toContain(phrase);
  });

  it('everything the hero says to a reader makes no absolute claim', () => {
    // Rendered text plus the accessible name and description — what actually
    // reaches somebody. Source comments are excluded on purpose: the first
    // version of this test failed on a comment quoting the design rule it was
    // implementing, which is a rule about the diagram rather than a claim about
    // the product.
    const source = hero().replace(/<!--[\s\S]*?-->/g, '');
    const spoken = [
      ...[...source.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]),
      ...[...source.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g)].map((m) => m[1]),
      ...[...source.matchAll(/<desc[^>]*>([\s\S]*?)<\/desc>/g)].map((m) => m[1]),
    ]
      .join(' ')
      .toLowerCase();
    expect(spoken, 'nothing readable found in the hero').not.toBe('');
    for (const phrase of FORBIDDEN) expect(spoken).not.toContain(phrase);
  });
});

describe('the hero is static and self-contained', () => {
  it('carries no animation, script, or embedded document', () => {
    const source = hero();
    for (const tag of ['<animate', '<animateTransform', '<set ', '<script', '<foreignObject', '<image']) {
      expect(source, `${tag} is not allowed in a static hero`).not.toContain(tag);
    }
  });

  it('fetches nothing at render time', () => {
    const source = hero();
    // The xmlns declaration is a namespace name, not a request, so it is the
    // one permitted occurrence of a URL.
    expect(source.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/\bhref\s*=|url\(/);
  });

  it('declares no font smaller than 18px', () => {
    const sizes = [...hero().matchAll(/font-size:?\s*"?(\d+)/g)].map((m) => Number(m[1]));
    expect(sizes.length, 'no font sizes found — the parse shape changed').toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(18);
  });

  it('stays a diagram rather than a paragraph', () => {
    // A hero that has to be read is slower than the Markdown under it, which is
    // what the previous one got wrong.
    const rendered = [...hero().matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, ' '))
      .join(' ');
    const words = rendered.trim().split(/\s+/).filter(Boolean);
    expect(words.length).toBeLessThanOrEqual(45);
  });
});

describe('the hero is reachable without sight and without colour', () => {
  it('names and describes itself', () => {
    const source = hero();
    expect(source).toContain('role="img"');
    expect(source).toMatch(/aria-labelledby="[^"]+"/);
    expect(source).toMatch(/<title id="[^"]+">/);
    expect(source).toMatch(/<desc id="[^"]+">/);
  });

  it('distinguishes the two states by more than colour', () => {
    // Grey and green alone would be invisible to a reader who cannot separate
    // them. Each state carries a word as well, and the superseded path carries
    // a dash pattern the active one does not.
    const source = hero();
    expect(source).toContain('>ACTIVE<');
    expect(source).toContain('>SUPERSEDED<');
    expect(source).toMatch(/stroke-dasharray/);
  });

  it('does not show a ruled-out alternative as filtered out', () => {
    // The first screen taught the product backwards for one draft. "Reuse for
    // admin quotes" went in the SUPERSEDED row, stopped by a dashed connector
    // and an X — but README:177-181 shows it as the `Ruled-out:` trailer on
    // `r-price01`, the record that is still in force. It is *delivered*, and
    // delivering it is the point: it is how an agent learns the reuse was
    // already considered and rejected.
    //
    // So the superseded row is an earlier Limit that a later one replaced, and
    // the ruled-out line belongs in the panel that reaches the next edit.
    const source = hero();
    const supersededBlock = source.slice(
      source.indexOf('>SUPERSEDED<'),
      source.indexOf('<rect x="292"'),
    );
    expect(supersededBlock, 'a ruled-out alternative is being shown as filtered out').not.toMatch(
      /Reuse for/,
    );
    // And it is still present where it belongs.
    expect(source).toMatch(/>Ruled out</);
    expect(source).toMatch(/>Admin quote reuse</);
  });

  it('reads the active decision before the superseded one', () => {
    // Vertical order is the eye's order, and the row that still applies is the
    // one worth seeing first. The hero this replaced had it this way; an
    // earlier draft of this one did not.
    const source = hero();
    const y = (label: string): number => {
      const m = new RegExp(`<text[^>]*y="(\\d+)"[^>]*>${label}<`).exec(source);
      expect(m, `${label} not found with a y coordinate`).toBeTruthy();
      return Number(m![1]);
    };
    expect(y('ACTIVE')).toBeLessThan(y('SUPERSEDED'));
  });
});
