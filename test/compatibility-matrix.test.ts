/**
 * T-1107 (#271): Compatibility matrix kept honest by a test.
 *
 * Three directions:
 * 1. Every target in release.yml's matrix has a matrix row with status `supported`.
 * 2. Every row NOT in release.yml has status `unsupported` or `undecided` AND cites
 *    an issue number or a record id.
 * 3. The OS and architecture set accepted by install.sh matches the supported rows.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

// --- Parsers ---

/** Extract targets from release.yml build matrix */
function parseReleaseTargets(): string[] {
  const content = fs.readFileSync(
    path.join(REPO_ROOT, '.github/workflows/release.yml'),
    'utf8',
  );
  const targets: string[] = [];
  // Match `target: <value>` lines inside the matrix include block
  const lines = content.split('\n');
  let inMatrix = false;
  for (const line of lines) {
    if (/^\s+matrix:/.test(line)) inMatrix = true;
    if (inMatrix && /^\s+target:\s+/.test(line)) {
      const match = line.match(/target:\s+(.+)/);
      if (match) targets.push(match[1].trim());
    }
    // Stop after the matrix block (when we hit `runs-on:` at job level)
    if (inMatrix && /^\s{4}runs-on:/.test(line)) break;
  }
  return targets;
}

/** Parse the compatibility matrix document */
interface MatrixRow {
  os: string;
  arch: string;
  libc: string;
  target: string;
  status: 'supported' | 'unsupported' | 'undecided';
  reason: string;
}

function parseCompatibilityMatrix(): MatrixRow[] {
  const filePath = path.join(REPO_ROOT, 'docs/COMPATIBILITY.md');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const rows: MatrixRow[] = [];
  // Find the table (header row starts with |)
  let headerFound = false;
  let separatorPassed = false;

  for (const line of lines) {
    if (!headerFound && /^\|\s*OS\s*\|/i.test(line)) {
      headerFound = true;
      continue;
    }
    if (headerFound && !separatorPassed && /^\|[-\s|]+\|$/.test(line)) {
      separatorPassed = true;
      continue;
    }
    if (headerFound && separatorPassed) {
      if (!line.startsWith('|')) break; // End of table
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.length >= 6) {
        const status = cells[4] as MatrixRow['status'];
        rows.push({
          os: cells[0],
          arch: cells[1],
          libc: cells[2],
          target: cells[3],
          status,
          reason: cells[5],
        });
      }
    }
  }
  return rows;
}

/** Parse install.sh to extract the supported OS/arch combinations */
function parseInstallerTargets(): string[] {
  const content = fs.readFileSync(path.join(REPO_ROOT, 'install.sh'), 'utf8');

  // Extract OS mapping: case values → target OS component
  const osMap: Record<string, string> = {};
  const osBlock = content.match(
    /case "\$os_raw" in\n([\s\S]*?)\nesac/,
  );
  if (osBlock) {
    const osLines = osBlock[1].split('\n');
    for (const line of osLines) {
      const m = line.match(/^\s*(\S+)\)\s*os=(\S+)\s*;;/);
      if (m) osMap[m[1]] = m[2];
    }
  }

  // Extract arch mapping: case values → target arch component
  const archMap: Record<string, string> = {};
  const archBlock = content.match(
    /case "\$arch_raw" in\n([\s\S]*?)\nesac/,
  );
  if (archBlock) {
    const archLines = archBlock[1].split('\n');
    for (const line of archLines) {
      const m = line.match(/^\s*([^)]+)\)\s*arch=(\S+)\s*;;/);
      if (m) {
        // Normalise: take only the canonical arch name (first in pipe-separated)
        archMap[m[2]] = m[2];
      }
    }
  }

  // Build the cross product of unique OS × unique arch → target triples
  const osValues = [...new Set(Object.values(osMap))];
  const archValues = [...new Set(Object.values(archMap))];

  const targets: string[] = [];
  for (const arch of archValues) {
    for (const os of osValues) {
      targets.push(`${arch}-${os}`);
    }
  }
  return targets.sort();
}

// --- Tests ---

describe('Compatibility matrix (T-1107)', () => {
  const releaseTargets = parseReleaseTargets();
  const matrixRows = parseCompatibilityMatrix();
  const installerTargets = parseInstallerTargets();

  it('release.yml targets are parseable and non-empty', () => {
    expect(releaseTargets.length).toBeGreaterThan(0);
  });

  it('every release target has a matrix row with status supported', () => {
    for (const target of releaseTargets) {
      const row = matrixRows.find((r) => r.target === target);
      expect(row, `missing matrix row for release target: ${target}`).toBeDefined();
      expect(
        row!.status,
        `matrix row for ${target} should be "supported", got "${row!.status}"`,
      ).toBe('supported');
    }
  });

  it('every non-release row has status unsupported or undecided with a citation', () => {
    const nonReleaseRows = matrixRows.filter(
      (r) => !releaseTargets.includes(r.target),
    );
    for (const row of nonReleaseRows) {
      expect(
        ['unsupported', 'undecided'],
        `row ${row.target} has invalid status "${row.status}"`,
      ).toContain(row.status);
      // Must cite an issue number (#NNN) or a record id (r-XXXX)
      const hasCitation = /#\d+/.test(row.reason) || /r-[a-z0-9]{4,}/.test(row.reason);
      expect(
        hasCitation,
        `row ${row.target} (status: ${row.status}) must cite an issue or record id in reason: "${row.reason}"`,
      ).toBe(true);
    }
  });

  it('install.sh OS/arch mapping matches the supported matrix rows', () => {
    const supportedTargets = matrixRows
      .filter((r) => r.status === 'supported')
      .map((r) => r.target)
      .sort();

    expect(
      installerTargets,
      `install.sh produces targets ${JSON.stringify(installerTargets)} but matrix supported rows are ${JSON.stringify(supportedTargets)}`,
    ).toEqual(supportedTargets);
  });

  it('status vocabulary is exactly supported, unsupported, or undecided', () => {
    const validStatuses = new Set(['supported', 'unsupported', 'undecided']);
    for (const row of matrixRows) {
      expect(
        validStatuses.has(row.status),
        `row ${row.target} has invalid status "${row.status}"`,
      ).toBe(true);
    }
  });
});
