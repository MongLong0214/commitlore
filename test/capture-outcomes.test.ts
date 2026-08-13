/**
 * #543: capture's typed outcome, exit codes, and a parseable `--json`
 * envelope on every path — including failure.
 *
 * The defect this replaces: a pending-write failure, a git invocation
 * failure, and a staging invariant all exited 0 with no JSON. Automation
 * could not tell "nothing was worth recording" from "the pipeline broke".
 *
 * These cases go through the built CLI. A test that still passes after the
 * old catch (`process.exitCode = 0` and no envelope) is restored is not
 * covering the defect.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

import { afterAll, describe, expect, it } from 'vitest';

import {
  classifyCaptureError,
  exitCodeForCaptureOutcome,
  markCaptureError,
} from '../src/core/capture-outcome.js';
import { execGitOrThrow, isGitFailure } from '../src/core/git.js';
import { createTestRepo } from './git-fixtures.js';

const CLI = join(__dirname, '..', 'dist', 'commitlore.mjs');

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-outcome-'));
  temporaries.push(dir);
  createTestRepo({ path: dir });
  writeFileSync(join(dir, 'init.txt'), 'initial content\n');
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "init" --no-verify --quiet', { cwd: dir });
  writeFileSync(join(dir, 'init.txt'), 'initial content\nmodified\n');
  execSync('git add .', { cwd: dir });
  return dir;
};

const writeInputs = (
  cwd: string,
  draft: unknown,
  transcript = 'We chose sha256 because it is the standard hash. The timeout stays at 5s.',
): { transcript: string; draft: string } => {
  const transcriptPath = join(cwd, 'transcript.txt');
  const draftPath = join(cwd, 'draft.json');
  writeFileSync(transcriptPath, transcript);
  writeFileSync(draftPath, JSON.stringify(draft));
  return { transcript: transcriptPath, draft: draftPath };
};

const runCli = (
  args: string[],
  cwd: string,
): { status: number; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [CLI, 'capture', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

const parseEnvelope = (stdout: string): { outcome: string; staged: boolean; rejected?: unknown[]; error?: string } => {
  expect(stdout.trim(), `expected a JSON envelope, got ${JSON.stringify(stdout)}`).not.toBe('');
  return JSON.parse(stdout) as { outcome: string; staged: boolean; rejected?: unknown[]; error?: string };
};

const validRecord = (id: string, key: 'Limit' | 'Warn', value: string, quote: string) => ({
  trailers: [
    { key, value },
    { key: 'Record-Id', value: id },
  ],
  evidence: [{ key, source: 'transcript', quote, locator: 'L1-L1' }],
});

describe('classifyCaptureError (#543)', () => {
  it('maps a marked kind, a git failure, an unmarked errno, and an unmarked Error', () => {
    expect(classifyCaptureError(markCaptureError(new Error('no file'), 'usage'))).toBe('usage');
    expect(classifyCaptureError(markCaptureError(new Error('off'), 'rejected'))).toBe('rejected');
    expect(classifyCaptureError(markCaptureError(new Error('disk'), 'operational'))).toBe('operational');
    expect(classifyCaptureError(markCaptureError(new Error('bug'), 'internal'))).toBe('internal');

    try {
      execGitOrThrow(['rev-parse', '--verify', 'not-a-ref-zzzz'], { cwd: tmpdir() });
      throw new Error('expected git to fail');
    } catch (error) {
      expect(isGitFailure(error)).toBe(true);
      expect(classifyCaptureError(error)).toBe('operational');
    }

    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    expect(classifyCaptureError(enoent)).toBe('operational');
    expect(classifyCaptureError(new Error('something we did not name'))).toBe('internal');
    expect(classifyCaptureError('a string throw')).toBe('internal');
  });

  it('maps outcomes to the exits validate already shares for 2 and 3', () => {
    expect(exitCodeForCaptureOutcome('staged')).toBe(0);
    expect(exitCodeForCaptureOutcome('empty')).toBe(0);
    expect(exitCodeForCaptureOutcome('rejected')).toBe(0);
    expect(exitCodeForCaptureOutcome('usage')).toBe(2);
    expect(exitCodeForCaptureOutcome('operational')).toBe(3);
    expect(exitCodeForCaptureOutcome('internal')).toBe(4);
  });
});

describe('commitlore capture outcomes (#543)', () => {
  it('empty: prompt-only exits 0 and names the outcome in JSON', () => {
    const cwd = makeRepo();
    const { transcript } = writeInputs(cwd, { records: [] });
    const result = runCli(['--transcript', transcript, '--json'], cwd);

    expect(result.status).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.outcome).toBe('empty');
    expect(envelope.staged).toBe(false);
  });

  it('rejected: a draft verification refusal exits 0 with a structured reason', () => {
    const cwd = makeRepo();
    const { transcript, draft } = writeInputs(cwd, {
      records: [
        validRecord(
          'r-reject54301',
          'Limit',
          'use md5',
          'this quote is not in the transcript at all',
        ),
      ],
    });
    const result = runCli(['--transcript', transcript, '--draft', draft, '--json'], cwd);

    expect(result.status).toBe(0);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.outcome).toBe('rejected');
    expect(envelope.staged).toBe(false);
    expect(Array.isArray(envelope.rejected)).toBe(true);
    expect((envelope.rejected ?? []).length).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/discarded record/);
  });

  it('usage: a missing caller file exits 2 and still emits JSON', () => {
    const cwd = makeRepo();
    const result = runCli(['--transcript', join(cwd, 'no-such-transcript.txt'), '--json'], cwd);

    expect(result.status).toBe(2);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.outcome).toBe('usage');
    expect(envelope.staged).toBe(false);
    expect(envelope.error).toMatch(/no-such-transcript/);
  });

  it('operational: a git failure exits 3, not 0, and emits a parseable envelope', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'capture-nongit-'));
    temporaries.push(cwd);
    const transcript = join(cwd, 'transcript.txt');
    writeFileSync(transcript, 'a decision was made\n');
    const result = runCli(['--transcript', transcript, '--json'], cwd);

    expect(result.status).toBe(3);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.outcome).toBe('operational');
    expect(envelope.staged).toBe(false);
    expect(typeof envelope.error).toBe('string');
    expect(envelope.error ?? '').not.toBe('');
  });

  it('operational: a pending-write failure exits 3 with JSON, not silent 0', () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, '.git', 'commitlore'), 'this is a file, so pending cannot be a directory\n');
    const { transcript, draft } = writeInputs(cwd, {
      records: [
        validRecord(
          'r-write54301',
          'Limit',
          'use sha256 for integrity checking',
          'chose sha256 because it is the standard hash',
        ),
      ],
    });
    const result = runCli(['--transcript', transcript, '--draft', draft, '--json'], cwd);

    expect(result.status).toBe(3);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.outcome).toBe('operational');
    expect(envelope.staged).toBe(false);
  });

  it('internal: a staging invariant exits 4 with JSON, not silent 0', () => {
    const cwd = makeRepo();
    const { transcript, draft } = writeInputs(cwd, {
      records: [
        validRecord(
          'r-inv543aaa',
          'Limit',
          'use sha256 for integrity checking',
          'chose sha256 because it is the standard hash',
        ),
        validRecord('r-inv543bbb', 'Warn', 'the timeout stays at 5s', 'The timeout stays at 5s'),
      ],
    });
    const result = runCli(['--transcript', transcript, '--draft', draft, '--json'], cwd);

    expect(result.status).toBe(4);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.outcome).toBe('internal');
    expect(envelope.staged).toBe(false);
    expect(envelope.error).toMatch(/max_records_per_commit/);
  });

  it('capture --help documents the exit codes', () => {
    const result = spawnSync(process.execPath, [CLI, 'capture', '--help'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Exit codes:/);
    expect(result.stdout).toMatch(/\b0\b/);
    expect(result.stdout).toMatch(/\b2\b/);
    expect(result.stdout).toMatch(/\b3\b/);
    expect(result.stdout).toMatch(/\b4\b/);
    expect(result.stdout).toMatch(/operational/);
    expect(result.stdout).toMatch(/internal/);
  });
});

describe('source: the old silence is gone', () => {
  it('the capture action no longer assigns exit 0 to an unclassified failure', () => {
    // Teeth: if someone restores `process.exitCode = 0` in the failure path,
    // this fails before a caller has to discover it in production.
    const source = readFileSync(join(__dirname, '..', 'src/commands/capture.ts'), 'utf8');
    expect(source).not.toMatch(/process\.exitCode = 0;\s*\/\/ every other failure/);
    expect(source).not.toMatch(/Pipeline errors \(verification failure, staging failure\) → exit 0/);
    expect(source).toContain('emitCaptureOutcome');
    expect(source).toContain('classifyCaptureError');
  });
});
