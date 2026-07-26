/**
 * T-801 acceptance criteria: backfill reconstructs records for past commits
 * without inventing any.
 *
 * The three anti-fabrication devices are tested one at a time, because each one
 * has to hold on its own: `Provenance: reconstructed` is forced whatever the
 * draft claims, `verifyDraft` is a gate rather than a lint, and a record that
 * fails it is dropped rather than repaired.
 *
 * Every repository here is a throwaway under `os.tmpdir()`. The git identity is
 * set in each repository's own config rather than passed with `-c`: the internal
 * git calls this module makes are separate processes and would not see a `-c`
 * flag given to the setup command, which is how a green suite once became a red
 * CI run.
 */

import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runBackfill } from '../src/commands/backfill.js';
import { backfill, type BackfillOptions, type BackfillResult } from '../src/core/backfill.js';
import { execGit } from '../src/core/git.js';
import { NOTES_REF, readRecord } from '../src/core/notes.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** `realpathSync` because macOS reports `/var` for a `/private/var` tmpdir. */
const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[]): string => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout;
};

/** An empty `--template` keeps git's sample hooks out of `.git/hooks/`. */
const initRepo = (label: string): string => {
  const dir = tempDir(label);
  git(dir, ['init', '--quiet', `--template=${tempDir(`${label}-template`)}`, '--initial-branch=main']);
  git(dir, ['config', 'user.email', 'test@commitlore.invalid']);
  git(dir, ['config', 'user.name', 'CommitLore Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
};

const commit = (dir: string, file: string, contents: string, message: string): string => {
  writeFileSync(join(dir, file), contents);
  git(dir, ['add', '--', file]);
  git(dir, ['commit', '--quiet', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']).trim();
};

const noteShas = (dir: string): string[] => {
  const result = execGit(['notes', `--ref=${NOTES_REF}`, 'list'], { cwd: dir });
  if (result.code !== 0) return [];
  return result.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split(' ')[1] ?? '');
};

const messagesOf = (dir: string): string => git(dir, ['log', '--format=%H%n%B%n--%n']);

// ---------------------------------------------------------------------------
// The fixture history
// ---------------------------------------------------------------------------

const UPLOAD_MESSAGE = `add the upload guard

The vendor caps uploads at 5 MB, so anything larger is rejected before it
reaches the network.
`;

const PARSER_MESSAGE = `switch the parser to streaming

Holding the whole file in memory blew past the 512 MB container limit, so the
parser now streams. We ruled out raising the container size: the plan does not
allow it.
`;

const RECORDED_MESSAGE = `pin the retry ceiling

Limit: the vendor retries at most 3 times
Provenance: authored
`;

interface Fixture {
  dir: string;
  upload: string;
  parser: string;
  recorded: string;
  tidy: string;
}

/** Four commits, oldest first. Only `recorded` carries a record already. */
const buildFixture = (label: string): Fixture => {
  const dir = initRepo(label);
  const upload = commit(dir, 'upload.ts', 'export const upload = () => {};\n', UPLOAD_MESSAGE);
  const parser = commit(dir, 'parser.ts', 'export const parse = () => {};\n', PARSER_MESSAGE);
  const recorded = commit(dir, 'retry.ts', 'export const retry = () => {};\n', RECORDED_MESSAGE);
  const tidy = commit(dir, 'CHANGELOG.md', '# changelog\n', 'tidy the changelog');
  return { dir, upload, parser, recorded, tidy };
};

const run = (fixture: Fixture, options: Omit<BackfillOptions, 'cwd'> = {}): BackfillResult =>
  backfill({ ...options, cwd: fixture.dir });

const draftFile = (fixture: Fixture, document: unknown): string => {
  const path = join(fixture.dir, 'draft.json');
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  return path;
};

/** A record whose every quote really is in the upload commit's message. */
const uploadRecord = (extra: { key: string; value: string }[] = []) => ({
  trailers: [
    { key: 'Limit', value: 'the vendor caps uploads at 5 MB' },
    ...extra,
  ],
  evidence: [
    {
      key: 'Limit',
      source: 'transcript',
      quote: 'The vendor caps uploads at 5 MB',
      locator: 'L3-L3',
    },
  ],
});

/** A record for the parser commit, including a genuinely rejected alternative. */
const parserRecord = () => ({
  trailers: [
    {
      key: 'Limit',
      value: 'holding the whole file in memory blew past the 512 MB container limit',
    },
    { key: 'Ruled-out', value: 'raising the container size | the plan does not allow it' },
  ],
  evidence: [
    {
      key: 'Limit',
      source: 'transcript',
      quote: 'Holding the whole file in memory blew past the 512 MB container limit',
      locator: 'L3-L4',
    },
    {
      key: 'Ruled-out',
      source: 'transcript',
      quote: 'raising the container size',
      locator: 'L4-L5',
    },
  ],
});

const trailerValue = (trailers: { key: string; value: string }[], key: string): string[] =>
  trailers.filter((trailer) => trailer.key === key).map((trailer) => trailer.value);

// ---------------------------------------------------------------------------

describe('backfill target selection', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildFixture('backfill-targets');
  });

  it('takes the commits with no record, newest first, and leaves the recorded one alone', () => {
    const { report } = run(fixture, { promptOnly: true });

    expect(report.targets).toBe(3);
    expect(report.recorded).toBe(1);
    expect(report.commitsWalked).toBe(4);
  });

  it('emits one prompt per target and none for the commit that already has a record', () => {
    const { report, prompts } = run(fixture, { promptOnly: true });

    expect(report.mode).toBe('prompt-only');
    expect(prompts.map((entry) => entry.sha)).toEqual([
      fixture.tidy,
      fixture.parser,
      fixture.upload,
    ]);
    expect(prompts.map((entry) => entry.sha)).not.toContain(fixture.recorded);
    expect(report.stoppedBy).toBe('exhausted');
  });

  it('gives each prompt the commit it is about and the harvest contract', () => {
    const { prompts } = run(fixture, { promptOnly: true });
    const upload = prompts.find((entry) => entry.sha === fixture.upload);

    expect(upload?.prompt).toContain(fixture.upload);
    expect(upload?.prompt).toContain('The vendor caps uploads at 5 MB');
    expect(upload?.prompt).toContain('## Vocabulary');
    expect(upload?.prompt).toContain('Cite or omit');
    /* The reconstruction preamble, which is the part harvest does not have. */
    expect(upload?.prompt).toContain('reconstructing what survives');
  });
});

describe('backfill without a model', () => {
  let fixture: Fixture;
  let result: BackfillResult;

  beforeAll(() => {
    fixture = buildFixture('backfill-nollm');
    /* Once: the index is incremental, so a second run has nothing left to
       report and would make the assertion below about the wrong invocation. */
    result = run(fixture);
  });

  it('reconstructs nothing and attempts no reconstruction at all', () => {
    expect(result.report.mode).toBe('index-only');
    expect(result.report.prompts).toBe(0);
    expect(result.report.attached).toBe(0);
    expect(result.report.discarded).toEqual([]);
  });

  it('indexes the trailers that already exist', () => {
    expect(result.report.index?.updated).toBe(true);
    expect(result.report.index?.trailersIndexed).toBeGreaterThanOrEqual(1);
  });

  it('exits 0', () => {
    expect(runBackfill({ cwd: fixture.dir }).exitCode).toBe(0);
  });

  it('writes no record to the mirror', () => {
    expect(noteShas(fixture.dir)).toEqual([]);
  });

  it('says how many commits are waiting for a reconstruction', () => {
    const outcome = runBackfill({ cwd: fixture.dir });

    expect(outcome.stdout).toContain('3 commits with no record');
    expect(outcome.stdout).toContain('--prompt-only');
  });
});

describe('backfill applying a draft', () => {
  let fixture: Fixture;
  let before: string;

  beforeAll(() => {
    fixture = buildFixture('backfill-apply');
    before = messagesOf(fixture.dir);
    const draft = draftFile(fixture, {
      commits: [
        { sha: fixture.upload, records: [uploadRecord()] },
        { sha: fixture.parser, records: [parserRecord()] },
      ],
    });
    run(fixture, { draft });
  });

  it('attaches the verified records to the notes mirror', () => {
    expect(noteShas(fixture.dir).sort()).toEqual([fixture.upload, fixture.parser].sort());
  });

  it('marks every reconstructed record Provenance: reconstructed', () => {
    for (const sha of [fixture.upload, fixture.parser]) {
      const record = readRecord(sha, { cwd: fixture.dir });
      expect(trailerValue(record, 'Provenance')).toEqual(['reconstructed']);
    }
  });

  it('keeps the reconstructed claims the source actually supports', () => {
    const parser = readRecord(fixture.parser, { cwd: fixture.dir });

    expect(trailerValue(parser, 'Limit')).toEqual([
      'holding the whole file in memory blew past the 512 MB container limit',
    ]);
    expect(trailerValue(parser, 'Ruled-out')).toEqual([
      'raising the container size | the plan does not allow it',
    ]);
  });

  it('leaves every commit message exactly as it was', () => {
    expect(messagesOf(fixture.dir)).toBe(before);
  });
});

describe('backfill discarding what it cannot verify', () => {
  let fixture: Fixture;
  let result: BackfillResult;

  beforeAll(() => {
    fixture = buildFixture('backfill-discard');
    const draft = draftFile(fixture, {
      commits: [
        {
          sha: fixture.tidy,
          records: [
            {
              trailers: [{ key: 'Limit', value: 'the cache must be warmed before the first request' }],
              evidence: [
                {
                  key: 'Limit',
                  source: 'transcript',
                  quote: 'the cache must be warmed before the first request',
                  locator: 'L1-L1',
                },
              ],
            },
          ],
        },
        { sha: fixture.upload, records: [uploadRecord()] },
      ],
    });
    result = run(fixture, { draft, batchSize: 10 });
  });

  it('discards the record whose quote is nowhere in the source', () => {
    const discarded = result.report.discarded.filter((entry) => entry.sha === fixture.tidy);

    expect(discarded).toHaveLength(1);
    expect(discarded[0]?.reason).toBe('evidence-not-found');
    expect(discarded[0]?.detail).toContain('the transcript does not contain');
  });

  it('writes nothing for the commit whose record was discarded', () => {
    expect(noteShas(fixture.dir)).not.toContain(fixture.tidy);
    expect(readRecord(fixture.tidy, { cwd: fixture.dir })).toEqual([]);
  });

  it('does not let one discarded record cost the grounded one', () => {
    expect(result.report.attached).toBe(1);
    expect(noteShas(fixture.dir)).toContain(fixture.upload);
  });

  it('makes no repair attempt', () => {
    /* A repaired record would have reached the mirror; the reason is reported
       once and the commit is left alone. */
    expect(result.report.discarded).toHaveLength(1);
    expect(noteShas(fixture.dir)).toHaveLength(1);
  });
});

describe('backfill forcing provenance', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildFixture('backfill-provenance');
    const draft = draftFile(fixture, {
      commits: [
        {
          sha: fixture.upload,
          records: [uploadRecord([{ key: 'Provenance', value: 'authored' }])],
        },
      ],
    });
    run(fixture, { draft });
  });

  it('overwrites a draft that claims the record was authored', () => {
    const record = readRecord(fixture.upload, { cwd: fixture.dir });

    expect(trailerValue(record, 'Provenance')).toEqual(['reconstructed']);
    expect(trailerValue(record, 'Provenance')).not.toContain('authored');
  });

  it('leaves the rest of the record intact', () => {
    const record = readRecord(fixture.upload, { cwd: fixture.dir });

    expect(trailerValue(record, 'Limit')).toEqual(['the vendor caps uploads at 5 MB']);
  });
});

describe('backfill convergence', () => {
  let fixture: Fixture;
  let result: BackfillResult;

  beforeAll(() => {
    fixture = buildFixture('backfill-converge');
    /* The draft covers only the oldest target, which sits in the third batch —
       reachable only if the run ignores its own stop condition. */
    const draft = draftFile(fixture, {
      commits: [{ sha: fixture.upload, records: [uploadRecord()] }],
    });
    result = run(fixture, { draft, batchSize: 1 });
  });

  it('stops after two consecutive batches that produced nothing', () => {
    expect(result.report.stoppedBy).toBe('converged');
    expect(result.report.batches).toBe(2);
  });

  it('does not walk the whole target list once it has converged', () => {
    expect(result.report.targets).toBe(3);
    expect(result.report.batches).toBeLessThan(result.report.targets);
    expect(result.report.attached).toBe(0);
    expect(noteShas(fixture.dir)).toEqual([]);
  });
});

describe('backfill budget caps', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildFixture('backfill-budget');
  });

  it('stops at --limit and says so', () => {
    const { report } = run(fixture, { promptOnly: true, limit: 1 });
    const outcome = runBackfill({ cwd: fixture.dir, promptOnly: true, limit: '1' });

    expect(report.targets).toBe(1);
    expect(report.prompts).toBe(1);
    expect(report.stoppedBy).toBe('limit');
    expect(outcome.stderr).toContain('stopped: limit');
    expect(outcome.stderr).toContain('raise it to go further back');
  });

  it('stops at --budget-tokens and says so', () => {
    const { report } = run(fixture, { promptOnly: true, budgetTokens: 1 });
    const outcome = runBackfill({ cwd: fixture.dir, promptOnly: true, budgetTokens: '1' });

    expect(report.prompts).toBe(0);
    expect(report.stoppedBy).toBe('budget-tokens');
    expect(outcome.stderr).toContain('stopped: budget-tokens');
  });

  it('names the cap that stopped it, not the other one', () => {
    const limited = run(fixture, { promptOnly: true, limit: 1 }).report;
    const budgeted = run(fixture, { promptOnly: true, budgetTokens: 1 }).report;

    expect(limited.stoppedBy).not.toBe(budgeted.stoppedBy);
  });

  it('emits what fits under a budget that admits one prompt', () => {
    const first = run(fixture, { promptOnly: true, limit: 1 }).prompts[0];
    const budget = (first?.estimatedTokens ?? 0) + 1;
    const { report } = run(fixture, { promptOnly: true, budgetTokens: budget });

    expect(report.prompts).toBe(1);
    expect(report.stoppedBy).toBe('budget-tokens');
    expect(report.estimatedTokens).toBeLessThanOrEqual(budget);
  });

  it('rejects a cap that is not a non-negative integer', () => {
    const outcome = runBackfill({ cwd: fixture.dir, promptOnly: true, limit: '-3' });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('--limit is not a non-negative integer');
  });
});

describe('backfill --dry-run', () => {
  let fixture: Fixture;
  let result: BackfillResult;
  let before: string;

  beforeAll(() => {
    fixture = buildFixture('backfill-dryrun');
    before = messagesOf(fixture.dir);
    const draft = draftFile(fixture, {
      commits: [
        { sha: fixture.upload, records: [uploadRecord()] },
        { sha: fixture.parser, records: [parserRecord()] },
      ],
    });
    result = run(fixture, { draft, dryRun: true });
  });

  it('reports what it would have attached', () => {
    expect(result.report.dryRun).toBe(true);
    expect(result.report.attached).toBe(2);
  });

  it('changes nothing in the repository', () => {
    expect(noteShas(fixture.dir)).toEqual([]);
    expect(execGit(['rev-parse', '--verify', '--quiet', NOTES_REF], { cwd: fixture.dir }).code).not.toBe(0);
    expect(messagesOf(fixture.dir)).toBe(before);
    expect(git(fixture.dir, ['status', '--porcelain', '--', '.']).includes('upload.ts')).toBe(false);
  });

  it('does not touch the index either', () => {
    expect(result.report.index?.updated).toBe(false);
    expect(result.report.index?.reason).toBe('--dry-run');
  });
});

describe('backfill drafts that name the wrong commit', () => {
  let fixture: Fixture;
  let result: BackfillResult;

  beforeAll(() => {
    fixture = buildFixture('backfill-mismatch');
    const draft = draftFile(fixture, {
      commits: [
        { sha: fixture.recorded, records: [uploadRecord()] },
        { sha: '0'.repeat(40), records: [uploadRecord()] },
        { sha: fixture.upload, records: [uploadRecord()] },
        { sha: fixture.upload, records: [uploadRecord()] },
      ],
    });
    result = run(fixture, { draft });
  });

  it('refuses to replace a record that already exists', () => {
    const skipped = result.report.skipped.find((entry) => entry.sha === fixture.recorded);

    expect(skipped?.reason).toBe('already-recorded');
    expect(readRecord(fixture.recorded, { cwd: fixture.dir })).toEqual([]);
  });

  it('reports a sha this repository does not have', () => {
    expect(result.report.skipped.map((entry) => entry.reason)).toContain('unknown-commit');
  });

  it('takes a commit named twice only once', () => {
    expect(result.report.skipped.map((entry) => entry.reason)).toContain('duplicate-sha');
    expect(result.report.attached).toBe(1);
  });

  it('fails loudly on a document that is not a draft', () => {
    const path = join(fixture.dir, 'bad.json');
    writeFileSync(path, '{"records": []}\n');
    const outcome = runBackfill({ cwd: fixture.dir, draft: path });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('"commits" array');
  });
});

describe('backfill refusing to store an empty reconstruction', () => {
  let fixture: Fixture;
  let result: BackfillResult;

  beforeAll(() => {
    fixture = buildFixture('backfill-empty');
    const draft = draftFile(fixture, {
      commits: [
        { sha: fixture.tidy, records: [] },
        {
          sha: fixture.upload,
          records: [
            {
              trailers: [{ key: 'Record-Id', value: 'r-abc123' }],
              evidence: [
                {
                  key: 'Record-Id',
                  source: 'transcript',
                  quote: 'add the upload guard',
                  locator: 'L1-L1',
                },
              ],
            },
          ],
        },
      ],
    });
    result = run(fixture, { draft });
  });

  it('treats "nothing to record" as the ordinary answer, not a failure', () => {
    expect(result.report.skipped.filter((entry) => entry.sha === fixture.tidy)).toEqual([]);
    expect(result.report.discarded.filter((entry) => entry.sha === fixture.tidy)).toEqual([]);
  });

  it('drops a record that carries no decision context', () => {
    const skipped = result.report.skipped.find((entry) => entry.sha === fixture.upload);

    expect(skipped?.reason).toBe('invalid-record');
    expect(skipped?.detail).toContain('no decision context');
    expect(noteShas(fixture.dir)).toEqual([]);
  });
});

describe('backfill --with-prs', () => {
  /** A `gh` on PATH that behaves the way the test needs it to. */
  const shimPath = (script: string): string => {
    const dir = tempDir('backfill-gh');
    const path = join(dir, 'gh');
    writeFileSync(path, script);
    chmodSync(path, 0o755);
    return dir;
  };

  const withPath = <T>(dir: string, body: () => T): T => {
    const original = process.env['PATH'] ?? '';
    process.env['PATH'] = `${dir}:${original}`;
    try {
      return body();
    } finally {
      process.env['PATH'] = original;
    }
  };

  it('skips quietly and says why when gh cannot be used', () => {
    const fixture = buildFixture('backfill-gh-missing');
    const dir = shimPath('#!/bin/sh\necho "not logged in" >&2\nexit 1\n');

    const outcome = withPath(dir, () =>
      runBackfill({ cwd: fixture.dir, promptOnly: true, withPrs: true }),
    );

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stderr).toContain('pull requests: skipped');
    expect(outcome.stderr).toContain('gh is not authenticated');
    expect(outcome.stdout).toContain('## commit');
  });

  it('puts a collected pull request body into the source the session reads', () => {
    const fixture = buildFixture('backfill-gh-ok');
    const body =
      'We ruled out the queue worker: the free tier has no infrastructure for it.';
    const dir = shimPath(
      `#!/bin/sh\ncase "$1" in\n  auth) exit 0 ;;\n  pr) printf '%s' '[{"number":7,"title":"Upload guard","body":"${body}"}]' ; exit 0 ;;\nesac\nexit 1\n`,
    );

    const result = withPath(dir, () =>
      backfill({ cwd: fixture.dir, promptOnly: true, withPrs: true, limit: 1 }),
    );

    expect(result.report.pullRequests.available).toBe(true);
    expect(result.report.pullRequests.collected).toBe(1);
    expect(result.prompts[0]?.prompt).toContain('pull request #7');
    expect(result.prompts[0]?.prompt).toContain(body);
  });

  it('verifies a quote taken from the pull request body', () => {
    const fixture = buildFixture('backfill-gh-verify');
    const body =
      'We ruled out the queue worker: the free tier has no infrastructure for it.';
    const dir = shimPath(
      `#!/bin/sh\ncase "$1" in\n  auth) exit 0 ;;\n  pr) printf '%s' '[{"number":7,"title":"Upload guard","body":"${body}"}]' ; exit 0 ;;\nesac\nexit 1\n`,
    );
    const draft = draftFile(fixture, {
      commits: [
        {
          sha: fixture.tidy,
          records: [
            {
              trailers: [
                {
                  key: 'Ruled-out',
                  value: 'queue worker | the free tier has no infrastructure for it',
                },
              ],
              evidence: [
                {
                  key: 'Ruled-out',
                  source: 'transcript',
                  quote: 'We ruled out the queue worker',
                  locator: 'L3-L3',
                },
              ],
            },
          ],
        },
      ],
    });

    const result = withPath(dir, () => backfill({ cwd: fixture.dir, draft, withPrs: true }));

    expect(result.report.attached).toBe(1);
    expect(trailerValue(readRecord(fixture.tidy, { cwd: fixture.dir }), 'Provenance')).toEqual([
      'reconstructed',
    ]);
  });

  it('discards that same record when the pull request was not collected', () => {
    const fixture = buildFixture('backfill-gh-mismatch');
    const draft = draftFile(fixture, {
      commits: [
        {
          sha: fixture.tidy,
          records: [
            {
              trailers: [
                {
                  key: 'Ruled-out',
                  value: 'queue worker | the free tier has no infrastructure for it',
                },
              ],
              evidence: [
                {
                  key: 'Ruled-out',
                  source: 'transcript',
                  quote: 'We ruled out the queue worker',
                  locator: 'L3-L3',
                },
              ],
            },
          ],
        },
      ],
    });

    const result = backfill({ cwd: fixture.dir, draft });

    expect(result.report.attached).toBe(0);
    expect(result.report.discarded[0]?.reason).toBe('evidence-not-found');
    expect(noteShas(fixture.dir)).toEqual([]);
  });
});

describe('backfill reporting', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildFixture('backfill-report');
  });

  it('emits a machine-readable report under --json', () => {
    const outcome = runBackfill({ cwd: fixture.dir, promptOnly: true, json: true });
    const parsed = JSON.parse(outcome.stdout) as { report: { mode: string }; prompts: unknown[] };

    expect(outcome.exitCode).toBe(0);
    expect(parsed.report.mode).toBe('prompt-only');
    expect(parsed.prompts).toHaveLength(3);
  });

  it('tells the session how to hand its answers back', () => {
    const outcome = runBackfill({ cwd: fixture.dir, promptOnly: true });

    expect(outcome.stdout).toContain('"commits"');
    expect(outcome.stdout).toContain('commitlore backfill --draft');
    expect(outcome.stdout).toContain('Provenance: reconstructed');
  });

  it('refuses --prompt-only together with --draft', () => {
    const path = join(fixture.dir, 'unused.json');
    writeFileSync(path, '{"commits": []}\n');
    const outcome = runBackfill({ cwd: fixture.dir, promptOnly: true, draft: path });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('mutually exclusive');
  });

  it('reports a --draft path it cannot read', () => {
    const outcome = runBackfill({ cwd: fixture.dir, draft: join(fixture.dir, 'absent.json') });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toContain('cannot read --draft');
  });
});

describe('backfill on an empty repository', () => {
  it('reports nothing to do rather than failing', () => {
    const dir = initRepo('backfill-empty-repo');
    const outcome = runBackfill({ cwd: dir });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain('0 commits with no record');
  });
});

describe('backfill leaves history alone', () => {
  it('never rewrites a commit, whatever it attaches', () => {
    const fixture = buildFixture('backfill-history');
    const head = git(fixture.dir, ['rev-parse', 'HEAD']).trim();
    /* `--branches --tags` rather than `--all`: the mirror's own ref lives under
       refs/notes and gaining commits there is the feature, not a rewrite. */
    const history = git(fixture.dir, ['rev-list', '--branches', '--tags']).trim();
    const before = messagesOf(fixture.dir);
    const draft = draftFile(fixture, {
      commits: [
        { sha: fixture.upload, records: [uploadRecord()] },
        { sha: fixture.parser, records: [parserRecord()] },
      ],
    });

    const result = backfill({ cwd: fixture.dir, draft });

    expect(result.report.attached).toBe(2);
    expect(git(fixture.dir, ['rev-parse', 'HEAD']).trim()).toBe(head);
    expect(git(fixture.dir, ['rev-list', '--branches', '--tags']).trim()).toBe(history);
    expect(messagesOf(fixture.dir)).toBe(before);
    expect(readFileSync(join(fixture.dir, 'upload.ts'), 'utf8')).toBe(
      'export const upload = () => {};\n',
    );
  });
});
