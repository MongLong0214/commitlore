/**
 * Loader for `spec/fixtures/`. Fixtures are discovered from disk, never
 * enumerated in code — a new fixture must be covered by every suite the moment
 * it is added, without touching a test.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Trailer, Violation } from '../src/core/types.js';

export type FixtureKind = 'valid' | 'boundary' | 'invalid';

export const FIXTURE_KINDS: FixtureKind[] = ['valid', 'boundary', 'invalid'];

/** Kinds whose `expected.json` carries a `canonical` block (SPEC §2.3). */
export const CANONICAL_KINDS: FixtureKind[] = ['valid', 'boundary'];

export interface FixtureExpectation {
  description?: string;
  trailers: Trailer[];
  canonical?: string;
  violations?: Violation[];
}

export interface Fixture {
  kind: FixtureKind;
  /** Basename without the `.txt`, e.g. `b3-prose-with-colon-line`. */
  name: string;
  /** `valid/01-minimal` — used as the test title. */
  id: string;
  txtPath: string;
  jsonPath: string;
  message: string;
  expected: FixtureExpectation;
}

const FIXTURE_ROOT = fileURLToPath(new URL('../spec/fixtures/', import.meta.url));

export const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));

export const loadFixtures = (kind: FixtureKind): Fixture[] => {
  const dir = join(FIXTURE_ROOT, kind);
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.txt'))
    .sort()
    .map((entry) => {
      const name = entry.slice(0, -'.txt'.length);
      const txtPath = join(dir, entry);
      const jsonPath = join(dir, `${name}.expected.json`);
      return {
        kind,
        name,
        id: `${kind}/${name}`,
        txtPath,
        jsonPath,
        message: readFileSync(txtPath, 'utf8'),
        expected: JSON.parse(readFileSync(jsonPath, 'utf8')) as FixtureExpectation,
      };
    });
};

export const loadAllFixtures = (): Fixture[] => FIXTURE_KINDS.flatMap(loadFixtures);

export const loadCanonicalFixtures = (): Fixture[] => CANONICAL_KINDS.flatMap(loadFixtures);

/** Every file under `src/`, recursively, as `[relativePath, contents]`. */
export const readSourceFiles = (): [string, string][] => {
  const walk = (dir: string, prefix: string): [string, string][] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const child = join(dir, entry.name);
      const label = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) return walk(child, label);
      if (!entry.isFile()) return [];
      return [[label, readFileSync(child, 'utf8')] satisfies [string, string]];
    });
  return walk(SRC_ROOT, '');
};
