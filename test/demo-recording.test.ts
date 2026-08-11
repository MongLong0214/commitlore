/**
 * T-1016 (#212): Deterministic README demo recording.
 *
 * Asserts:
 *   1. The recorded SVG asset exists
 *   2. It is byte-reproducible (re-render matches committed file)
 *   3. All four READMEs reference the same asset path
 *   4. The SVG contains no private identifiers (absolute paths, usernames, hostnames)
 *   5. The SVG uses the canonical fixture identifiers from T-1010
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const ASSET_PATH = path.join(REPO_ROOT, 'assets', 'readme', 'commitlore-demo.svg');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'record-demo.mjs');
const READMES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md'];
const ASSET_REF = 'assets/readme/commitlore-demo.svg';

describe('T-1016: deterministic demo recording', () => {
  it('SVG asset exists', () => {
    expect(fs.existsSync(ASSET_PATH)).toBe(true);
  });

  it('--check mode exits 0 (byte-reproducible)', () => {
    const result = execFileSync(process.execPath, [SCRIPT_PATH, '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(result).toContain('byte-identical');
  });

  it('all four READMEs reference the same asset', () => {
    for (const readme of READMES) {
      const content = fs.readFileSync(path.join(REPO_ROOT, readme), 'utf8');
      expect(content).toContain(ASSET_REF);
    }
  });

  it('SVG contains canonical fixture identifiers', () => {
    const svg = fs.readFileSync(ASSET_PATH, 'utf8');
    // From T-1010: the active record id
    expect(svg).toContain('r-price02');
    // The target path from the fixture
    expect(svg).toContain('src/pricing.ts');
  });

  it('SVG contains no private identifiers', () => {
    const svg = fs.readFileSync(ASSET_PATH, 'utf8');
    // No absolute paths
    expect(svg).not.toMatch(/\/Users\/[a-zA-Z]/);
    expect(svg).not.toMatch(/\/home\/[a-zA-Z]/);
    expect(svg).not.toMatch(/\/tmp\/commitlore-demo-/);
    // No hostnames or tokens
    expect(svg).not.toMatch(/hostname|\.local/i);
    // No environment-variable-looking tokens
    expect(svg).not.toMatch(/[A-Z_]{5,}=[^\s]+/);
  });

  it('re-rendering produces identical bytes (second run)', () => {
    // Generate to a temp location and compare
    const tmpDir = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-demo-check-'));
    try {
      const tmpAsset = path.join(tmpDir, 'check.svg');
      // Run the script without --check to capture output, redirect manually
      const generated = execFileSync(process.execPath, [SCRIPT_PATH], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Read the asset that was just (re)written
      const first = fs.readFileSync(ASSET_PATH, 'utf8');
      // Run again
      execFileSync(process.execPath, [SCRIPT_PATH], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const second = fs.readFileSync(ASSET_PATH, 'utf8');
      expect(first).toBe(second);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
