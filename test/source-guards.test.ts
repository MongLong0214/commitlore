/**
 * T-201 acceptance criterion: trailer boundaries are decided by git, never by
 * this codebase. `git log --grep` matches commit *text*, so a `--grep`-based
 * lookup re-implements the line matching SPEC §2.1 B3 exists to forbid.
 */

import { describe, expect, it } from 'vitest';

import { readSourceFiles } from './fixtures.js';

const sources = readSourceFiles();

describe('source guards', () => {
  it('reads the source tree', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it('contains no --grep anywhere under src/', () => {
    const offenders = sources
      .filter(([, contents]) => contents.includes('--grep'))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('parses trailers by delegating to git interpret-trailers', () => {
    const trailersSource = sources.find(([path]) => path === 'core/trailers.ts');
    expect(trailersSource).toBeDefined();
    expect(trailersSource?.[1]).toContain('interpret-trailers');
  });

  it('spawns git without a shell', () => {
    const gitSource = sources.find(([path]) => path === 'core/git.ts');
    expect(gitSource?.[1]).toContain('shell: false');
    expect(gitSource?.[1]).not.toMatch(/shell:\s*true/);
  });
});
