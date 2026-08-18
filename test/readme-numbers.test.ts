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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('README benchmark publication state', () => {
  it('publishes the generated numbers block in the one file that owns it', () => {
    // README_SOURCES (bench/report.ts) declares bench/results/t702-m4-final.jsonl, and
    // every row in that file carries a uniform harness_commit and dist_digest — the M1/M1-b/M2
    // datasets it replaced did not, which is why the withdrawal notice existed at all.
    //
    // This asserted the block in all four READMEs, which is what it used to be.
    // Only the first was ever compared: the checker took `readmes[0]` and
    // stopped, so three hand-regenerated copies were checked by nobody. The
    // block now lives in `docs/evidence.md` and the READMEs must not carry one,
    // because a second copy is a copy that drifts.
    const result = runChecker();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const evidence = fs.readFileSync(path.join(REPO_ROOT, 'docs/evidence.md'), 'utf8');
    expect(evidence).toContain(GENERATED_BEGIN);

    for (const readme of PUBLIC_READMES) {
      const markdown = fs.readFileSync(path.join(REPO_ROOT, readme), 'utf8');
      expect(markdown).not.toContain(WITHDRAWAL_MARKER);
      expect(markdown, `${readme} carries a second copy of the generated block`).not.toContain(
        GENERATED_BEGIN,
      );
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
