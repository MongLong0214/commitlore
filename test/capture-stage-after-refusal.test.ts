/**
 * A capture run that bound nothing must not report itself staged.
 *
 * `runCapturePipeline` verifies and then stages unconditionally, without
 * looking at the verification's result, and `stage` reads the transaction
 * *stored* under the nonce rather than what the calling verification computed.
 * That part is deliberate: the stage call is handed the nonce and nothing else,
 * so a caller cannot smuggle a diff hash or a policy identity past the
 * server-side bindings.
 *
 * What stops an empty run from staging is `stageCaptureRecord`'s own gates — it
 * refuses a stored result that is `empty` or `incomplete`. This file pins that,
 * because nothing did: the behaviour was correct and unguarded, which is the
 * state a refactor removes without noticing.
 *
 * ## What this does *not* cover, and why the distinction matters
 *
 * Review described a worse shape — a refused verification staging an *earlier
 * caller's* record, so the commit carries A while the caller was told nothing
 * of theirs was accepted. Checked, and the CLI cannot produce it: every
 * `capture` run prepares its own nonce and stages that one, so it can only ever
 * stage its own transaction, and its own is `empty` when nothing was accepted.
 *
 * The shape is reachable through the MCP tools, where the caller supplies the
 * nonce to `verify_capture` and `stage_capture` separately. There the stored
 * transaction is the *first* caller's, with `validation_result: "pass"`, so
 * neither gate fires. Closing it needs stage to require something bound to the
 * verification that succeeded — a protocol change rather than a guard, tracked
 * on #989. This file is not evidence about that half.
 *
 * A guard in `runCapturePipeline` on this call's `accepted` count was written
 * first. Its negative control showed both cases below pass without it, because
 * the gates above already decide the same thing. It was removed rather than
 * shipped: a second site deciding one question agrees today and drifts later.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'commitlore.mjs');

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
  'We decided: Do not use shared mutable state for config because it causes race conditions. ' +
  'We also decided: Keep the retry ceiling at three attempts because more masks real failures.\n';
const QUOTE_A = 'Do not use shared mutable state for config because it causes race conditions';
const UNSAID = 'a quote nobody said in this transcript at all';

const draftFile = (dir: string, name: string, quote: string, recordId: string): string => {
  const path = join(dir, name);
  writeFileSync(
    path,
    JSON.stringify({
      records: [
        {
          trailers: [
            { key: 'Limit', value: quote },
            { key: 'Record-Id', value: recordId },
          ],
          evidence: [{ key: 'Limit', source: 'transcript', quote, locator: 'L1-L2' }],
        },
      ],
    }),
  );
  return name;
};

/** A repository that has opted into unattended capture, with a staged change. */
const fixtureRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-stagerefuse-'));
  temporaries.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main']);
  writeFileSync(join(dir, 'init.txt'), 'init\n');
  git(dir, ['add', '-A']);
  git(dir, [...IDENTITY, 'commit', '-q', '--no-verify', '-m', 'initial\n\nno record\n']);

  writeFileSync(
    join(dir, '.commitlore-policy.json'),
    JSON.stringify({
      mode: 'auto',
      unattended: true,
      max_records_per_commit: 1,
      require_verified_evidence: true,
    }),
  );
  writeFileSync(join(dir, 'transcript.txt'), TRANSCRIPT);
  writeFileSync(join(dir, 'app.ts'), 'export const run = (x: number): number => x + 1;\n');
  git(dir, ['add', '-A']);
  return dir;
};

interface CaptureEnvelope {
  outcome?: string;
  nonce?: string | null;
  staged?: boolean;
  rejected?: { rule?: string }[];
}

const capture = (dir: string, draft: string): CaptureEnvelope => {
  const result = spawnSync(
    process.execPath,
    [CLI, 'capture', '--transcript', 'transcript.txt', '--draft', draft, '--unattended', '--json'],
    { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  const start = result.stdout.indexOf('{');
  if (start === -1) throw new Error(`capture produced no envelope: ${result.stderr.slice(0, 600)}`);
  return JSON.parse(result.stdout.slice(start, result.stdout.lastIndexOf('}') + 1)) as CaptureEnvelope;
};

/** Every `staged` transaction on disk, and the record ids it would attach. */
const stagedRecordIds = (dir: string): string[] => {
  const pendingDir = join(dir, '.git', 'commitlore', 'pending');
  if (!existsSync(pendingDir)) return [];
  const ids: string[] = [];
  for (const name of readdirSync(pendingDir)) {
    if (!name.endsWith('.json')) continue;
    const record = JSON.parse(readFileSync(join(pendingDir, name), 'utf8')) as {
      phase?: string;
      records?: { trailers?: { key: string; value: string }[] }[];
    };
    if (record.phase !== 'staged') continue;
    for (const entry of record.records ?? []) {
      const id = entry.trailers?.find((trailer) => trailer.key === 'Record-Id')?.value;
      if (id !== undefined) ids.push(id);
    }
  }
  return ids.sort();
};

describe('capture stages what it verified', () => {
  it('stages a record it bound', () => {
    // The control for the case below. Without it, "nothing was staged" could
    // mean the fixture never captured anything in the first place.
    const dir = fixtureRepo();
    const accepted = capture(dir, draftFile(dir, 'good.json', QUOTE_A, 'r-boundaaa001'));
    expect(accepted.outcome, 'the fixture must be able to stage at all').toBe('staged');
    expect(accepted.staged).toBe(true);
    expect(stagedRecordIds(dir)).toEqual(['r-boundaaa001']);
  }, 300_000);

  it('does not report staged when every record was rejected', () => {
    const dir = fixtureRepo();
    const refused = capture(dir, draftFile(dir, 'bad.json', UNSAID, 'r-unfoundaa01'));

    // The rejection itself is the ordinary, correct outcome: the quote is not
    // in the transcript. What must not happen is a staged envelope beside it.
    expect(refused.rejected?.map((entry) => entry.rule)).toEqual(['evidence-not-found']);
    expect(refused.outcome).toBe('rejected');
    expect(refused.staged, 'a run that bound nothing must not call itself staged').toBe(false);

    // And nothing reached the phase the commit-msg hook reads.
    expect(stagedRecordIds(dir), 'nothing may be waiting for the next commit').toEqual([]);
  }, 300_000);
});
