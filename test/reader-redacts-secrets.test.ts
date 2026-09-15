/**
 * #1024: a credential in a trailer is masked on every reader, not only in
 * `validate`'s report.
 *
 * `validate` detects a secret in a trailer value and reports it as `AKIA…`.
 * Every reader on the other side printed the same value whole — `inject` worst
 * of all, because that is the projection handed to a model before it edits a
 * path. One secret in one record was replayed into every agent context that
 * asked about that file, and into whatever captured those contexts, for as long
 * as the record stayed active.
 *
 * ## Why the commit-msg hook is not the answer
 *
 * It is the intended gate and it is not the only door. `doctor` reports a
 * missing hook as a **warn**, so an un-hooked repository is a supported state;
 * `--no-verify` skips it; `backfill` reconstructs records from commits that
 * predate it; and the notes mirror carries records that only ever passed
 * somebody else's local gate. On each of those paths a reader is the first
 * component to look at the value.
 *
 * ## Where the masking is applied, and why there
 *
 * In `runQuery`, which is the one place `inject`, `context`, `limits`,
 * `ruled-out`, `warnings` and the MCP tools all read through. Masking `inject`
 * alone would have left the others exactly as they were — the same mistake in a
 * new place, since the whole defect is that `validate` had the rule and the
 * readers did not.
 *
 * The values below are synthetic, generated for this test, and never existed as
 * credentials. They are shaped to avoid the deliberate suppressors in
 * `hooks/secret-rules.ts`: no placeholder word, no run of repeated characters.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runQuery } from '../src/core/query.js';
import { redactSecretsIn } from '../src/core/secret-guard.js';

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

/** Synthetic, never issued, and shaped to clear the placeholder suppressors. */
const AWS_KEY = 'AKIA29326ML64LG2TJF8';
const GH_TOKEN = 'ghp_u8jzPde0IgxLd6GncfBAepfJBd0Kh8oOL8dK';

const repoWithASecretInARecord = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-secretread-'));
  temporaries.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main']);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'pricing.ts'), 'export const price = 1;\n');
  git(dir, ['add', '-A']);
  // `--no-verify`, which is one of the documented ways a record arrives without
  // the detector having run.
  git(dir, [
    ...IDENTITY,
    'commit',
    '-q',
    '--no-verify',
    '-m',
    `feat: pricing\n\nA constraint the diff cannot show.\n\n` +
      `Limit: rotate ${AWS_KEY} and ${GH_TOKEN} before release\n` +
      'Record-Id: r-secretread01\nBlast: local\n',
  ]);
  return dir;
};

describe('#1024 a reader never hands a credential back', () => {
  it('masks the value that reaches a caller of runQuery', () => {
    const dir = repoWithASecretInARecord();
    const answer = runQuery({ cwd: dir, paths: ['src/pricing.ts'] });

    const values = answer.records.flatMap((record) =>
      record.trailers.map((trailer) => trailer.value),
    );
    // The premise: the record has to have been found, or "no secret in the
    // output" is true of an empty answer and means nothing.
    expect(values.join(' '), 'the fixture produced no record').toContain('before release');

    expect(values.join(' ')).not.toContain(AWS_KEY);
    expect(values.join(' ')).not.toContain(GH_TOKEN);
    // Masked to the prefix `validate` reports, not replaced wholesale: the
    // reader can still tell which kind of credential was there.
    expect(values.join(' ')).toContain('AKIA…');
    expect(values.join(' ')).toContain('ghp_…');
  }, 300_000);

  it('says it masked something, rather than quietly changing the text', () => {
    // A reader shown altered text and not told is being lied to about what the
    // record says. The diagnostic also names the repair, which is rotation —
    // rewriting history does not reach clones that already pulled.
    const dir = repoWithASecretInARecord();
    const answer = runQuery({ cwd: dir, paths: ['src/pricing.ts'] });

    const said = answer.diagnostics.join('\n');
    expect(said).toContain('credential rule');
    expect(said).toContain('rotated');
    expect(said, 'the diagnostic must not repeat the value it just masked').not.toContain(AWS_KEY);
  }, 300_000);

  it('leaves an ordinary record untouched', () => {
    // The control. A masker that rewrote everything would pass both cases above
    // while destroying every record in the repository.
    const dir = mkdtempSync(join(tmpdir(), 'commitlore-secretclean-'));
    temporaries.push(dir);
    git(dir, ['init', '-q', '--initial-branch=main']);
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, [
      ...IDENTITY,
      'commit',
      '-q',
      '--no-verify',
      '-m',
      'change\n\nA constraint the diff cannot show.\n\n' +
        'Limit: the retry ceiling stays at three attempts\nRecord-Id: r-nosecret0001\nBlast: local\n',
    ]);

    const answer = runQuery({ cwd: dir, paths: ['a.ts'] });
    const values = answer.records.flatMap((record) => record.trailers.map((t) => t.value));
    expect(values.join(' ')).toContain('the retry ceiling stays at three attempts');
    expect(answer.diagnostics.join('\n')).not.toContain('credential rule');
  }, 300_000);

  it('redacts every match in a line, not only the first', () => {
    // Spliced from the end so an earlier hit's offsets stay valid. Done the
    // other way, the second replacement lands at a stale index and leaves part
    // of a credential behind.
    const line = `rotate ${AWS_KEY} and ${GH_TOKEN} before release`;
    const masked = redactSecretsIn(line);

    expect(masked.findings).toHaveLength(2);
    expect(masked.text).not.toContain(AWS_KEY);
    expect(masked.text).not.toContain(GH_TOKEN);
    expect(masked.text).toBe('rotate AKIA… and ghp_… before release');
  }, 300_000);

  it('returns the same string when nothing matched', () => {
    // Identity, so a caller can tell "nothing was removed" without comparing
    // content — which is how the diagnostic above counts.
    const clean = 'the retry ceiling stays at three attempts';
    expect(redactSecretsIn(clean).text).toBe(clean);
    expect(redactSecretsIn(clean).findings).toEqual([]);
  }, 300_000);
});
