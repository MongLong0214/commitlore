import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import {
  DIST_DIR,
  digestDistTree,
  HOOK_PLANS,
  writeArmSettings,
} from '../bench/hooks-settings.ts';
import { parseRows, summarize } from '../bench/metrics.ts';
import type { RunRecord } from '../bench/types.ts';

const HARNESS_COMMIT = '1111111111111111111111111111111111111111';
const DIST_DIGEST = '2222222222222222222222222222222222222222222222222222222222222222';

const row = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  run_id: 'provenance-test',
  harness_commit: HARNESS_COMMIT,
  dist_digest: DIST_DIGEST,
  task: 'reproposal-redis-cache',
  cond: 'commitlore-on',
  seed: 1,
  reproposed: false,
  violations: 0,
  turns: 3,
  tokens: 1000,
  stopped_by: 'completed',
  duration_ms: 10,
  driver: 'claude-headless',
  started_at: '2026-07-27T00:00:00.000Z',
  simulated: false,
  ...overrides,
});

describe('benchmark provenance', () => {
  it('hashes every path and file in a dist tree deterministically', () => {
    const distDir = mkdtempSync(join(tmpdir(), 'commitlore-dist-digest-'));
    const coreDir = join(distDir, 'core');
    mkdirSync(coreDir);
    writeFileSync(join(distDir, 'cli.js'), 'import "./core/guard.js";\n');
    writeFileSync(join(coreDir, 'guard.js'), 'before\n');

    try {
      const initial = digestDistTree(distDir);
      expect(digestDistTree(distDir)).toBe(initial);

      writeFileSync(join(coreDir, 'guard.js'), 'after\n');
      const modified = digestDistTree(distDir);
      expect(modified).not.toBe(initial);

      const mapPath = join(coreDir, 'guard.js.map');
      writeFileSync(mapPath, '{}\n');
      const added = digestDistTree(distDir);
      expect(added).not.toBe(modified);

      unlinkSync(mapPath);
      const removed = digestDistTree(distDir);
      expect(removed).not.toBe(added);

      renameSync(join(coreDir, 'guard.js'), join(coreDir, 'gate.js'));
      expect(digestDistTree(distDir)).not.toBe(removed);
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });

  it('accepts rows that share one harness commit and dist digest', () => {
    const summary = summarize([row(), row({ seed: 2 })], ['same-product.jsonl']);

    expect(summary.rows).toBe(2);
  });

  it('rejects two dist digests and names both row counts', () => {
    expect(() =>
      summarize(
        [
          row({ dist_digest: 'digest-a' }),
          row({ seed: 2, dist_digest: 'digest-a' }),
          row({ seed: 3, dist_digest: 'digest-b' }),
        ],
        ['mixed-cli.jsonl'],
      ),
    ).toThrow(/2 distinct dist_digest.*digest-a: 2.*digest-b: 1/);
  });

  it('rejects two harness commits', () => {
    expect(() =>
      summarize(
        [row({ harness_commit: 'commit-a' }), row({ seed: 2, harness_commit: 'commit-b' })],
        ['mixed-harness.jsonl'],
      ),
    ).toThrow(/2 distinct harness_commit.*commit-a: 1.*commit-b: 1/);
  });

  it('rejects legacy rows and names their provenance unrecorded', () => {
    const { harness_commit: _commit, dist_digest: _digest, ...legacy } = row();
    const rows = parseRows('legacy.jsonl', `${JSON.stringify(legacy)}\n`);

    expect(() => summarize(rows, ['legacy.jsonl'])).toThrow(
      /harness_commit.*unrecorded: 1.*dist_digest.*unrecorded: 1/,
    );
  });

  it('refuses to write hook settings when the dist digest changed after startup', () => {
    const current = digestDistTree(DIST_DIR);
    const startup = `${current[0] === '0' ? '1' : '0'}${current.slice(1)}`;
    let settingsPath: string | null = null;

    try {
      expect(() => {
        settingsPath = writeArmSettings(HOOK_PLANS['commitlore-on'] ?? {}, startup);
      }).toThrow(/dist.*changed/i);
    } finally {
      if (settingsPath !== null) rmSync(dirname(settingsPath), { recursive: true, force: true });
    }
  });

  it('requires both provenance fields in the result schema', () => {
    const schemaPath = join(import.meta.dirname, '..', 'bench', 'schema', 'result.schema.json');
    const ajv = new Ajv({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
    const { harness_commit: _commit, ...withoutCommit } = row();
    const { dist_digest: _digest, ...withoutDigest } = row();

    expect(validate(row()), ajv.errorsText(validate.errors)).toBe(true);
    expect(validate(withoutCommit)).toBe(false);
    expect(validate(withoutDigest)).toBe(false);
  });
});
