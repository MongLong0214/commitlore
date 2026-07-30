import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..');

/**
 * Repository-wide invariant: every tracked file under scripts/ that derives a
 * filesystem path from import.meta.url must use fileURLToPath, never .pathname.
 *
 * ADR-0023: .pathname doubles the drive letter on Windows (C:/C:/…). The
 * reference pattern is scripts/check-release-version.mjs line 37.
 */
describe('scripts path resolution', () => {
  const trackedFiles = execFileSync(
    'git',
    ['ls-files', '--', 'scripts/'],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((f) => f.length > 0);

  it('no script uses new URL(…).pathname for a filesystem path', () => {
    const offenders: string[] = [];
    for (const rel of trackedFiles) {
      const src = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
      if (/new\s+URL\([^)]*,\s*import\.meta\.url\)\.pathname/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  const TARGET_FILES = [
    'scripts/adoption-range.mjs',
    'scripts/build-binary.mjs',
    'scripts/check-test-files-ran.mjs',
    'scripts/check-engines.mjs',
  ];

  for (const file of TARGET_FILES) {
    it(`${file} uses fileURLToPath`, () => {
      const src = readFileSync(resolve(REPO_ROOT, file), 'utf8');
      expect(src).toContain('fileURLToPath');
    });
  }
});
