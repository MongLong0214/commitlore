/**
 * #873: `capture` embedded the transcript in the prompt whole, so the prompt
 * was the session. Measured by the reporter: a 67,981,436-byte transcript
 * produced a 67,468,122-byte prompt — 99.3% of the file, and larger than any
 * model can read. The pipeline itself was fine; the reporter confirmed that by
 * slicing the transcript to `tail -n 400` (537,250 bytes) and watching the same
 * command work.
 *
 * That made the failure worse than a size: it is silent. Prompt-only mode
 * returns `outcome: "empty"`, `staged: false`, **exit 0**, so an operator who
 * tried capture once on a real session got a prompt they could not use and no
 * statement that anything was wrong. In the repository where it was measured,
 * `stale` reported 1 record in 1000 commits with unattended capture already
 * enabled — permission was never the obstacle.
 *
 * Three properties are load-bearing here, and each has a test below that fails
 * when its half of the fix is reverted:
 *
 * 1. The prompt is bounded, whatever the transcript weighs.
 * 2. The line numbers in that window are the *whole transcript's* numbers.
 *    Verification reads the whole transcript, so a window renumbered from 1
 *    would have every locator name a different line of the file it is checked
 *    against.
 * 3. The caller is told it received a window. The old prompt was the session,
 *    so nothing downstream had any reason to ask; a bounded prompt that does
 *    not say so is the same silence in a smaller package.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { prepareCaptureContext } from '../src/core/capture-prepare.js';
import { verifyCaptureRecords } from '../src/core/capture-verify.js';
import { buildHarvestPromptWithWindow, windowTranscript, type DraftRecord } from '../src/core/harvest.js';

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const makeRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-prompt-budget-'));
  scratch.push(dir);
  execSync('git init --quiet --initial-branch=main', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config commit.gpgsign false', { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'hello\n');
  execSync('git add a.txt', { cwd: dir });
  execSync('git commit -m "init" --quiet', { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'hello\nworld\n');
  execSync('git add a.txt', { cwd: dir });
  return dir;
};

/** A transcript of `lines` numbered lines, each recognisable by its own number. */
const transcriptOf = (lines: number, padTo = 0): string =>
  Array.from({ length: lines }, (_, index) => {
    const body = `line ${index + 1} of the session`;
    return padTo > body.length ? body + ' '.repeat(padTo - body.length) : body;
  }).join('\n');

const DIFF = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n';

describe('#873 windowTranscript bounds what the prompt can carry', () => {
  it('is the whole transcript, unmarked, when the whole transcript fits', () => {
    const transcript = transcriptOf(20);
    const { text, window } = windowTranscript(transcript, 64 * 1024);

    expect(text).toBe(transcript);
    expect(window.truncated).toBe(false);
    expect(window.first_line).toBe(1);
    expect(window.last_line).toBe(20);
    expect(window.total_lines).toBe(20);
    expect(window.first_line_partial).toBe(false);
  });

  it('keeps the end of a transcript that does not fit, within the budget', () => {
    const transcript = transcriptOf(5000);
    const { text, window } = windowTranscript(transcript, 4096);

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(4096);
    expect(window.truncated).toBe(true);
    expect(window.last_line).toBe(5000);
    expect(window.total_lines).toBe(5000);
    expect(window.first_line).toBeGreaterThan(1);
    // The end, not the beginning: the decision is taken where the session ends.
    expect(text.endsWith('line 5000 of the session')).toBe(true);
    expect(text.startsWith(`line ${window.first_line} of the session`)).toBe(true);
    expect(window.total_bytes).toBe(Buffer.byteLength(transcript, 'utf8'));
    expect(window.window_bytes).toBe(Buffer.byteLength(text, 'utf8'));
  });

  it('shows the tail of one line that outruns the budget by itself', () => {
    // A single JSONL line can hold an entire tool result. A window of no lines
    // at all would be worse than a window of one partial line.
    const transcript = `first\n${'x'.repeat(20_000)}`;
    const { text, window } = windowTranscript(transcript, 1024);

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(1024);
    expect(window.first_line).toBe(2);
    expect(window.last_line).toBe(2);
    expect(window.first_line_partial).toBe(true);
    expect(window.truncated).toBe(true);
  });

  it('never leaves a split codepoint at the front of a partial line', () => {
    // Slicing a UTF-8 buffer mid-character yields U+FFFD, and a replacement
    // character inside a quotable line is a character nobody can copy back.
    const transcript = '한'.repeat(4000);
    const { text } = windowTranscript(transcript, 1000);

    expect(text.startsWith('�')).toBe(false);
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(1000);
  });

  it('honours COMMITLORE_TRANSCRIPT_BUDGET_BYTES', () => {
    const previous = process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'];
    process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'] = '2048';
    try {
      const { window } = windowTranscript(transcriptOf(5000));
      expect(window.window_bytes).toBeLessThanOrEqual(2048);
      expect(window.truncated).toBe(true);
    } finally {
      if (previous === undefined) delete process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'];
      else process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'] = previous;
    }
  });
});

describe('#873 the prompt numbers the window as the transcript numbers it', () => {
  const budgeted = (lines: number): ReturnType<typeof buildHarvestPromptWithWindow> => {
    const previous = process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'];
    process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'] = '4096';
    try {
      return buildHarvestPromptWithWindow({ transcript: transcriptOf(lines), diff: DIFF });
    } finally {
      if (previous === undefined) delete process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'];
      else process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'] = previous;
    }
  };

  it('gives the window\'s first line its number in the whole transcript', () => {
    const { prompt, window } = budgeted(5000);

    // The exact property a renumbered window would break: the line the prompt
    // labels N really is line N of the transcript verification will read.
    expect(prompt).toContain(`${window.first_line} | line ${window.first_line} of the session`);
    expect(prompt).toContain(`${window.last_line} | line ${window.last_line} of the session`);
    expect(prompt).not.toContain('1 | line 1 of the session');
  });

  it('says it is a window, and how much was left out', () => {
    const { prompt, window } = budgeted(5000);

    expect(prompt).toContain(`lines ${window.first_line}-${window.last_line} of ${window.total_lines}`);
    expect(prompt).toContain('earlier line(s) omitted to bound this prompt');
  });

  it('says nothing about a window when there is no window', () => {
    const { prompt } = buildHarvestPromptWithWindow({ transcript: transcriptOf(5), diff: DIFF });

    expect(prompt).not.toContain('omitted to bound this prompt');
    expect(prompt).toContain('1 | line 1 of the session');
  });
});

describe('#873 capture returns a prompt a model can read, and says what it is', () => {
  const previous = process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'];
  afterEach(() => {
    if (previous === undefined) delete process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'];
    else process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'] = previous;
  });

  it('does not return a prompt the size of the transcript', () => {
    // The reporter's ratio, at a size a test can afford: the prompt used to be
    // ~99.3% of the transcript, so it grew without bound with the session.
    const cwd = makeRepo();
    process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'] = '8192';
    const transcript = transcriptOf(40_000, 200);

    const result = prepareCaptureContext({ cwd, transcript });

    expect(Buffer.byteLength(transcript, 'utf8')).toBeGreaterThan(4_000_000);
    expect(Buffer.byteLength(result.prompt, 'utf8')).toBeLessThan(64 * 1024);
    expect(result.transcript_window.truncated).toBe(true);
    expect(result.transcript_window.total_lines).toBe(40_000);
    expect(result.transcript_window.last_line).toBe(40_000);
  });

  it('hashes and verifies the whole transcript, not the window', () => {
    // The bound is on the prompt alone. If it ever reached the hash, `verify`
    // would be checking quotes against a slice — and a caller passing the
    // session it actually had would be told the transcript was substituted.
    const cwd = makeRepo();
    process.env['COMMITLORE_TRANSCRIPT_BUDGET_BYTES'] = '4096';
    const quote = 'we ruled out the queue worker because it loses ordering';
    const transcript = `${quote}\n${transcriptOf(5000)}`;

    const prepared = prepareCaptureContext({ cwd, transcript });
    expect(prepared.transcript_window.first_line).toBeGreaterThan(1);

    const draft: DraftRecord[] = [
      {
        trailers: [
          { key: 'Ruled-out', value: 'queue worker | loses ordering' },
          { key: 'Record-Id', value: 'r-window1' },
        ],
        evidence: [{ key: 'Ruled-out', source: 'transcript', quote, locator: 'L1-L1' }],
      },
    ];

    const verified = verifyCaptureRecords({
      nonce: prepared.nonce,
      draft,
      transcript,
      diff: execSync('git diff --cached', { cwd, encoding: 'utf8' }),
      cwd,
    });

    // The quote is on line 1, which the window does not show — and it verifies,
    // because verification never looked at the window.
    expect(verified.rejected).toHaveLength(0);
    expect(verified.accepted).toHaveLength(1);
  });
});
