/**
 * #1023: the diff is bounded and reported, and verify no longer needs it echoed.
 *
 * The harvest prompt windowed the **transcript** with a byte budget and reported
 * what it showed, and embedded the **diff** whole with no budget and no notice.
 * On a 65-file feature branch that made the prompt 200,071 characters of which
 * the diff was 190,300 — ninety-five per cent, and thirty-four times the size of
 * the whole transcript beside it, which the windowing machinery had measured at
 * forty-six times *under* its own budget and said so in `transcript_window`. The
 * result overran the client's token limit and capture could not proceed.
 *
 * ## The echo
 *
 * `verify_capture` then required the same diff sent back byte for byte to
 * re-hash — asking a model to reproduce ~190,000 characters the server itself
 * produced, with zero drift. The server read the repository to make that diff
 * and can read it again; the stored hash still decides either way.
 *
 * ## What the windowing costs, said plainly
 *
 * A record can only quote what the model was shown, so a decision about a hunk
 * outside the window cannot be recorded — the same trade the transcript budget
 * already makes, and `r-guardwindow884` records for the guard. The notice says
 * so in the prompt rather than leaving the model to infer it.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { prepareCaptureContext } from '../src/core/capture-prepare.js';
import { verifyCaptureRecords } from '../src/core/capture-verify.js';
import { buildHarvestPromptWithWindow } from '../src/core/harvest.js';
import { readPending } from '../src/core/pending.js';

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = [
  '-c',
  'user.name=CommitLore Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

const git = (dir: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });

const TRANSCRIPT =
  'We chose sha256 because it is the standard hash function for integrity checking.';

const bigDiff = (lines: number): string =>
  Array.from({ length: lines }, (_, index) => `+const line${String(index)} = ${String(index)};`).join('\n');

describe('#1023 the prompt bounds the diff the way it bounds the transcript', () => {
  it('cuts a large diff to the budget and keeps the end of it', () => {
    const diff = bigDiff(6000);
    const { prompt, diffWindow } = buildHarvestPromptWithWindow({ transcript: TRANSCRIPT, diff });

    expect(diffWindow.total_bytes).toBe(Buffer.byteLength(diff, 'utf8'));
    expect(diffWindow.truncated).toBe(true);
    expect(diffWindow.window_bytes).toBeLessThan(diffWindow.total_bytes);

    // The tail, because a diff is read for what changed and the end of
    // `git diff --cached` is what was staged most recently.
    expect(prompt).toContain('line5999');
    expect(prompt).not.toContain('line0 = 0;');
  }, 300_000);

  it('tells the model what it is not being shown', () => {
    // Silent truncation is the failure the transcript notice already exists to
    // prevent: a model that does not know it is seeing a window will cite what
    // it cannot see, and the record is dropped at verification with no
    // explanation the model can act on.
    const { prompt } = buildHarvestPromptWithWindow({ transcript: TRANSCRIPT, diff: bigDiff(6000) });
    expect(prompt).toContain('This is the end of the diff');
    expect(prompt).toContain('Cite only what you can see here');
  }, 300_000);

  it('leaves a small diff whole and says it was not cut', () => {
    // The control. A budget that always truncated would satisfy both cases
    // above and hide most of every ordinary change.
    const diff = '+const a = 1;\n+const b = 2;\n';
    const { prompt, diffWindow } = buildHarvestPromptWithWindow({ transcript: TRANSCRIPT, diff });

    expect(diffWindow.truncated).toBe(false);
    expect(diffWindow.window_bytes).toBe(diffWindow.total_bytes);
    expect(prompt).toContain('+const a = 1;');
    expect(prompt).not.toContain('This is the end of the diff');
  }, 300_000);
});

describe('#1023 verify reads the staged diff rather than requiring it back', () => {
  const prepared = (): { cwd: string; nonce: string; diff: string } => {
    const cwd = mkdtempSync(join(tmpdir(), 'commitlore-diffwin-'));
    temporaries.push(cwd);
    git(cwd, ['init', '-q', '--initial-branch=main']);
    writeFileSync(join(cwd, 'init.txt'), 'initial content\n');
    git(cwd, ['add', '-A']);
    git(cwd, [...IDENTITY, 'commit', '-q', '--no-verify', '-m', 'init\n\nno record here\n']);
    writeFileSync(join(cwd, 'init.txt'), 'initial content\nmodified\n');
    git(cwd, ['add', '-A']);
    const { nonce } = prepareCaptureContext({ cwd, transcript: TRANSCRIPT });
    return { cwd, nonce, diff: git(cwd, ['diff', '--cached']) };
  };

  const DRAFT = [
    {
      trailers: [
        { key: 'Limit', value: 'use sha256 for integrity checking' },
        { key: 'Record-Id', value: 'r-diffwindow1' },
      ],
      evidence: [
        {
          key: 'Limit',
          source: 'transcript' as const,
          quote: 'chose sha256 because it is the standard hash function for integrity checking',
          locator: 'L1-L1',
        },
      ],
    },
  ];

  it('verifies with no diff sent at all', () => {
    const { cwd, nonce } = prepared();

    const result = verifyCaptureRecords({ nonce, draft: DRAFT, transcript: TRANSCRIPT, cwd });

    expect(result.accepted, `refused: ${JSON.stringify(result.rejected)}`).toHaveLength(1);
    expect(result.source_mismatch).toBeUndefined();
    expect(readPending(nonce, { cwd })?.phase).toBe('verified');
  }, 300_000);

  it('still checks the hash, so a moved index is caught without an echo', () => {
    // The guarantee the echo was carrying. Reading the diff rather than being
    // told it does not weaken this: the hash `prepare` stored still decides.
    const { cwd, nonce } = prepared();
    writeFileSync(join(cwd, 'init.txt'), 'initial content\nmodified\nagain\n');
    git(cwd, ['add', '-A']);

    const result = verifyCaptureRecords({ nonce, draft: DRAFT, transcript: TRANSCRIPT, cwd });
    expect(result.source_mismatch).toBe('diff');
    expect(readPending(nonce, { cwd })?.phase).toBe('prepared');
  }, 300_000);

  it('still accepts a diff a caller does send', () => {
    // `capture --diff` exists so a caller can assert the bytes it holds, which
    // is a stronger statement than the server asserting them to itself.
    const { cwd, nonce, diff } = prepared();

    const result = verifyCaptureRecords({ nonce, draft: DRAFT, transcript: TRANSCRIPT, diff, cwd });
    expect(result.accepted).toHaveLength(1);
  }, 300_000);

  it('reports a nonce that names no transaction as such', () => {
    // Found because this change removed the check that was covering it: an
    // unknown nonce came back as `validation_result: "empty"` with nothing
    // saying why, which is the ordinary "nothing survived" outcome.
    const { cwd } = prepared();

    const result = verifyCaptureRecords({
      nonce: 'a'.repeat(32),
      draft: [],
      transcript: TRANSCRIPT,
      cwd,
    });
    expect(result.no_transaction).toBe(true);
    expect(result.incomplete).toBe(true);
  }, 300_000);
});
