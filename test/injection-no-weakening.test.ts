/**
 * #941: nothing asked whether a release had weakened the scanner, and 1.2.17
 * shipped three phrasings served that 1.2.16 blocked, with every required
 * context green.
 *
 * Three answers were tried and each failed the same way -- the corpus was
 * supplied by a person, so it held only what a person had thought of:
 *
 *   fixtures            pin phrasings someone wrote; a narrowing releases the
 *                       ones nobody wrote, or its author would have seen it
 *   this repository     every record in it is benign, so a narrowing that
 *                       releases an attack shows up as no change at all
 *   a cross product     generated from the implementation, so it shrinks with
 *   over the vocabulary the list it reads -- measured: reinstating 1.2.17's
 *                       two-word agent list produced 505 cases instead of 733
 *                       and every one passed
 *
 * The corpus does not have to come from a person. A pattern is a specification
 * of what it catches, and its alternations enumerate that specification: the
 * table generates its own adversarial set. Coverage of every pattern is
 * guaranteed by an invariant that already exists -- `grade.test.ts` reports a
 * pattern with no fixture as an orphan -- so the fixtures seed what the
 * expander cannot reach.
 *
 * The artifact is one direction only. A narrowing exists to release false
 * positives, so "this no longer blocks" is not a fault in itself; it is a fault
 * to release something *without noticing*. `injection-blocked.json` records what
 * blocks today, the test fails when an entry stops blocking, and regenerating it
 * is a deliberate act whose diff is exactly the list of phrasings a change let
 * go. That is the review this release did not get.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AGENT_SUBJECT,
  INJECTION_PATTERNS,
  IRREALIS,
  MENTIONS,
  NEGATIONS,
  scanInjection,
} from '../src/core/grade.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FIXTURES = join(ROOT, 'spec/fixtures/injection');
/*
 * Under `test/`, not `spec/`. `package.json` ships `spec` to every install, and
 * this is a regression baseline for one implementation rather than part of the
 * protocol: the conformance fixtures beside it are the spec, this is not. 80 KB
 * in every published package for an artifact no consumer reads.
 */
const SNAPSHOT = join(ROOT, 'test/injection-blocked.json');

/** Every alternative of every group at least once, rather than every combination. */
const eachChoice = (pattern: RegExp): string[] => {
  const body = String(pattern)
    .replace(/^\/|\/[a-z]*$/g, '')
    .replace(/\(\?<[=!][^)]*\)/g, '')
    .replace(/\(\?![^)]*\)/g, '')
    .replace(/\[\^[^\]]*\]\{\d+,\d+\}\??/g, ' ')
    .replace(/\[\^[^\]]*\]\*\??/g, ' ')
    .replace(/\\s[+*]/g, ' ')
    .replace(/\\s/g, ' ')
    .replace(/\\b/g, '')
    .replace(/\\([/.\-])/g, '$1');

  const groups: { start: number; end: number; alts: string[] }[] = [];
  const re = /\((?:\?:)?([^()]*)\)\??/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    groups.push({ start: m.index, end: m.index + m[0].length, alts: (m[1] ?? '').split('|') });
  }
  if (groups.length === 0) return [body.replace(/\s+/g, ' ').trim()].filter((s) => s !== '');

  const widest = Math.max(...groups.map((g) => g.alts.length));
  const out = new Set<string>();
  for (let k = 0; k < widest; k += 1) {
    let s = '';
    let at = 0;
    for (const g of groups) {
      s += body.slice(at, g.start) + (g.alts[Math.min(k, g.alts.length - 1)] ?? '');
      at = g.end;
    }
    out.add((s + body.slice(at)).replace(/\s+/g, ' ').trim());
  }
  return [...out].filter((s) => s !== '');
};

/**
 * The `Warn:` line of every malicious fixture, which `grade.test.ts` guarantees
 * covers every pattern id. This is what keeps a pattern the expander cannot
 * reach — nested groups, a negative lookahead — from being silently uncovered.
 */
const fixtureSeeds = (): string[] =>
  readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.txt') && !name.startsWith('n'))
    .flatMap((name) => {
      const body = readFileSync(join(FIXTURES, name), 'utf8');
      return body
        .split('\n')
        .filter((line) => /^(?:Warn|Limit|Ruled-out|Verified):/.test(line))
        .map((line) => line.slice(line.indexOf(':') + 1).trim());
    });

/** A phrase wrapped in the frames a disarm rule reads, none of which may release it. */
const framed = (phrase: string): string[] => [
  phrase,
  ...[...IRREALIS].flatMap((modal) =>
    [...AGENT_SUBJECT].slice(0, 6).map((subject) => `${subject} ${modal} ${phrase}`),
  ),
  ...[...NEGATIONS].slice(0, 4).map((word) => `${word} the above, ${phrase}`),
  ...[...MENTIONS].slice(0, 4).map((word) => `it ${word} the above. ${phrase}`),
];

/**
 * Regex residue is dropped rather than kept.
 *
 * A nested group or a character class the expander cannot flatten leaves source
 * fragments in the string -- `)apply the below`, `enter a [a-z-]+ command
 * prompt`. Those still block, so they would work as guards, but the artifact is
 * read as a diff by a person deciding whether a release let something go, and a
 * line of pattern source tells that person nothing. 1,170 of 2,415 entries were
 * this before the filter. What is lost is coverage the fixture seeds already
 * carry, since `grade.test.ts` guarantees a fixture per pattern id and the
 * coverage case below fails if any pattern falls out.
 */
const READABLE = /^[\p{L}\p{N} ,.:;'"$/@_#!?-]+$/u;

const corpus = (): string[] => {
  // The filter applies to what the expander produced, never to a fixture: a
  // fixture is prose someone wrote, and dropping one for holding a pipe or a
  // bracket removed three patterns from the corpus entirely. The coverage case
  // below is what caught that.
  const generated = INJECTION_PATTERNS.flatMap((p) => eachChoice(p.pattern)).filter((s) =>
    READABLE.test(s),
  );
  const seeds = new Set<string>([...generated, ...fixtureSeeds()]);
  return [...new Set([...seeds].flatMap(framed))].sort();
};

const blockingSet = (): string[] => corpus().filter((s) => scanInjection(s).length > 0);

describe('#941 a release does not weaken the scanner unnoticed', () => {
  const blocking = blockingSet();

  /*
   * Regenerating is deliberate: `UPDATE_INJECTION_SNAPSHOT=1 npx vitest run
   * test/injection-no-weakening.test.ts`. The diff it produces is the list of
   * phrasings the change let go, which is the artifact this whole file exists
   * to put in front of a reviewer.
   */
  if (process.env['UPDATE_INJECTION_SNAPSHOT'] === '1') {
    writeFileSync(SNAPSHOT, `${JSON.stringify(blocking, null, 2)}\n`);
  }

  it('has a snapshot to compare against', () => {
    expect(
      existsSync(SNAPSHOT),
      'run UPDATE_INJECTION_SNAPSHOT=1 once to record what blocks today',
    ).toBe(true);
  });

  it('still blocks everything the recorded snapshot blocked', () => {
    const recorded: string[] = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
    const now = new Set(blocking);
    const released = recorded.filter((s) => !now.has(s));
    expect(
      released,
      `${String(released.length)} phrasing(s) blocked before this change and do not now. ` +
        'If that is intended, regenerate the snapshot and let the diff show what was released.',
    ).toEqual([]);
  });

  /*
   * Guards on the generator, because a corpus that quietly emptied would make
   * every assertion above pass while testing nothing -- the failure mode this
   * file was written to end, arriving one level up.
   */
  it('covers every pattern in the table', () => {
    const seen = new Set(blocking.flatMap((s) => scanInjection(s)));
    const missing = INJECTION_PATTERNS.filter((p) => !seen.has(p.id)).map((p) => p.id);
    expect(missing, 'a pattern with no case in the corpus is a pattern this cannot protect').toEqual(
      [],
    );
  });

  it('generates a corpus large enough to mean something', () => {
    expect(blocking.length).toBeGreaterThan(200);
  });

  /*
   * The snapshot is a released-file artifact like `installer/canonical-artifact.json`:
   * committed, regenerated on purpose, reviewed as a diff. A stale one that
   * nobody regenerates is still useful -- it only ever gets stricter.
   */
  it('is recorded in the repository rather than derived at read time', () => {
    const tracked = execFileSync('git', ['ls-files', '--error-unmatch', SNAPSHOT], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(tracked.trim()).not.toBe('');
  });
});
