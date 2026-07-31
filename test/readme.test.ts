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

        // T-1120: the `version=<semver>; target=<triple>` line this used to assert
        // belonged to the release-asset download example, and ADR-0026 removed
        // compiled artifacts from the product. The pinned example is now a source
        // checkout, so that is what carries the pin.
        const clonePin = lines.find((l) => l.includes('git clone') && l.includes('--branch v'));
        expect(clonePin).toBeDefined();
        const cloneMatch = clonePin!.match(/--branch v(\d+\.\d+\.\d+)/);
        expect(cloneMatch).not.toBeNull();
        expect(cloneMatch![1]).toBe(PACKAGE_VERSION);

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

describe('T-1021: Known limitations discloses guard precision and recall', () => {
  for (const file of README_FILES) {
    describe(file, () => {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

      // Extract the Known limitations section (between its heading and the next ## heading)
      const knownLimStart = content.search(/^## (Known limitations|알려진 제한 사항|既知の制限事項|已知限制)/m);
      const afterStart = content.slice(knownLimStart + 1);
      const nextSection = afterStart.search(/^## /m);
      const knownLimSection = nextSection === -1
        ? afterStart
        : afterStart.slice(0, nextSection);

      it('mentions guard precision 44.8%', () => {
        expect(knownLimSection).toMatch(/precision 44\.8%/i);
      });

      it('mentions guard recall 22.0%', () => {
        expect(knownLimSection).toMatch(/recall 22\.0%/i);
      });

      it('includes the Wilson confidence interval (32.7%–57.5%)', () => {
        // The interval must accompany the precision figure
        expect(knownLimSection).toMatch(/32\.7%/);
        expect(knownLimSection).toMatch(/57\.5%/);
      });
    });
  }
});

/**
 * Mutation oracles: prove the T-1021 assertions have teeth.
 *
 * Oracle-FAIL tests: mutated content MUST fail the regex assertions.
 * Oracle-PASS test: irrelevant mutation (changing a different bullet) MUST NOT
 * cause a T-1021 failure.
 */
describe('T-1021 mutation oracles', () => {
  const enContent = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

  // Extract the Known limitations section for English
  const knownLimStart = enContent.search(/^## Known limitations/m);
  const afterStart = enContent.slice(knownLimStart + 1);
  const nextSection = afterStart.search(/^## /m);
  const knownLimSection = nextSection === -1 ? afterStart : afterStart.slice(0, nextSection);

  it('oracle-FAIL: dropping the interval makes the interval assertion fail', () => {
    // Simulate removing the Wilson CI from the section
    const mutated = knownLimSection.replace(/\(95% Wilson CI 32\.7%–57\.5%\)/, '');
    expect(mutated).not.toMatch(/32\.7%/);
    expect(mutated).not.toMatch(/57\.5%/);
  });

  it('oracle-FAIL: dropping the recall makes the recall assertion fail', () => {
    // Simulate removing recall from the section
    const mutated = knownLimSection.replace(/recall 22\.0%/i, '');
    expect(mutated).not.toMatch(/recall 22\.0%/i);
  });

  it('oracle-PASS: changing the Windows bullet does not affect guard assertions', () => {
    // A mutation to an unrelated bullet must NOT break the guard assertions
    const mutated = knownLimSection.replace('Windows is unsupported', 'Windows is not supported');
    expect(mutated).toMatch(/precision 44\.8%/i);
    expect(mutated).toMatch(/recall 22\.0%/i);
    expect(mutated).toMatch(/32\.7%/);
    expect(mutated).toMatch(/57\.5%/);
  });
});
