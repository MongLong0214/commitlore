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

      // The section moved above the fold and was renamed to a question a reader
      // asks before installing rather than a label they meet at the bottom. What
      // it must disclose is unchanged; only where the test looks for it moved.
      // Extract the section (between its heading and the next ## heading)
      const knownLimStart = content.search(
        /^## (When this will not help you|이것이 도움이 되지 않는 경우|これが役に立たない場合|这在什么情况下帮不上忙)/m,
      );
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

  // Extract that section for English
  const knownLimStart = enContent.search(/^## When this will not help you/m);
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

  it('oracle-PASS: changing an unrelated bullet does not affect guard assertions', () => {
    // A mutation to an unrelated bullet must NOT break the guard assertions.
    //
    // This anchored on `Windows is unsupported` until v0.5.0 made that false and
    // it was removed. A `replace` whose needle is gone is a no-op, so the oracle
    // would have kept passing while testing nothing -- the exact false green
    // this file exists to catch. The needle is asserted present first.
    expect(knownLimSection, 'the oracle needle is gone; pick one that exists').toContain(
      'symbol anchors',
    );
    const mutated = knownLimSection.replace('symbol anchors', 'symbol anchoring');
    expect(mutated).toMatch(/precision 44\.8%/i);
    expect(mutated).toMatch(/recall 22\.0%/i);
    expect(mutated).toMatch(/32\.7%/);
    expect(mutated).toMatch(/57\.5%/);
  });
});

/**
 * Windows was documented as supported and never documented as installable.
 * `install.ps1` was named twenty-three times across the READMEs and docs, and
 * not once shown as a command anyone could run — a reader on Windows had to
 * reconstruct the URL from the shell one-liner. The platform has a required CI
 * job proving the installer works; the evidence outran the instructions.
 *
 * The installers' own header examples had gone stale in the other direction:
 * they carried copy-pasteable URLs pinned to v0.4.1, four releases behind, so
 * following the file's own documentation installed an old release. Nothing
 * checked them, because the pin test only ever read the READMEs.
 */
describe('every supported install path is documented and pinned to this release', () => {
  const INSTALLERS = ['install.sh', 'install.ps1'] as const;

  for (const file of README_FILES) {
    it(`${file} gives Windows a command, not just a mention`, () => {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const oneLiner = content
        .split('\n')
        .find((line) => line.includes('install.ps1') && line.includes('irm'));

      expect(oneLiner, 'no runnable PowerShell install line').toBeDefined();
      expect(oneLiner).not.toContain('/dev/');
      expect(oneLiner).toContain(`/v${PACKAGE_VERSION}/`);
    });
  }

  for (const file of INSTALLERS) {
    it(`${file} documents itself at this release, not an older one`, () => {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const urls = content.match(/raw\.githubusercontent\.com\/[^\s"']*/g) ?? [];

      expect(urls.length, 'the header lost its example URLs').toBeGreaterThan(0);
      for (const url of urls) {
        expect(url, `${url} is not pinned to this release`).toContain(`/v${PACKAGE_VERSION}/`);
      }
    });

    it(`${file} illustrates a tag with a placeholder that cannot go stale`, () => {
      // "Pass a tag such as v0.4.1" reads as advice to install v0.4.1, and it
      // silently rots every release. A number that was never a release cannot.
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const examples = content.match(/such as (v\d+\.\d+\.\d+)/g) ?? [];

      expect(examples.length, 'the illustrative tag example is gone').toBeGreaterThan(0);
      for (const example of examples) expect(example).toContain('v1.2.3');
    });
  }
});
