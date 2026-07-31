/**
 * #309: `capture --draft` and `harvest --draft` reject a malformed draft for the
 * same reason. `harvest` tells you the reason. `capture` printed `no record
 * staged` and exited 0.
 *
 * The diagnostic already existed and was already computed inside `capture` — from
 * `parseDraft` for a shape problem, and from `verifyCaptureRecords` for an
 * evidence problem — and was thrown away before it reached the caller.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runCapture } from '../src/commands/capture.js';

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

/** A repository with one commit and something staged, plus the draft files. */
const stagedRepo = (draft: string): { cwd: string; transcript: string; draft: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-309-'));
  scratch.push(dir);
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', ...args], { cwd: dir });
  };
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '--quiet', '-m', 'seed');
  writeFileSync(join(dir, 'a.txt'), 'a\nb\n');
  git('add', 'a.txt');
  const transcript = join(dir, 'tr.txt');
  writeFileSync(transcript, 'the timeout stays at 5s: 3s flaked on cold cache\n');
  const draftPath = join(dir, 'draft.json');
  writeFileSync(draftPath, draft);
  return { cwd: dir, transcript, draft: draftPath };
};

describe('#309 capture reports why a draft record was rejected', () => {
  it('reports an unknown-field rejection, the way harvest does', () => {
    // The report's exact draft: a shape nothing in the vocabulary accepts.
    const { cwd, transcript, draft } = stagedRepo(
      JSON.stringify({
        records: [
          {
            kind: 'limit',
            text: 'the timeout stays at 5s: 3s flaked on cold cache',
            paths: ['a.txt'],
            certainty: 'verified',
          },
        ],
      }),
    );
    const result = runCapture({ transcriptPath: transcript, draftPath: draft, cwd });
    expect(result.staged).toBe(false);
    expect(result.rejected).toBeDefined();
    expect(result.rejected!.length).toBeGreaterThan(0);
    const detail = result.rejected!.map((r) => `${r.rule}: ${r.detail}`).join('\n');
    expect(detail).toMatch(/unknown-field|unknown field/i);
    expect(detail).toMatch(/certainty|kind|paths|text/);
  });

  it('reports a verification rejection with its reason', () => {
    // Well-shaped trailers, but the evidence cites nothing in the transcript.
    const { cwd, transcript, draft } = stagedRepo(
      JSON.stringify({
        records: [
          {
            trailers: [{ key: 'Limit', value: 'something nobody said' }],
            evidence: [
              {
                key: 'Limit',
                source: 'transcript',
                quote: 'a quote that does not appear anywhere',
                locator: 'L1-L1',
              },
            ],
          },
        ],
      }),
    );
    const result = runCapture({ transcriptPath: transcript, draftPath: draft, cwd });
    expect(result.staged).toBe(false);
    expect(result.rejected).toBeDefined();
    expect(result.rejected!.length).toBeGreaterThan(0);
    expect(result.rejected!.map((r) => r.reason ?? r.rule).join(' ')).not.toBe('');
  });

  it('reports nothing rejected when the draft is accepted', () => {
    const { cwd, transcript, draft } = stagedRepo(
      JSON.stringify({
        records: [
          {
            trailers: [{ key: 'Limit', value: 'the timeout stays at 5s' }],
            evidence: [
              {
                key: 'Limit',
                source: 'transcript',
                quote: 'the timeout stays at 5s',
                locator: 'L1-L1',
              },
            ],
          },
        ],
      }),
    );
    const result = runCapture({ transcriptPath: transcript, draftPath: draft, cwd });
    expect(result.rejected ?? []).toEqual([]);
  });
});
