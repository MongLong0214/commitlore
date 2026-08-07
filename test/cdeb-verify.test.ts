/**
 * CDEB-01 acceptance (#443, PRD §21): the recursive verifier fails on every
 * class of defect the protocol names, and passes a clean study.
 *
 * Each case drives the real `bench/cdeb/verify.mjs` as a subprocess against a
 * fixture study built in a temp directory, because the acceptance criteria are
 * about exit codes CI will see — not about functions.
 *
 * The valid-row builder is the load-bearing fixture: every failure case is the
 * valid row with exactly one thing broken, so a case that fails proves the
 * verifier caught *that* defect and not an accident of the fixture.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERIFIER = join(REPO_ROOT, 'bench', 'cdeb', 'verify.mjs');

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `cdeb-${label}-`));
  scratch.push(dir);
  return dir;
};

const HEX64 = 'a'.repeat(64);
const OID = 'b'.repeat(40);

/** A row that satisfies result.schema.json and both derived recomputations. */
const validRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema_version: 1,
  benchmark: 'cdeb-v1',
  protocol_version: '1.3.0',
  study_id: 'cdeb-test-01',
  logical_run_id: 'repo-a__task-a__on__r1',
  repository_id: 'repo-a',
  task_id: 'task-a',
  category: 'rejected-architecture',
  condition: 'commitlore-on',
  repeat: 1,
  order: 1,
  freeze_manifest_sha256: HEX64,
  sealed_task_bundle_sha256: HEX64,
  repository_bundle_sha256: HEX64,
  repository_snapshot: OID,
  base_tree_oid: OID,
  refs_digest: HEX64,
  notes_ref_digest: HEX64,
  requested_model: 'sonnet',
  observed_model_ids: ['claude-sonnet-5'],
  agent_cli_version: '3.0.0',
  agent_executable_sha256: HEX64,
  node_version: 'v24.18.0',
  node_executable_sha256: HEX64,
  agent_runtime_image_digest: `sha256:${HEX64}`,
  tool_policy_digest: HEX64,
  network_policy_digest: HEX64,
  settings_digest: HEX64,
  mcp_config_digest: HEX64,
  harness_commit: OID,
  product_commit: OID,
  dist_digest: HEX64,
  hook_proxy_sha256: HEX64,
  started_at: '2026-08-07T00:00:00Z',
  finished_at: '2026-08-07T00:10:00Z',
  stop_reason: 'completed',
  first_model_turn_observed: true,
  wall_ms: 600000,
  exposure: {
    instrumentation_complete: true,
    hook_opportunities: 2,
    proxy_executions: 2,
    expected_record_delivered: true,
    delivered_before_first_mutation: true,
    delivered_record_ids: ['r-abc123'],
    payload_sha256s: [HEX64],
    product_failures: 0,
  },
  usage: {
    input_tokens: 1000,
    output_tokens: 200,
    cache_creation_input_tokens: 300,
    cache_read_input_tokens: 500,
    total_token_volume: 2000,
    reconciled: true,
    unparsed_lines: 0,
    raw_stream_sha256: HEX64,
  },
  final_tree: {
    final_tree_oid: OID,
    canonical_diff_sha256: HEX64,
    archive_sha256: HEX64,
    workspace_status_digest: HEX64,
  },
  evaluation: {
    evaluator_image_digest: `sha256:${HEX64}`,
    evaluator_attempts: 1,
    functional_pass: true,
    rejected_decision_revived: false,
    normalized_result_sha256: HEX64,
  },
  decision_safe_success: true,
  simulated: false,
  ...overrides,
});

/** A study directory holding the given rows under rows/. */
const study = (label: string, rows: Record<string, unknown>[]): string => {
  const root = temp(label);
  const rowsDir = join(root, 'cdeb-test-01', 'rows');
  mkdirSync(rowsDir, { recursive: true });
  rows.forEach((row, index) => {
    writeFileSync(join(rowsDir, `row-${String(index)}.json`), `${JSON.stringify(row, null, 2)}\n`);
  });
  return root;
};

const verify = (root: string): { code: number; output: string } => {
  try {
    const output = execFileSync(process.execPath, [VERIFIER, root], { encoding: 'utf8' });
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string; stdout?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
};

describe('#443 the CDEB recursive verifier', () => {
  it('passes a clean study — the control every failure case depends on', () => {
    const result = verify(study('clean', [validRow()]));
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('verified clean');
  });

  it('is silent-and-zero when there are no studies at all', () => {
    const result = verify(join(temp('absent'), 'does-not-exist'));
    expect(result.code).toBe(0);
    expect(result.output).toContain('nothing to verify');
  });

  it('fails an empty study directory rather than skipping it', () => {
    const root = temp('empty');
    mkdirSync(join(root, 'cdeb-test-01'), { recursive: true });
    const result = verify(root);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/empty/);
  });

  it('fails an unknown file inside a study', () => {
    const root = study('unknown', [validRow()]);
    writeFileSync(join(root, 'cdeb-test-01', 'notes.txt'), 'stray\n');
    const result = verify(root);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/unknown entry "notes\.txt"/);
  });

  it('fails a schema-invalid nested row', () => {
    const result = verify(study('invalid', [validRow({ condition: 'commitlore-maybe' })]));
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/condition/);
  });

  it('fails a row missing the explicit benchmark discriminator', () => {
    // §21.2: CDEB classification is `benchmark: "cdeb-v1"`, never a reused
    // schema_version. A row without it is not a CDEB row and must not pass.
    const result = verify(study('nobench', [validRow({ benchmark: 'something-else' })]));
    expect(result.code).toBe(1);
  });

  it('fails when total_token_volume does not equal the raw category sum', () => {
    const row = validRow();
    (row.usage as Record<string, unknown>).total_token_volume = 1999;
    const result = verify(study('tokensum', [row]));
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/total_token_volume 1999 != raw category sum 2000/);
  });

  it('fails when decision_safe_success does not match its recomputation', () => {
    // A timeout can never be a safe success (§13.3), whatever the row claims.
    const result = verify(study('derived', [validRow({ stop_reason: 'timeout' })]));
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/decision_safe_success true != recomputed false/);
  });

  it('fails a simulated row — smoke output must never sit in a study', () => {
    const result = verify(study('simulated', [validRow({ simulated: true })]));
    expect(result.code).toBe(1);
  });

  it('fails a duplicate logical_run_id', () => {
    const result = verify(study('dup', [validRow(), validRow()]));
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/duplicate logical_run_id/);
  });

  it('fails a missing expected row, and a verdict sitting beside the gap', () => {
    const root = study('missing', [validRow()]);
    writeFileSync(
      join(root, 'cdeb-test-01', 'randomization.json'),
      `${JSON.stringify({
        expected_logical_run_ids: ['repo-a__task-a__on__r1', 'repo-a__task-a__off__r1'],
      })}\n`,
    );
    writeFileSync(join(root, 'cdeb-test-01', 'RESULT.json'), '{}\n');
    const result = verify(root);
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/repo-a__task-a__off__r1 has no row/);
    expect(result.output).toMatch(/verdict from an incomplete matrix/);
  });
});
