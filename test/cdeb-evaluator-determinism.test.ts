/**
 * CDEB-06 acceptance: all controls deterministic (PRD §26, §12.5 "repeated
 * evaluation → byte-identical normalized result").
 *
 * Determinism is asserted on BYTES, not on parsed equality: the subprocess
 * stdout of two evaluations of the same tree must be the same byte string.
 * Parsed-JSON equality would hide exactly the drift this property forbids
 * (a stray timestamp, a scratch path, an unstable key order).
 *
 * Sources of nondeterminism closed, named one by one:
 *
 *   - clocks: the verdict carries no timestamp and no duration; archive
 *     headers zero mtime (asserted below by varying mtimes and getting the
 *     same bytes);
 *   - environment: the verdict process runs under the hermetic allowlist,
 *     so host TZ/locale/proxy/secret drift cannot reach it (isolation
 *     tests);
 *   - filesystem ordering: every TreeView listing and every archive entry
 *     set is sorted;
 *   - iteration/hash order: the verdict object is constructed in the
 *     schema's key order and JSON.stringify preserves insertion order
 *     (asserted against the schema below);
 *   - scratch location: every run extracts into a fresh mkdtemp directory,
 *     and repeated runs still produce identical bytes, so no path leaks
 *     into the verdict;
 *   - compression: the zstd level is pinned in the freeze (freeze-tree.ts),
 *     asserted below by archive-byte equality.
 *
 * Not closable here, stated plainly: candidate code a probe runs may itself
 * be nondeterministic. A sealed task whose expectations depend on such
 * output is malformed (§4.8 oracle-determinism review); the repeated
 * good/bad/no-op controls are the mechanical catch at study time.
 */

import { cpSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { canonicalResultBytes, normalizedResultSha256 } from '../bench/cdeb/evaluator/engine.ts';
import { freezeFinalTree } from '../bench/cdeb/evaluator/freeze-tree.ts';
import { ingestFinalTree } from '../bench/cdeb/evaluator/ingest.ts';
import {
  buildTree,
  cleanupScratch,
  evaluatePrepared,
  expectVerdict,
  fixtureFile,
  prepareRun,
  tempDir,
} from './cdeb-evaluator-helpers.ts';

afterAll(() => {
  cleanupScratch();
});

const SCHEMA_KEY_ORDER = [
  'schema_version',
  'task_id',
  'functional_pass',
  'rejected_decision_revived',
  'functional_checks',
  'decision_oracle_code',
  'evaluator_image_digest',
  'candidate_tree_oid',
] as const;

describe('CDEB-06 determinism: repeated evaluation is byte-identical', () => {
  it(
    'the good tree yields byte-identical verdicts across repeated runs',
    { timeout: 120_000 },
    () => {
      const tree = buildTree('det-good', { 'src/calc.js': fixtureFile('patches/good/calc.js') });
      const run = prepareRun('det-good', tree);
      const first = evaluatePrepared(run);
      const second = evaluatePrepared(run);
      const third = evaluatePrepared(run);
      expect(first.exitCode).toBe(0);
      // Byte equality, not parsed equality — each run used a fresh scratch.
      expect(second.rawStdout.equals(first.rawStdout)).toBe(true);
      expect(third.rawStdout.equals(first.rawStdout)).toBe(true);
      const verdict = expectVerdict(first);
      expect(normalizedResultSha256(second.verdict!)).toBe(normalizedResultSha256(verdict));
      expect(first.rawStdout.equals(canonicalResultBytes(verdict))).toBe(true);
    },
  );

  it('a failing attack tree is also byte-reproducible', () => {
    const tree = buildTree('det-attack', {
      'src/calc.js': fixtureFile('attacks/forge-scripts/calc.js'),
      'forge-pass.js': fixtureFile('attacks/forge-scripts/forge-pass.js'),
      'evaluator.json': fixtureFile('attacks/forge-scripts/forged-evaluator.json'),
    });
    const run = prepareRun('det-attack', tree);
    const first = evaluatePrepared(run);
    const second = evaluatePrepared(run);
    expect(first.exitCode).toBe(0);
    expect(expectVerdict(first).functional_pass).toBe(false);
    expect(second.rawStdout.equals(first.rawStdout)).toBe(true);
  });

  it('the verdict serializes in the schema key order with no extra fields', () => {
    const tree = buildTree('det-keys', { 'src/calc.js': fixtureFile('patches/good/calc.js') });
    const result = evaluatePrepared(prepareRun('det-keys', tree));
    const verdict = expectVerdict(result);
    expect(Object.keys(verdict)).toEqual([...SCHEMA_KEY_ORDER]);
    expect(result.rawStdout.toString('utf8').endsWith('\n')).toBe(true);
    expect(JSON.parse(result.rawStdout.toString('utf8'))).toEqual(verdict);
  });
});

describe('CDEB-06 determinism: freeze and ingestion identities', () => {
  it('freezing the same tree twice yields identical OIDs and archive bytes', () => {
    const tree = buildTree('freeze-twice', { 'src/calc.js': fixtureFile('patches/good/calc.js') });
    const first = freezeFinalTree(tree, tempDir('freeze-twice-a'));
    const second = freezeFinalTree(tree, tempDir('freeze-twice-b'));
    expect(second.final_tree_oid).toBe(first.final_tree_oid);
    expect(second.tar_sha256).toBe(first.tar_sha256);
    expect(second.archive_zst_sha256).toBe(first.archive_zst_sha256);
    expect(second.archive_zst.equals(first.archive_zst)).toBe(true);
  });

  it('file mtimes never reach the archive bytes', () => {
    // Two byte-identical trees whose filesystem clocks disagree must freeze
    // to the same archive: the headers zero mtime, so the only inputs are
    // (path, mode, content) — git's own identity inputs.
    const treeA = buildTree('mtime-a', { 'src/calc.js': fixtureFile('patches/good/calc.js') });
    const treeB = buildTree('mtime-b', {});
    cpSync(treeA, treeB, { recursive: true });
    const past = new Date('2020-01-02T03:04:05Z');
    const future = new Date('2031-04-05T06:07:08Z');
    const retimes = [
      ['', treeA, past],
      ['src', treeA, past],
      ['src/calc.js', treeA, past],
      ['', treeB, future],
      ['src', treeB, future],
      ['src/calc.js', treeB, future],
    ] as const;
    for (const [rel, tree, when] of retimes) utimesSync(join(tree, rel), when, when);
    const first = freezeFinalTree(treeA, tempDir('mtime-freeze-a'));
    const second = freezeFinalTree(treeB, tempDir('mtime-freeze-b'));
    expect(second.tar_sha256).toBe(first.tar_sha256);
    expect(second.final_tree_oid).toBe(first.final_tree_oid);
  });

  it('ingesting the same archive twice recomputes the same tree OID', () => {
    const tree = buildTree('ingest-twice', { 'src/calc.js': fixtureFile('patches/good/calc.js') });
    const run = prepareRun('ingest-twice', tree);
    const archive = readFileSync(run.archivePath);
    const first = ingestFinalTree(archive, tempDir('ingest-twice-a'), { claimedOid: run.frozen.final_tree_oid });
    const second = ingestFinalTree(archive, tempDir('ingest-twice-b'), { claimedOid: run.frozen.final_tree_oid });
    expect(first.refusal).toBeNull();
    expect(second.refusal).toBeNull();
    expect(second.candidate_tree_oid).toBe(first.candidate_tree_oid);
    expect(first.candidate_tree_oid).toBe(run.frozen.final_tree_oid);
  });
});
