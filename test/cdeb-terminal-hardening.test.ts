import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assertMeasuredRunAuthorized, resolveActiveStudyRoot } from '../bench/cdeb/active-study.js';
import { INVALIDATED } from '../bench/cdeb/lifecycle.js';
import {
  appendTransition,
  buildTransitionArtifact,
  currentState,
  digestTransitionArtifacts,
} from '../bench/cdeb/ledger.js';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = resolve(HERE, '..');
const CDEB_ROOT = join(ROOT, 'bench', 'cdeb');
const STUDY = join(CDEB_ROOT, 'studies', 'cdeb-fresh-v3r1');
const MATRIX_JSON = join(STUDY, 'literature', 'evidence-matrix.json');
const MATRIX_MD = join(STUDY, 'literature', 'evidence-matrix.md');
const MATRIX_SCRIPT = join(ROOT, 'scripts', 'render-evidence-matrix.mjs');

const draft = (overrides: Record<string, unknown> = {}) => ({
  from: 'DRAFT',
  to: 'INVALIDATED',
  timestamp: '2026-08-21T20:16:31Z',
  actor_role: 'OWNER',
  checks: ['terminal test'],
  deviations: [],
  input_artifacts: ['study.json', 'input.txt'],
  output_artifacts: ['study.json', 'output.txt'],
  ...overrides,
});

const tempStudy = (): string => {
  const study = mkdtempSync(join(tmpdir(), 'cdeb-terminal-'));
  mkdirSync(join(study, 'corpus'), { recursive: true });
  writeFileSync(join(study, 'study.json'), '{"study_id":"cdeb-terminal-test"}\n');
  writeFileSync(join(study, 'transitions.jsonl'), '');
  writeFileSync(join(study, 'input.txt'), 'input\n');
  writeFileSync(join(study, 'output.txt'), 'output\n');
  return study;
};

const runMatrix = (arguments_: readonly string[]): string => execFileSync(process.execPath, [MATRIX_SCRIPT, ...arguments_], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

describe('CDEB terminal hardening', () => {
  it('keeps the terminal study terminal for pilot, frozen, and running destinations', () => {
    const before = readFileSync(join(STUDY, 'transitions.jsonl'), 'utf8');
    for (const to of ['PILOT_FROZEN', 'CONFIRMATORY_FROZEN', 'RUNNING'] as const) {
      const proposed = buildTransitionArtifact(STUDY, draft({ from: INVALIDATED, to, input_artifacts: ['study.json'], output_artifacts: ['study.json'] }));
      expect(() => appendTransition(STUDY, proposed)).toThrow(`INVALIDATED to ${to}`);
    }
    expect(readFileSync(join(STUDY, 'transitions.jsonl'), 'utf8')).toBe(before);
  });

  it('fails closed with no active study and refuses the empty, unseeded measured-run path', () => {
    expect(() => resolveActiveStudyRoot(CDEB_ROOT)).toThrow(/No active CDEB study/);
    expect(() => assertMeasuredRunAuthorized(STUDY)).toThrow(/measured_run_allowed is not true; selection is empty; selection seed is null/);
  });

  it('refuses caller-supplied digests that do not bind the canonical artifacts', () => {
    const study = tempStudy();
    const proposed = buildTransitionArtifact(study, draft());
    expect(() => appendTransition(study, { ...proposed, input_digest: 'a'.repeat(64) })).toThrow(/input_digest does not match canonical artifacts/);
    expect(readFileSync(join(study, 'transitions.jsonl'), 'utf8')).toBe('');
  });

  it('hashes sorted artifact paths, detects byte mutations, refuses missing files and foreign study artifacts', () => {
    const study = tempStudy();
    writeFileSync(join(study, 'a.txt'), 'one\n');
    writeFileSync(join(study, 'b.txt'), 'two\n');
    const ordered = digestTransitionArtifacts(study, ['a.txt', 'b.txt']);
    expect(digestTransitionArtifacts(study, ['b.txt', 'a.txt'])).toBe(ordered);
    writeFileSync(join(study, 'a.txt'), 'changed\n');
    expect(digestTransitionArtifacts(study, ['a.txt', 'b.txt'])).not.toBe(ordered);
    expect(() => digestTransitionArtifacts(study, ['missing.txt'])).toThrow(/Missing transition artifact missing.txt/);
    writeFileSync(join(study, 'foreign.json'), '{"study_id":"another-study"}\n');
    expect(() => digestTransitionArtifacts(study, ['foreign.json'])).toThrow(/Mixed-study refusal/);
  });

  it('reads the historical placeholder row but refuses an equivalent unbound new append', () => {
    expect(currentState(STUDY)).toBe(INVALIDATED);
    const historical = JSON.parse(readFileSync(join(STUDY, 'transitions.jsonl'), 'utf8').split('\n')[0]!) as Record<string, unknown>;
    const study = tempStudy();
    expect(() => appendTransition(study, historical)).toThrow(/canonical input_artifacts and output_artifacts bindings/);
  });

  it('renders the evidence matrix deterministically and refuses malformed or unknown verdict input', () => {
    runMatrix(['--check', '--input', MATRIX_JSON, '--output', MATRIX_MD]);
    const markdown = readFileSync(MATRIX_MD, 'utf8');
    const matrix = JSON.parse(readFileSync(MATRIX_JSON, 'utf8')) as { claims: Array<{ status: string }> };
    const resolved = matrix.claims.filter((claim) => claim.status === 'resolved').length;
    expect(markdown).toContain(`Total claims: ${String(matrix.claims.length)}`);
    expect(markdown).toContain(`Resolved: ${String(resolved)}`);
    expect(markdown).toContain('Unresolved: 0');
    expect(markdown).toContain('## ADR-01');
    expect(markdown).toContain('Adjudication reasoning:');
    expect(markdown).toContain('Scope note:');

    const directory = mkdtempSync(join(tmpdir(), 'cdeb-matrix-'));
    const input = join(directory, 'matrix.json');
    const output = join(directory, 'matrix.md');
    writeFileSync(input, '{"schema_version":1,"study_id":"test","claims":[{"claim_id":"C-1","claim_text":"x","source_id":"S-1","verdict":"UNKNOWN","scope_note":"n","status":"resolved"}]}\n');
    expect(() => runMatrix(['--input', input, '--output', output])).toThrow(/unknown verdict UNKNOWN/);
    writeFileSync(input, '{not json}\n');
    expect(() => runMatrix(['--input', input, '--output', output])).toThrow(/invalid JSON/);
  });

  it('keeps PRD, active-study, status, and successor artifacts consistent about terminality', () => {
    const prd = readFileSync(join(CDEB_ROOT, 'PRD.md'), 'utf8').split('\n').slice(0, 40).join('\n');
    const active = JSON.parse(readFileSync(join(CDEB_ROOT, 'ACTIVE-STUDY.json'), 'utf8')) as Record<string, unknown>;
    const status = JSON.parse(readFileSync(join(STUDY, 'STATUS.json'), 'utf8')) as Record<string, unknown>;
    const successor = readFileSync(join(STUDY, 'SUCCESSOR.md'), 'utf8');
    expect(prd).toContain('status: terminal-preserved');
    expect(prd).toContain('must not be used to resume `cdeb-fresh-v3r1`');
    expect(active).toMatchObject({ active_study_id: null, last_terminal_study_id: 'cdeb-fresh-v3r1', status: 'no-active-study', successor_requires_new_study_id: true });
    expect(status).toMatchObject({ phase: 'invalidated', measured_run_allowed: false });
    expect(successor).toContain('new study id');
    expect(successor).toContain('new preregistration');
  });
});
