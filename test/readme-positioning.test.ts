import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const READMES = [
  { file: 'README.md', lang: 'English' },
  { file: 'README.ko.md', lang: 'Korean' },
  { file: 'README.ja.md', lang: 'Japanese' },
  { file: 'README.zh-CN.md', lang: 'Chinese' },
] as const;

/**
 * Extract the hero section: everything from the start of the file to the line
 * that begins the first `##` heading after the `# CommitLore` title heading.
 * This captures: HTML badges, title, subtitle heading, and opening paragraphs.
 */
function extractHero(markdown: string): string {
  const lines = markdown.split('\n');
  let inTitle = false;
  let heroEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('# CommitLore')) {
      inTitle = true;
      continue;
    }
    // The first ## after the title that is NOT the tagline/subtitle
    // We consider the hero to extend up to (but not including) the section
    // that starts the measurement/retrieval section or local-first section.
    if (inTitle && lines[i].startsWith('## ') && i > 0) {
      // Keep the first ## (it's the tagline). Stop at the second ##.
      const prevH2 = lines.slice(0, i).filter((l) => l.startsWith('## ')).length;
      if (prevH2 >= 1) {
        heroEnd = i;
        break;
      }
    }
  }
  return lines.slice(0, heroEnd).join('\n');
}

/** Forbidden effect-claim phrases per ADR-0013. Case-insensitive match. */
const FORBIDDEN_EFFECT_CLAIMS = [
  'prevents mistakes',
  'saves cost',
  'writes better code',
  'fewer bugs',
  'reduces re-proposals',
  'improves code quality',
  'reduces errors',
];

describe('README positioning (ADR-0022)', () => {
  const heroes = READMES.map(({ file, lang }) => {
    const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    return { file, lang, hero: extractHero(content), content };
  });

  it('English hero contains decision-authority positioning language', () => {
    const en = heroes.find((h) => h.lang === 'English')!;
    // Must contain some form of "decision authority" or the reversal framing
    const hasAuthority =
      /decision\s+authority/i.test(en.hero) ||
      /must not revive/i.test(en.hero) ||
      /already reversed/i.test(en.hero);
    expect(hasAuthority).toBe(true);
  });

  it('English hero does not lead with "decision memory" as primary framing', () => {
    const en = heroes.find((h) => h.lang === 'English')!;
    // "Git-native decision memory" should no longer be the bolded leading phrase
    expect(en.hero).not.toMatch(/\*\*Git-native decision memory/);
  });

  it('Korean hero contains decision-authority positioning', () => {
    const ko = heroes.find((h) => h.lang === 'Korean')!;
    // Korean equivalents of the authority framing
    const hasAuthority =
      /결정\s*권위/i.test(ko.hero) ||
      /의사결정\s*권위/i.test(ko.hero) ||
      /되살려서는 안/i.test(ko.hero) ||
      /되살리지 않/i.test(ko.hero) ||
      /이미 뒤집/i.test(ko.hero) ||
      /뒤집힌 결정.*되살/i.test(ko.hero);
    expect(hasAuthority).toBe(true);
  });

  it('Japanese hero contains decision-authority positioning', () => {
    const ja = heroes.find((h) => h.lang === 'Japanese')!;
    const hasAuthority =
      /意思決定の権威/i.test(ja.hero) ||
      /決定権威/i.test(ja.hero) ||
      /覆された決定.*蘇らせ/i.test(ja.hero) ||
      /覆した決定/i.test(ja.hero) ||
      /蘇らせてはならない/i.test(ja.hero) ||
      /復活させてはならない/i.test(ja.hero);
    expect(hasAuthority).toBe(true);
  });

  it('Chinese hero contains decision-authority positioning', () => {
    const zh = heroes.find((h) => h.lang === 'Chinese')!;
    const hasAuthority =
      /决策权威/i.test(zh.hero) ||
      /决定权威/i.test(zh.hero) ||
      /不得复活/i.test(zh.hero) ||
      /已经推翻.*不/i.test(zh.hero) ||
      /推翻的决策.*复活/i.test(zh.hero) ||
      /已推翻/i.test(zh.hero);
    expect(hasAuthority).toBe(true);
  });

  it('no forbidden effect claims appear in any hero section', () => {
    for (const { file, hero } of heroes) {
      for (const claim of FORBIDDEN_EFFECT_CLAIMS) {
        expect(hero.toLowerCase(), `${file} contains forbidden claim "${claim}"`).not.toContain(
          claim.toLowerCase(),
        );
      }
    }
  });

  it('no README carries the generated block', () => {
    // It was in all four and regenerated against the logs in one:
    // `check-readme-numbers.mjs` took `readmes[0]` and stopped. `docs/evidence.md`
    // owns it now, and a README that grows one again is a second copy of a
    // generated artifact — which is the thing the move removed.
    for (const hero of heroes) {
      expect(
        hero.content,
        `${hero.lang} README carries a second copy of the generated block`,
      ).not.toContain('<!-- BENCH:BEGIN -->');
    }
  });
});
