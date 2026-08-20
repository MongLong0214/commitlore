import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CDEB_ROOT = join(ROOT, 'bench', 'cdeb');
const STUDY_ROOT = join(CDEB_ROOT, 'studies', 'cdeb-fresh-v3');

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const directories = [
  '.',
  'literature',
  'literature/audits',
  'roles',
  'corpus',
  'corpus/adjudication',
  'source-packets',
  'gold',
  'tasks',
  'oracles',
  'controls',
  'pilot',
  'power',
  'freeze',
  'rows',
  'patch-audit',
  'analysis',
];

describe('CDEB-Fresh v3 authority and literature lock', () => {
  it('installs the v3 PRD and retains the historical PRD', () => {
    const prd = join(CDEB_ROOT, 'PRD.md');
    const archive = join(CDEB_ROOT, 'archive', 'PRD-v1.3.md');

    expect(existsSync(prd)).toBe(true);
    expect(readFileSync(prd, 'utf8').split('\n').slice(0, 200).join('\n')).toContain('CDEB-Fresh v3');
    expect(existsSync(archive)).toBe(true);
    expect(readFileSync(archive, 'utf8')).toContain('not the implementation authority');
  });

  it('creates the PRD §21 study directory tree', () => {
    for (const directory of directories) {
      const path = join(STUDY_ROOT, directory);
      expect(existsSync(path), path).toBe(true);
      expect(statSync(path).isDirectory(), path).toBe(true);
    }
  });

  it('matches the §21.1 study manifest', () => {
    const study = readJson(join(STUDY_ROOT, 'study.json'));

    expect(study).toEqual({
      study_id: 'cdeb-fresh-v3',
      schema_version: 3,
      release_tag: 'v1.2.0',
      release_commit: '90a8b212e1db70cccf69fbf48415b9c036b2d854',
      repositories: ['gitseed', 'agent-operator-score', 'logic-pro-mcp', 'agent-control-plane'],
      pilot_tasks: 12,
      confirmatory_task_candidates: [48, 64, 80],
      repeats_per_arm: 2,
      arms: ['delivery-on', 'delivery-suppressed'],
      primary_estimand: 'equal_repository_dsfps_difference',
      key_secondary: 'equal_repository_fvr_difference',
      evidence_tier: 'tier-b-author-operated-multi-agent',
    });
    expect(isRecord(study)).toBe(true);
    if (!isRecord(study)) return;
    expect(study.release_commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('blocks measured runs during the literature lock', () => {
    const status = readJson(join(STUDY_ROOT, 'STATUS.json'));

    expect(isRecord(status)).toBe(true);
    if (!isRecord(status)) return;
    expect(status.measured_run_allowed).toBe(false);
  });

  // Compiled once at describe scope so the refusal cases below use the same
  // validators as the acceptance case; two compilations of the same schema can
  // drift on Ajv options and then the two halves are not testing one thing.
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const sourceLock = ajv.compile(readJson(join(CDEB_ROOT, 'schemas', 'source-lock.schema.json')));
  const evidenceMatrix = ajv.compile(readJson(join(CDEB_ROOT, 'schemas', 'evidence-matrix.schema.json')));

  it('validates literature artifacts and rejects invalid locked values', () => {
    const sourceLockValidator = sourceLock;
    const evidenceMatrixValidator = evidenceMatrix;

    expect(sourceLockValidator(readJson(join(STUDY_ROOT, 'literature', 'source-lock.json')))).toBe(true);
    expect(evidenceMatrixValidator(readJson(join(STUDY_ROOT, 'literature', 'evidence-matrix.json')))).toBe(true);
    expect(sourceLockValidator({
      schema_version: 1,
      sources: [{
        source_id: 'LIT-TEST',
        title: 'Test source',
        source_kind: 'arxiv',
        identifier: '2602.08316',
        version: 'v3',
        downloaded_at: '2026-08-20T00:00:00Z',
        sha256: '0'.repeat(63),
      }],
    })).toBe(false);
    expect(evidenceMatrixValidator({
      schema_version: 1,
      claims: [{
        claim_id: 'CLAIM-TEST',
        claim_text: 'Test claim',
        source_id: 'LIT-TEST',
        verdict: 'UNRECOGNIZED',
        scope_note: 'Test scope',
      }],
    })).toBe(false);
  });

  /**
   * The source policy's teeth are the kinds it refuses, not the one it accepts.
   * §2.1 bans blog summaries, social posts and secondary explainers outright, and
   * a schema that only checks the happy path enforces none of that. `extra
   * property` is here for the same reason: a lock that silently carries an
   * unmodelled field is a lock with an undocumented slot in it.
   */
  it.each([
    ['a blog is not an allowed source kind', { source_kind: 'blog' }],
    ['an uppercase digest is not the recorded form', { sha256: 'A'.repeat(64) }],
    ['a digest of the wrong length', { sha256: 'a'.repeat(63) }],
    ['a date that is not a date', { downloaded_at: 'yesterday' }],
    ['an unmodelled field', { note: 'x' }],
  ])('source lock refuses %s', (_label, override) => {
    const source = {
      source_id: 'LIT-A',
      title: 'T',
      source_kind: 'arxiv',
      identifier: '2602.08316',
      version: 'v3',
      downloaded_at: '2026-08-20T00:00:00Z',
      sha256: 'a'.repeat(64),
      ...override,
    };
    expect(sourceLock({ schema_version: 1, sources: [source] })).toBe(false);
  });

  it.each([
    ['a verdict outside the vocabulary', 'PROBABLY'],
    ['a verdict in the wrong case', 'supported'],
  ])('evidence matrix refuses %s', (_label, verdict) => {
    expect(
      evidenceMatrix({
        schema_version: 1,
        claims: [{ claim_id: 'C1', claim_text: 'x', source_id: 'LIT-A', verdict, scope_note: 'n' }],
      }),
    ).toBe(false);
  });

  /**
   * The review that produced these found four assertions that would pass while
   * the thing they name was wrong, which is the only kind of test failure that
   * does not announce itself.
   */

  it('the archive is the previous PRD, not a banner where one used to be', () => {
    // Asserting the banner alone passes against a stub containing only the
    // banner. The v1.3 document is thousands of lines and opens with its own
    // title; both are properties a stub does not have.
    const archived = readFileSync(join(CDEB_ROOT, 'archive', 'PRD-v1.3.md'), 'utf8');
    expect(archived).toContain('not the implementation authority');
    expect(archived).toContain('CommitLore Decision Efficiency Benchmark');
    expect(archived.split('\n').length, 'an archive this short is a stub').toBeGreaterThan(500);
  });

  it('release_commit is the commit the release tag peels to', () => {
    // A hardcoded expectation and a 40-hex shape both pass on a well-formed but
    // wrong SHA. Only git can say whether it is the right one.
    const study = readJson(join(STUDY_ROOT, 'study.json')) as { release_tag: string; release_commit: string };
    const actual = execFileSync('git', ['rev-list', '-n', '1', study.release_tag], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    expect(study.release_commit).toBe(actual);
  });

  it.each([
    'SAP.md',
    'RESULT.md',
    'deviations.jsonl',
    'study.json',
    'STATUS.json',
    'literature/source-lock.json',
    'literature/evidence-matrix.json',
    'literature/evidence-matrix.md',
    'roles/manifest.json',
    'corpus/candidate-registry.jsonl',
    'corpus/selection.json',
  ])('the file PRD §21 names exists: %s', (relative) => {
    // The tree assertion above checks directories only, so every file §21 lists
    // could be absent and it would still pass.
    expect(existsSync(join(STUDY_ROOT, relative)), `${relative} is missing`).toBe(true);
  });

  it.each(['blog', 'social-post', 'search-snippet', 'secondary-explainer', 'ai-summary', 'preprint-mirror'])(
    'source lock refuses the banned kind %s',
    (kind) => {
      // §2.1 bans four kinds by name and the enum is an allowlist, so anything
      // outside it is refused — but only one was ever asserted, which does not
      // distinguish an allowlist from a single-item denylist.
      expect(
        sourceLock({
          schema_version: 1,
          sources: [
            {
              source_id: 'LIT-A',
              title: 'T',
              source_kind: kind,
              identifier: 'x',
              version: 'v1',
              downloaded_at: '2026-08-20T00:00:00Z',
              sha256: 'a'.repeat(64),
            },
          ],
        }),
      ).toBe(false);
    },
  );
});
