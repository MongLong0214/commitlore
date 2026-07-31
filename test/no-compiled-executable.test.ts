/**
 * T-1125 / #284. ADR-0026 makes plugin-first distribution with Node-only install
 * scripts the single source of truth: this project builds and ships no compiled
 * executable. This is the repository-wide invariant that keeps it that way, so a
 * later change cannot quietly reintroduce a build step, an asset download, or a
 * classification arm for a compiled artifact.
 *
 * The check runs against tracked files, not the working tree, so an untracked
 * experiment does not fail the suite and a committed one cannot hide.
 *
 * Deliberately not asserted here: history. `CHANGELOG.md`, `ADR-0015` and the
 * superseded ticket text describe a decision this project once made and then
 * reversed, and a record of a reversal is the product's own subject matter.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

const trackedFiles = (): string[] =>
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n')
    .filter((path) => path !== '');

/** Files whose subject is the reversal itself, or generated output of `src/`. */
const isHistoryOrGenerated = (path: string): boolean =>
  path === 'CHANGELOG.md' ||
  // A handoff record describing what an already-published release did. The
  // release history is true and stays; what it must not do is describe the
  // current plan, which is why the paragraph claiming the binary code was still
  // present had to change in this same commit.
  path === 'HANDOFF.md' ||
  path.startsWith('dist/') ||
  path.startsWith('bench/results/') ||
  path === 'docs/adr/ADR-0015-single-executable-binary.md' ||
  path === 'docs/adr/ADR-0026-node-only-distribution.md' ||
  path === 'docs/adr/ADR-0011-plugin-first-distribution.md' ||
  path === 'docs/prd/PRD-F14-distribution.md' ||
  path === 'docs/tickets/F14-distribution.md' ||
  path === 'package-lock.json' ||
  path === 'test/no-compiled-executable.test.ts';

const candidates = (): string[] => trackedFiles().filter((path) => !isHistoryOrGenerated(path));

const read = (path: string): string => {
  try {
    return readFileSync(join(ROOT, path), 'utf8');
  } catch {
    return '';
  }
};

/** Every tracked file that still mentions a pattern, with the line for context. */
/**
 * A line that names one of these strings in order to forbid it is evidence for
 * this invariant, not against it -- `test/install-script.test.ts` and the CI
 * `install-script` job both keep such a list. They are recognized by the word
 * they use to say so rather than by an allowlist of files, so a new absence check
 * elsewhere does not have to be registered here to be understood.
 */
const assertsAbsence = (line: string): boolean =>
  /forbidden|not\.toMatch|must not|never/i.test(line);

const offenders = (pattern: RegExp): string[] => {
  const found: string[] = [];
  for (const path of candidates()) {
    for (const [index, line] of read(path).split('\n').entries()) {
      if (!pattern.test(line) || assertsAbsence(line)) continue;
      found.push(`${path}:${index + 1}: ${line.trim()}`);
    }
  }
  return found;
};

describe('T-1125 nothing tracked builds, ships or classifies a compiled executable', () => {
  it('declares no binary build script', () => {
    expect(offenders(/build:binary|build-binary\.mjs/)).toEqual([]);
  });

  it('calls no single-executable tooling', () => {
    expect(offenders(/postject|--experimental-sea-config|sea-config\.json/)).toEqual([]);
  });

  it('publishes and verifies no platform asset', () => {
    expect(offenders(/SHA256SUMS/)).toEqual([]);
  });

  it('downloads no release asset in an installer', () => {
    for (const installer of ['install.sh']) {
      expect(read(installer)).not.toMatch(/releases\/download/);
    }
  });

  it('classifies no path as a compiled commitlore binary', () => {
    // The stub and its TypeScript counterpart must agree that an extensionless
    // `commitlore` is not something to run: it is the wrapper's own name, and a
    // wrapper is a shell script that execs node, not an interpreter itself.
    expect(read('src/core/hook-target.ts')).not.toMatch(/'binary'|"binary"/);
    expect(offenders(/\*\/commitlore\||\|commitlore\)/)).toEqual([]);
  });

  it('keeps the install-root containment the compiled arm used to share', () => {
    // The stop condition of this ticket: removing the binary arm must not remove
    // #71's containment for the path that ships.
    const source = read('src/core/hook-target.ts');
    expect(source).toMatch(/isInsidePackage/);
    expect(source).toMatch(/commitlore\.bin is outside this package root/);
  });
});
