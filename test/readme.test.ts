/**
 * T-1031 (#211): README install one-liner and pin correction.
 *
 * Why this is NOT in test/readme-numbers.test.ts:
 * That file tests the BENCH block byte-regeneration logic (the benchmark
 * publication mechanism). This file tests install URLs and version pins —
 * a separate concern (supply-chain correctness vs benchmark reproducibility).
 * Mixing them would couple two independent failure modes.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const README_FILES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md'] as const;
const PACKAGE_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
).version;

describe('README install one-liner and version pin', () => {
  for (const file of README_FILES) {
    describe(file, () => {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const lines = content.split('\n');

      it('one-liner does not reference dev branch', () => {
        // Find the install one-liner (the curl | sh line)
        const oneLiner = lines.find(
          (l) => l.includes('curl') && l.includes('install.sh | sh'),
        );
        expect(oneLiner).toBeDefined();
        expect(oneLiner).not.toContain('/dev/');
      });

      it('one-liner references a semver tag', () => {
        const oneLiner = lines.find(
          (l) => l.includes('curl') && l.includes('install.sh | sh'),
        );
        expect(oneLiner).toBeDefined();
        expect(oneLiner).toMatch(/\/v\d+\.\d+\.\d+\//);
      });

      it('pinned version matches package.json', () => {
        // The pinned install examples reference a specific version.
        // Find lines with "sh install.sh v" pattern — the pinned invocation.
        const pinLine = lines.find((l) => /sh install\.sh v\d/.test(l));
        expect(pinLine).toBeDefined();
        const pinMatch = pinLine!.match(/v(\d+\.\d+\.\d+)/);
        expect(pinMatch).not.toBeNull();
        expect(pinMatch![1]).toBe(PACKAGE_VERSION);

        // Also check the version= assignment line
        const versionAssign = lines.find((l) => /^version=\d+\.\d+\.\d+/.test(l));
        expect(versionAssign).toBeDefined();
        const assignMatch = versionAssign!.match(/version=(\d+\.\d+\.\d+)/);
        expect(assignMatch).not.toBeNull();
        expect(assignMatch![1]).toBe(PACKAGE_VERSION);

        // Also check the pinned curl download URL
        const pinnedCurl = lines.find(
          (l) => l.includes('curl') && l.includes('fsSLO') && l.includes('install.sh'),
        );
        expect(pinnedCurl).toBeDefined();
        const urlMatch = pinnedCurl!.match(/\/v(\d+\.\d+\.\d+)\//);
        expect(urlMatch).not.toBeNull();
        expect(urlMatch![1]).toBe(PACKAGE_VERSION);
      });
    });
  }
});
