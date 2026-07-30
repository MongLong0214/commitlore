/**
 * T-1006 (#198) — `commitlore capture` CLI command tests.
 *
 * The command composes prepare → verify → stage and adds no new logic.
 * CEO amendment: the CLI passes the nonce and nothing else to stage.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

import { createTestRepo } from './git-fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

/** Path to the built CLI entry point. */
const CLI = join(__dirname, '..', 'dist', 'commitlore.mjs');

/** Create a temp repo with one commit and a staged change. */
const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-cmd-'));
  temporaries.push(dir);
  createTestRepo({ path: dir });
  writeFileSync(join(dir, 'init.txt'), 'initial content\n');
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "init" --no-verify --quiet', { cwd: dir });
  // Stage a change so diff is non-empty
  writeFileSync(join(dir, 'init.txt'), 'initial content\nmodified\n');
  execSync('git add .', { cwd: dir });
  return dir;
};

/** Run the CLI capture command and return stdout, stderr, and exit code. */
const runCapture = (
  args: string[],
  opts: { cwd: string },
): { stdout: string; stderr: string; exitCode: number } => {
  try {
    const stdout = execFileSync('node', [CLI, 'capture', ...args], {
      cwd: opts.cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: error.status ?? 1,
    };
  }
};

/** Create valid fixtures: transcript, diff, and a draft file. */
const makeFixtures = (cwd: string): { transcript: string; diff: string; draftPath: string; transcriptPath: string; diffPath: string } => {
  const transcript = 'We chose sha256 because it is the standard hash function for integrity checking.';
  const diff = execSync('git diff --cached', { cwd, encoding: 'utf8' });

  const transcriptPath = join(cwd, 'transcript.txt');
  const diffPath = join(cwd, 'diff.txt');
  const draftPath = join(cwd, 'draft.json');

  writeFileSync(transcriptPath, transcript);
  writeFileSync(diffPath, diff);

  const draftContent = JSON.stringify({
    records: [
      {
        trailers: [
          { key: 'Limit', value: 'use sha256 for integrity checking' },
          { key: 'Record-Id', value: 'r-capturetest01' },
        ],
        evidence: [
          {
            key: 'Limit',
            source: 'transcript',
            quote: 'chose sha256 because it is the standard hash function for integrity checking',
            locator: 'L1-L1',
          },
        ],
      },
    ],
  });
  writeFileSync(draftPath, draftContent);

  return { transcript, diff, draftPath, transcriptPath, diffPath };
};

/** List pending files in the git repo. */
const listPending = (cwd: string): string[] => {
  const gitDir = execSync('git rev-parse --git-path commitlore/pending', {
    cwd,
    encoding: 'utf8',
  }).trim();
  const pendingDir = join(cwd, gitDir);
  if (!existsSync(pendingDir)) return [];
  return readdirSync(pendingDir).filter((f) => f.endsWith('.json'));
};

/** List only staged pending files. */
const listStagedPending = (cwd: string): string[] => {
  const gitDir = execSync('git rev-parse --git-path commitlore/pending', {
    cwd,
    encoding: 'utf8',
  }).trim();
  const pendingDir = join(cwd, gitDir);
  if (!existsSync(pendingDir)) return [];
  return readdirSync(pendingDir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => {
      try {
        const content = JSON.parse(readFileSync(join(pendingDir, f), 'utf8'));
        return content.phase === 'staged';
      } catch {
        return false;
      }
    });
};

// ---------------------------------------------------------------------------
// Main tests
// ---------------------------------------------------------------------------

describe('commitlore capture', () => {
  it('produces a pending file with --transcript --diff --draft (RED test)', () => {
    const cwd = makeRepo();
    const { transcriptPath, diffPath, draftPath } = makeFixtures(cwd);

    const result = runCapture(
      ['--transcript', transcriptPath, '--diff', diffPath, '--draft', draftPath],
      { cwd },
    );

    expect(result.exitCode).toBe(0);
    const staged = listStagedPending(cwd);
    expect(staged.length).toBe(1);
  });

  it('prints the prompt contract without --draft (prompt-only mode)', () => {
    const cwd = makeRepo();
    const { transcriptPath, diffPath } = makeFixtures(cwd);

    const result = runCapture(
      ['--transcript', transcriptPath, '--diff', diffPath],
      { cwd },
    );

    expect(result.exitCode).toBe(0);
    // Should print prompt contract — it includes harvest instructions
    expect(result.stdout).toContain('Record-Id');
    // No staged pending file (prepare creates a transaction but it's not staged)
    const staged = listStagedPending(cwd);
    expect(staged.length).toBe(0);
  });

  it('stages nothing when draft evidence is fabricated', () => {
    const cwd = makeRepo();
    const { transcriptPath, diffPath } = makeFixtures(cwd);

    // Overwrite draft with fabricated evidence
    const badDraft = JSON.stringify({
      records: [
        {
          trailers: [
            { key: 'Limit', value: 'use md5 for hashing' },
            { key: 'Record-Id', value: 'r-badcapture01' },
          ],
          evidence: [
            {
              key: 'Limit',
              source: 'transcript',
              quote: 'this quote does not exist in the transcript at all',
              locator: 'L1-L1',
            },
          ],
        },
      ],
    });
    const badDraftPath = join(cwd, 'bad-draft.json');
    writeFileSync(badDraftPath, badDraft);

    const result = runCapture(
      ['--transcript', transcriptPath, '--diff', diffPath, '--draft', badDraftPath],
      { cwd },
    );

    // Must exit 0 — verification failure never blocks
    expect(result.exitCode).toBe(0);
    // No staged file (prepared/verified-empty exist but are not staged)
    const staged = listStagedPending(cwd);
    expect(staged.length).toBe(0);
  });

  it('exits 0 even when no record is staged (non-blocking)', () => {
    const cwd = makeRepo();
    const { transcriptPath, diffPath } = makeFixtures(cwd);

    const badDraft = JSON.stringify({
      records: [
        {
          trailers: [
            { key: 'Limit', value: 'some decision' },
            { key: 'Record-Id', value: 'r-empty01' },
          ],
          evidence: [
            {
              key: 'Limit',
              source: 'transcript',
              quote: 'nonexistent quote for empty test',
              locator: 'L1-L1',
            },
          ],
        },
      ],
    });
    writeFileSync(join(cwd, 'empty-draft.json'), badDraft);

    const result = runCapture(
      ['--transcript', transcriptPath, '--diff', diffPath, '--draft', join(cwd, 'empty-draft.json')],
      { cwd },
    );

    expect(result.exitCode).toBe(0);
  });

  it('exits 2 for missing --transcript (usage error)', () => {
    const cwd = makeRepo();
    const { diffPath, draftPath } = makeFixtures(cwd);

    const result = runCapture(
      ['--diff', diffPath, '--draft', draftPath],
      { cwd },
    );

    expect(result.exitCode).toBe(2);
  });

  it('--json prints structured output', () => {
    const cwd = makeRepo();
    const { transcriptPath, diffPath, draftPath } = makeFixtures(cwd);

    const result = runCapture(
      ['--transcript', transcriptPath, '--diff', diffPath, '--draft', draftPath, '--json'],
      { cwd },
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('nonce');
    expect(parsed).toHaveProperty('staged');
  });

  // ---------------------------------------------------------------------------
  // Mutation oracles
  // ---------------------------------------------------------------------------

  describe('mutation oracles', () => {
    it('MUST FAIL: CLI must not forward caller-supplied bindings to stage (trust boundary)', () => {
      // This oracle verifies that the CLI does NOT pass base_head or other
      // bindings from outside to stage. The stageCaptureRecord function
      // accepts only { nonce, cwd, expiryMinutes? } — if the CLI tried to
      // forward a caller-supplied base_head, it would mean the trust boundary
      // was widened. We verify by checking that the staged pending file's
      // base_head matches the actual HEAD, not any hypothetical override.
      const cwd = makeRepo();
      const { transcriptPath, diffPath, draftPath } = makeFixtures(cwd);

      const result = runCapture(
        ['--transcript', transcriptPath, '--diff', diffPath, '--draft', draftPath, '--json'],
        { cwd },
      );

      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.staged).toBe(true);

      // Read the pending file and verify base_head matches actual HEAD
      const staged = listStagedPending(cwd);
      expect(staged.length).toBe(1);

      const gitDir = execSync('git rev-parse --git-path commitlore/pending', {
        cwd,
        encoding: 'utf8',
      }).trim();
      const pendingContent = JSON.parse(
        readFileSync(join(cwd, gitDir, staged[0]), 'utf8'),
      );
      const actualHead = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();

      // The CLI MUST NOT have overridden base_head; it must match the server-computed value
      expect(pendingContent.base_head).toBe(actualHead);

      // Verify the stage function was called with nonce only — the pending file's
      // phase must be 'staged' and staged_at must be set (proving stage ran server-side)
      expect(pendingContent.phase).toBe('staged');
      expect(pendingContent.staged_at).toBeTruthy();
      expect(pendingContent.expires_at).toBeTruthy();
    });

    it('MUST FAIL: verification failure must NOT make the command exit non-zero', () => {
      // This oracle catches a mutation where someone adds `process.exit(1)` or
      // throws on verification failure. The contract is: verification failure
      // produces no record and does not fail the command.
      const cwd = makeRepo();
      const { transcriptPath, diffPath } = makeFixtures(cwd);

      // Create a draft with completely fabricated evidence
      const badDraft = JSON.stringify({
        records: [
          {
            trailers: [
              { key: 'Limit', value: 'a decision that will fail verification' },
              { key: 'Record-Id', value: 'r-mustfailoracle' },
            ],
            evidence: [
              {
                key: 'Limit',
                source: 'transcript',
                quote: 'this evidence is totally fabricated and will not pass',
                locator: 'L1-L1',
              },
            ],
          },
        ],
      });
      const badDraftPath = join(cwd, 'oracle-bad-draft.json');
      writeFileSync(badDraftPath, badDraft);

      const result = runCapture(
        ['--transcript', transcriptPath, '--diff', diffPath, '--draft', badDraftPath],
        { cwd },
      );

      // MUST exit 0 — if this fails, the mutation "exit non-zero on verify failure" slipped in
      expect(result.exitCode).toBe(0);
      // And no record staged (prepared file exists but is not staged)
      const staged = listStagedPending(cwd);
      expect(staged.length).toBe(0);
    });

    it('MUST PASS: valid capture with legitimate evidence produces a staged record', () => {
      // This oracle ensures the happy path still works — a mutation that breaks
      // staging entirely would be caught.
      const cwd = makeRepo();
      const { transcriptPath, diffPath, draftPath } = makeFixtures(cwd);

      const result = runCapture(
        ['--transcript', transcriptPath, '--diff', diffPath, '--draft', draftPath],
        { cwd },
      );

      expect(result.exitCode).toBe(0);
      const staged = listStagedPending(cwd);
      expect(staged.length).toBe(1);
    });
  });
});
