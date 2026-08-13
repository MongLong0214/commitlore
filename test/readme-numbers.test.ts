import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURES = path.join(REPO_ROOT, 'test', 'fixtures', 'bench');
const CLEAN = path.join(FIXTURES, 'clean.jsonl');
const GENERATED_README = path.join(FIXTURES, 'readme-in-sync.md');
const PUBLIC_READMES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md'] as const;
const WITHDRAWAL_MARKER = '<!-- BENCH:WITHDRAWN -->';
const GENERATED_BEGIN = '<!-- BENCH:BEGIN -->';
const tempDirs: string[] = [];
const PRODUCT_TYPES = path.join(REPO_ROOT, 'src', 'core', 'types.ts');

const runChecker = (...args: string[]) => {
  const result = spawnSync(process.execPath, ['scripts/check-readme-numbers.mjs', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const tempFile = (name: string, contents: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitlore-readme-numbers-'));
  tempDirs.push(dir);
  const target = path.join(dir, name);
  fs.writeFileSync(target, contents);
  return target;
};

const tempReadmePair = (english: string, korean: string): { english: string; korean: string } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitlore-readme-facts-'));
  tempDirs.push(dir);
  const englishPath = path.join(dir, 'README.md');
  const koreanPath = path.join(dir, 'README.ko.md');
  fs.writeFileSync(englishPath, english);
  fs.writeFileSync(koreanPath, korean);
  return { english: englishPath, korean: koreanPath };
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('README benchmark publication state', () => {
  it('publishes the generated numbers block in all four READMEs now that the declared M4 dataset has provenance', () => {
    // README_SOURCES (bench/report.ts) declares bench/results/t702-m4-final.jsonl, and
    // every row in that file carries a uniform harness_commit and dist_digest — the M1/M1-b/M2
    // datasets it replaced did not, which is why the withdrawal notice existed at all.
    const result = runChecker();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    for (const readme of PUBLIC_READMES) {
      const markdown = fs.readFileSync(path.join(REPO_ROOT, readme), 'utf8');
      expect(markdown).not.toContain(WITHDRAWAL_MARKER);
      expect(markdown).toContain(GENERATED_BEGIN);
    }
  });

  it('rejects a generated numbers block when its dataset lacks provenance', () => {
    const legacyRows = fs
      .readFileSync(CLEAN, 'utf8')
      .replace(/"harness_commit":"[^"]+",/g, '')
      .replace(/"dist_digest":"[^"]+",/g, '');
    const readme = tempFile('generated.md', fs.readFileSync(GENERATED_README, 'utf8'));
    const dataset = tempFile('legacy.jsonl', legacyRows);
    const result = runChecker('--readme', readme, dataset);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/withdrawal notice/);
  });

  it('rejects a withdrawal notice when a provenanced dataset can be summarized', () => {
    const [firstRow = ''] = fs.readFileSync(CLEAN, 'utf8').split('\n');
    const dataset = tempFile('provenanced.jsonl', `${firstRow}\n`);
    const readme = tempFile('withdrawn.md', `# Withdrawn\n\n${WITHDRAWAL_MARKER}\n`);
    const result = runChecker('--readme', readme, dataset);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/provenanced dataset.*withdrawal/i);
  });
});

describe('#590 generated README fact contract', () => {
  it('states its owned facts instead of implying that all README numbers are guarded', () => {
    const result = runChecker();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('README fact contract matches:');
    expect(result.stdout).toContain('headline re-proposal counts, denominators, rates, and analysis-set size');
    expect(result.stdout).toContain('the generated BENCH block in every public README');
  });

  it('rejects a guarded denominator that disagrees between English and Korean, naming both documents', () => {
    const english = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    const korean = fs.readFileSync(path.join(REPO_ROOT, 'README.ko.md'), 'utf8').replace('110/584', '110/583');
    const copies = tempReadmePair(english, korean);
    const result = runChecker('--facts-readme', copies.english, '--facts-readme', copies.korean);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('README.md and');
    expect(result.stderr).toContain('README.ko.md');
    expect(result.stderr).toContain('110/583');
  });

  it('rejects a provenance value the product gains before the docs mention it', () => {
    const original = fs.readFileSync(PRODUCT_TYPES, 'utf8');
    expect(original).toContain("'unknown'] as const");
    try {
      const productWithFutureProvenance = original
        .replace("'unknown'] as const", "'unknown', 'future'] as const")
        .replace('reconstructed|unknown|inherited', 'reconstructed|unknown|future|inherited')
        .replace("  | { kind: 'unknown' };", "  | { kind: 'unknown' }\n  | { kind: 'future' };")
        .replace(
          "    trimmed === 'unknown'\n",
          "    trimmed === 'unknown' ||\n    trimmed === 'future'\n",
        );
      fs.writeFileSync(PRODUCT_TYPES, productWithFutureProvenance);
      const result = runChecker();

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Provenance grammar');
      expect(result.stderr).toContain('future');
    } finally {
      fs.writeFileSync(PRODUCT_TYPES, original);
    }
  });
});
