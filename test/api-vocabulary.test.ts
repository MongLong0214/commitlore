/**
 * #1025: the read surface says the same thing the same way.
 *
 * Two inconsistencies found while exercising the read-side tools over MCP.
 * Neither broke anything; both made the surface harder to use correctly from an
 * agent that only sees the tool descriptions.
 *
 * ## `before_change` shipped `guard`'s description
 *
 * Verbatim — while their schemas differ in exactly the way that matters:
 * `guard` requires a `proposal` and takes an optional `path`; `before_change`
 * requires a `path` and takes an optional `proposal`. They return different
 * shapes. A model choosing from descriptions alone read two identical strings,
 * picked the one whose words matched what it wanted, and never discovered that
 * `before_change` is the tool that answers *"what do I need to know before
 * touching this file"* — which is what the server instructions tell it to ask.
 *
 * ## `stale` did not speak the coverage vocabulary
 *
 * The server instructions teach `coverage: "partial"` at length — that absence
 * of a record is not evidence the record does not exist — and never mention
 * `truncated`, which is the field `stale` reported the same fact under. An agent
 * taught to check `coverage` did not check it, and read `totalRecords: 0` from a
 * scan that had also not looked at everything as "nothing is stale".
 *
 * `truncated` is kept beside the new field, because it is what this command has
 * always reported and a consumer reading it is not wrong.
 *
 * ## The `at` difference is real and cannot change a verdict
 *
 * The delivery surfaces pin the last millisecond of the UTC day; `stale` uses
 * the wall clock. They share a field name and mean different instants, which is
 * worth documenting and is not worth unifying: `Expires:` is a UTC *day* or a
 * free-text condition that never auto-expires, and the boundary is 00:00:00Z of
 * the day after — so two instants inside one UTC day are always on the same side
 * of every boundary. The reporter said they could not confirm a wrong answer;
 * this is why there is not one.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { buildReport, collectRecords } from '../src/commands/stale.js';
import { TOOLS } from '../src/mcp/server.js';

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

const toolNamed = (name: string) => TOOLS.find((tool) => tool.name === name);

describe('#1025 before_change describes itself', () => {
  it('does not ship guard\'s description', () => {
    const guard = toolNamed('commitlore_guard');
    const before = toolNamed('commitlore_before_change');
    expect(guard).toBeDefined();
    expect(before).toBeDefined();
    expect(before?.description).not.toBe(guard?.description);
  }, 300_000);

  it('names the fields it actually returns', () => {
    // The description never mentioned any of these, so a model had no way to
    // learn from the tool list that this is the context tool.
    const text = toolNamed('commitlore_before_change')?.description ?? '';
    for (const field of [
      'active_decisions',
      'verification_gaps',
      'possible_revival_matches',
      'guard_confidence',
      'cache_key',
    ]) {
      expect(text, `the description does not name ${field}`).toContain(field);
    }
  }, 300_000);

  it('says the guard runs only when a proposal is given', () => {
    // `guard_confidence: "not-run"` and an empty match list mean "nothing was
    // checked", not "nothing matched", and a model that reads them as a safety
    // result is being misled by silence.
    const text = toolNamed('commitlore_before_change')?.description ?? '';
    expect(text).toContain('not-run');
    expect(text).toMatch(/not because nothing matched/i);
  }, 300_000);

  it('keeps the advisory disclosure on both tools', () => {
    // The recall figure is the reason silence is not a safety result, and it
    // has to survive a rewrite of the surrounding sentence.
    for (const name of ['commitlore_guard', 'commitlore_before_change']) {
      const text = toolNamed(name)?.description ?? '';
      expect(text, `${name} lost the recall disclosure`).toContain('recall 22.0%');
    }
  }, 300_000);
});

describe('#1025 stale speaks the coverage vocabulary', () => {
  const repoWithOneRecord = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'commitlore-vocab-'));
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
        'Limit: the retry ceiling stays at three\nRecord-Id: r-vocab000001\nBlast: local\n',
    ]);
    return dir;
  };

  it('reports coverage beside truncated, and they agree', () => {
    const dir = repoWithOneRecord();
    const report = buildReport(collectRecords({ cwd: dir }), new Date('2026-06-01T00:00:00Z'));

    expect(report.coverage).toBe('complete');
    expect(report.truncated).toBe(false);
  }, 300_000);

  it('says partial when the scan was cut short', () => {
    // The case the vocabulary exists for: `totalRecords` is not a count of what
    // the repository holds, and an agent taught to read `coverage` now learns
    // that here as it does from `query`.
    const dir = repoWithOneRecord();
    const scan = collectRecords({ cwd: dir });
    const report = buildReport({ ...scan, truncated: true }, new Date('2026-06-01T00:00:00Z'));

    expect(report.coverage).toBe('partial');
    expect(report.truncated).toBe(true);
  }, 300_000);
});
