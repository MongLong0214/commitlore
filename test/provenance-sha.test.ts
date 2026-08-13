/**
 * #589: Provenance `inherited <sha>` must accept git's real object ids.
 *
 * The schema used to cap the suffix at 7–40 lowercase hex. squash-preserve
 * writes the object id git actually uses, which on a SHA-256 repository is
 * 64 hex, so validate refused the record the tool just wrote.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { gradeRecord, type AuthoredRecord } from '../src/core/grade.js';
import { execGitOrThrow } from '../src/core/git.js';
import { runQuery } from '../src/core/query.js';
import { validateRecord } from '../src/core/schema.js';
import {
  PROVENANCE_FORMAT_WANT,
  PROVENANCE_VALUE_PATTERN,
  parseProvenance,
} from '../src/core/types.js';
import { readSourceFiles } from './fixtures.js';
import { createTestRepo } from './git-fixtures.js';

const AT = new Date('2026-08-13T00:00:00Z');
const TRUSTED = ['alice'];

const SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const accepted = [
  ['inherited deadbee', '7 hex — the old minimum, still allowed'],
  ['inherited deadbe', '6 hex — git abbreviates to 4+'],
  ['inherited dead', '4 hex — git\'s shortest abbreviation'],
  ['inherited DEADBEE', 'uppercase — git\'s object-id alphabet is case-insensitive'],
  ['inherited DeadBee', 'mixed case'],
  [`inherited ${SHA256}`, '64 hex — a full SHA-256 object id'],
  [`inherited ${SHA256.slice(0, 40)}`, '40 hex — a full SHA-1 object id'],
] as const;

const refused = [
  ['inherited', 'no sha'],
  ['inherited ', 'sha is empty'],
  ['inherited zzz', 'not hex'],
  ['inherited abc', '3 hex — shorter than git will abbreviate to'],
  [`inherited ${SHA256}0`, '65 hex — longer than any git object id'],
  ['inherited deadbeez', 'non-hex letter in the suffix'],
] as const;

const SCHEMA = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'spec',
  'schema',
  'record.schema.json',
);

const provenancePatternFromSchema = (): string => {
  const schema = JSON.parse(readFileSync(SCHEMA, 'utf8')) as {
    $defs?: { trailer?: { allOf?: { then?: { properties?: { value?: { pattern?: string } } } }[] } };
  };
  const branches = schema.$defs?.trailer?.allOf ?? [];
  for (const branch of branches) {
    const pattern = branch.then?.properties?.value?.pattern;
    if (pattern?.includes('inherited')) return pattern;
  }
  throw new Error('schema has no Provenance inherited pattern');
};

const withProvenance = (value: string): AuthoredRecord => ({
  sha: 'c1',
  trailers: [
    { key: 'Record-Id', value: 'r-p1p2p3' },
    { key: 'Provenance', value },
    { key: 'Warn', value: 'do not raise the retry ceiling' },
  ],
});

describe('#589 Provenance inherited <sha> matches git object ids', () => {
  it.each(accepted)('validate accepts %s (%s)', (value) => {
    expect(validateRecord([{ key: 'Provenance', value }])).toEqual([]);
  });

  it.each(refused)('validate refuses %s (%s)', (value) => {
    const violations = validateRecord([{ key: 'Provenance', value }]);
    expect(violations).toEqual([
      {
        key: 'Provenance',
        value,
        rule: 'format',
        got: value,
        want: PROVENANCE_FORMAT_WANT,
      },
    ]);
  });

  it.each(accepted)('grade reads %s as inherited (%s)', (value) => {
    const sha = value.slice('inherited '.length);
    expect(gradeRecord(withProvenance(value), { at: AT, author: 'alice', trustedAuthors: TRUSTED })).toMatchObject({
      provenance: 'inherited',
      trust: 'claim',
    });
    expect(parseProvenance(value)).toEqual({ kind: 'inherited', sha });
  });

  it.each(refused)('grade treats %s as unknown (%s)', (value) => {
    expect(gradeRecord(withProvenance(value), { at: AT, author: 'alice', trustedAuthors: TRUSTED }).provenance).toBe(
      'unknown',
    );
    expect(parseProvenance(value)).toBeUndefined();
  });

  it('repair text names drafted, which the schema accepts and unattended capture writes', () => {
    const [violation] = validateRecord([{ key: 'Provenance', value: 'nope' }]);
    expect(violation?.want).toBe(
      'authored | drafted | inherited <sha> | reconstructed | unknown',
    );
    expect(violation?.want).toContain('drafted');
  });
});

describe('#589 one Provenance grammar, three readers', () => {
  it('the schema pattern is the exported definition, not a third copy', async () => {
    const { PROVENANCE_VALUE_PATTERN } = await import('../src/core/types.js');
    expect(provenancePatternFromSchema()).toBe(PROVENANCE_VALUE_PATTERN);
  });

  it('grade.ts and query.ts import parseProvenance instead of keeping their own rule', () => {
    const sources = Object.fromEntries(readSourceFiles());
    const grade = sources['core/grade.ts'] ?? '';
    const query = sources['core/query.ts'] ?? '';
    expect(grade).toContain('parseProvenance');
    expect(query).toContain('parseProvenance');
    expect(grade).not.toMatch(/\[0-9a-f\]\{7,40\}/);
    expect(query).not.toMatch(/startsWith\('inherited /);
    expect(query).not.toMatch(/trimmed === 'inherited'/);
  });
});

describe('#589 query reads the same inherited grammar as validate', () => {
  const scratch: string[] = [];

  const commitRecord = (dir: string, provenance: string): void => {
    const path = join(dir, 'src', 'queue.ts');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'export const workers = 3;\n');
    execGitOrThrow(['add', '-A'], { cwd: dir });
    execGitOrThrow(
      ['commit', '-q', '--no-verify', '--allow-empty', '--cleanup=verbatim', '-F', '-'],
      {
        cwd: dir,
        stdin:
          `record provenance\n\nLimit: the vendor caps us at 3 concurrent workers\nProvenance: ${provenance}\nRecord-Id: r-query01\n`,
      },
    );
  };

  const queryProvenance = (value: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'commitlore-prov-query-'));
    scratch.push(dir);
    createTestRepo({ path: dir });
    commitRecord(dir, value);
    return runQuery({ cwd: dir, keys: ['Limit'] }).records[0]?.provenance;
  };

  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  it('returns inherited for a 64-hex SHA-256 object id', () => {
    expect(queryProvenance(`inherited ${SHA256}`)).toEqual({ kind: 'inherited', sha: SHA256 });
  });

  it('returns inherited for a 6-hex abbreviation and for uppercase hex', () => {
    expect(queryProvenance('inherited deadbe')).toEqual({ kind: 'inherited', sha: 'deadbe' });
    expect(queryProvenance('inherited DEADBEE')).toEqual({ kind: 'inherited', sha: 'DEADBEE' });
  });

  it('does not treat a missing or implausible sha as inherited', () => {
    expect(queryProvenance('inherited')).toBeUndefined();
    expect(queryProvenance('inherited zzz')).toBeUndefined();
    expect(queryProvenance('inherited abc')).toBeUndefined();
  });
});
