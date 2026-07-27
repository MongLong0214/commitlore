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
  it('accepts the withdrawal notice in all four READMEs while the declared datasets lack provenance', () => {
    const result = runChecker();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    for (const readme of PUBLIC_READMES) {
      expect(fs.readFileSync(path.join(REPO_ROOT, readme), 'utf8')).toContain(WITHDRAWAL_MARKER);
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
