/**
 * #462's instrument: the shipping text report, pinned before the model change.
 *
 * PRD §9.1 constrains every ticket in this milestone up to the text-rendering
 * one — the report a user reads must not move. That constraint needs something
 * that fails when it does, and reading thirteen detail strings by eye is not
 * it. So this snapshot lands *before* the first internal change, and each later
 * ticket keeps it green until #470 deliberately updates it.
 *
 * The snapshot is normalised, not raw: paths, shas, versions and durations vary
 * per machine and per run, and a snapshot that fails for those reasons would be
 * deleted within a week. What survives normalisation is the part §9.1 is about
 * — which checks run, in what order, with what status and what fix line.
 */

import { execFileSync, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  CHECK_REGISTRY,
  evaluateInjectRun,
  formatReport,
  runDoctor,
  type CheckDefinition,
  type DoctorCheck,
} from '../src/commands/doctor.js';
import { closeIndex, openIndex, rebuildIndex } from '../src/core/index-db.js';
import { claudeSettingsPath, installClaudeHook } from '../src/hooks/claude-settings.js';
import { createTestRepo } from './git-fixtures.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `cl-snap-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A repository with a remote, history, a record, a hook stub and an index. */
const populated = (label: string, hookBin: string): string => {
  const remote = createTestRepo({ path: temp(`${label}-remote`), bare: true });
  const repo = createTestRepo({ path: temp(label) });

  git(repo, ['config', 'user.email', 'owner@example.invalid']);
  git(repo, ['config', 'user.name', 'owner']);
  git(repo, ['remote', 'add', 'origin', remote]);

  writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
  git(repo, ['add', '-A']);
  git(repo, [
    'commit',
    '--no-verify',
    '-m',
    'feat: a\n\nLimit: the v1 runtime has no egress\nRecord-Id: r-snap01\nProvenance: authored',
  ]);

  mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(repo, '.git', 'hooks', 'commit-msg'), '#!/bin/sh\nexit 0\n');
  git(repo, ['config', '--local', 'commitlore.bin', hookBin]);
  git(repo, ['config', '--local', 'commitlore.node', process.execPath]);
  git(repo, ['config', '--local', 'commitlore.root', realpathSync(PACKAGE_ROOT)]);

  const handle = openIndex({ cwd: repo });
  rebuildIndex(handle);
  closeIndex(handle);
  return repo;
};

/**
 * Replaces the parts that legitimately vary. Everything left is what §9.1
 * promises not to move: the check set, its order, each status, and the fix
 * line offered.
 */
const normalise = (text: string, repo: string): string =>
  text
    .split('\n')
    .map((line) =>
      line
        .replaceAll(realpathSync(repo), '<repo>')
        .replaceAll(repo, '<repo>')
        .replaceAll(realpathSync(PACKAGE_ROOT), '<root>')
        .replaceAll(PACKAGE_ROOT, '<root>')
        .replaceAll(realpathSync(tmpdir()), '<tmp>')
        // The interpreter's path is the machine's, not the report's: nvm on a
        // laptop, hostedtoolcache on a runner. Leaving it in makes the
        // snapshot a record of where it was first generated.
        .replaceAll(realpathSync(process.execPath), '<node>')
        .replaceAll(process.execPath, '<node>')
        // mkdtemp's random suffix varies per run; the path shape is what
        // matters, and leaving the suffix in makes the snapshot fail for a
        // reason that has nothing to do with the report.
        .replace(/cl-snap-[a-z]+-[A-Za-z0-9]+/g, 'cl-snap-<tmpdir>')
        .replace(/\b[0-9a-f]{40}\b/g, '<sha>')
        .replace(/\b[0-9a-f]{7,12}\b/g, '<short-sha>')
        .replace(/\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?/g, '<version>')
        .replace(/\b\d+\s?ms\b/g, '<ms>')
        .replace(/git version .*/, 'git version <git>')
        .replace(/\/[^\s'"]*commitlore[^\s'"]*/g, '<path>'),
    )
    .join('\n')
    .trimEnd();

describe('#462 doctor text report, pinned', () => {
  it('renders a stable report on a repository whose hook target is missing', () => {
    // The failing shape: `commitlore.bin` points nowhere, so the capture checks
    // take their failure paths and the report carries fix lines.
    const repo = populated('broken', join(temp('nowhere'), 'no-such-binary.mjs'));
    expect(normalise(formatReport(runDoctor({ cwd: repo })), repo)).toMatchSnapshot();
  });

  it('renders a stable report on a repository whose hook target resolves', () => {
    const repo = populated('working', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    expect(normalise(formatReport(runDoctor({ cwd: repo })), repo)).toMatchSnapshot();
  });

  it('pins the check set and its order independently of the rendered text', () => {
    // The snapshot above would also fail on a wording change. This one fails
    // only on the thing §9.1 forbids outright: a check appearing, vanishing or
    // moving.
    const repo = populated('order', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    expect(runDoctor({ cwd: repo }).checks.map((entry) => entry.id)).toMatchSnapshot();
  });

  it('pins every v1 JSON key on every row', () => {
    // PRD §9.1 allows new keys and forbids changing v1 ones. A row that lost
    // `fixed`, or renamed `needsAttention`, fails here rather than in a
    // consumer.
    const repo = populated('json', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    const report = runDoctor({ cwd: repo });

    expect(Object.keys(report).sort()).toEqual(expect.arrayContaining(['checks', 'exitCode']));
    for (const row of report.checks) {
      for (const key of ['id', 'title', 'status', 'needsAttention', 'detail', 'fix', 'fixed']) {
        expect(Object.keys(row), `${row.id} lost the v1 key ${key}`).toContain(key);
      }
      expect(typeof row.id).toBe('string');
      expect(typeof row.title).toBe('string');
      expect(typeof row.needsAttention).toBe('boolean');
      expect(typeof row.detail).toBe('string');
      expect(typeof row.fixed).toBe('boolean');
      expect(row.fix === null || typeof row.fix === 'string').toBe(true);
    }
  });
});

/**
 * #462's other half: the model is consistent because construction makes it so,
 * not because every call site remembered.
 */
describe('#462 the check model', () => {
  it('derives severity from status on every row of a full run', () => {
    // The design ADR-0032 §3 rejected is an independent severity axis. If one
    // ever appears, a row will disagree with its own status here.
    const repo = populated('severity', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    const expected: Record<string, string> = {
      fail: 'error',
      warn: 'warning',
      ok: 'info',
      skipped: 'info',
    };
    for (const row of runDoctor({ cwd: repo }).checks) {
      expect(row.severity, `${row.id} is ${row.status} but ${row.severity}`).toBe(
        expected[row.status],
      );
    }
  });

  it('gives every row a category from the closed union and a non-optional flag', () => {
    // Catches a call site that bypassed the factory: the fields would be
    // missing rather than merely wrong.
    const categories = ['runtime', 'transport', 'capture', 'delivery', 'history', 'index'];
    const repo = populated('category', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));

    for (const row of runDoctor({ cwd: repo }).checks) {
      expect(categories, `${row.id} has category ${String(row.category)}`).toContain(row.category);
      expect(row.optional, `${row.id} is optional; PRD §1.4 says none are`).toBe(false);
      expect(row.evidence, `${row.id} has no evidence object`).toBeTypeOf('object');
    }
  });

  it('carries a skip reason only on skipped rows', () => {
    const repo = populated('skip', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    for (const row of runDoctor({ cwd: repo }).checks) {
      if (row.status !== 'skipped') {
        expect(row.skipReason, `${row.id} is ${row.status} yet names a skip reason`).toBeUndefined();
      }
    }
  });

  it('keeps needsAttention false on the two rows that deliberately clear it', () => {
    // #192 and #221: a no-remote refspec warn and an unresolvable inject
    // executable are conditions the user cannot act on from here. The factory
    // default would set both; the overrides must survive it.
    const remoteless = createTestRepo({ path: temp('noremote') });
    git(remoteless, ['config', 'user.email', 'owner@example.invalid']);
    git(remoteless, ['config', 'user.name', 'owner']);
    git(remoteless, ['commit', '--quiet', '--allow-empty', '--no-verify', '-m', 'first']);

    const refspec = runDoctor({ cwd: remoteless }).checks.find((row) => row.id === 'notes-refspec');
    expect(refspec?.status).toBe('warn');
    expect(refspec?.needsAttention).toBe(false);
  });
});

/**
 * #463: the registry is data, and the runner survives a check that does not.
 */
describe('#463 the registry and runner', () => {
  it('keeps ids unique, kebab-case, and every category populated', () => {
    const ids = CHECK_REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size, 'two entries share an id').toBe(ids.length);
    for (const entry of CHECK_REGISTRY) {
      expect(entry.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(entry.optional, `${entry.id} is optional; PRD §1.4 says none are`).toBe(false);
    }
    const categories = new Set(CHECK_REGISTRY.map((entry) => entry.category));
    for (const category of ['runtime', 'transport', 'capture', 'delivery', 'history', 'index']) {
      expect(categories, `no check speaks for ${category}`).toContain(category);
    }
  });

  it('declares dependencies only on earlier entries', () => {
    // A forward edge cannot be satisfied by the emission order, which is how a
    // fix plan would end up pointing at a row nobody has computed yet.
    const seen = new Set<string>();
    for (const entry of CHECK_REGISTRY) {
      for (const dependency of entry.dependencies) {
        expect(seen, `${entry.id} depends on ${dependency}, which is not earlier`).toContain(
          dependency,
        );
      }
      seen.add(entry.id);
    }
  });

  it('drives the report from the registry, in registry order', () => {
    const repo = populated('registry', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    expect(runDoctor({ cwd: repo }).checks.map((row) => row.id)).toEqual(
      CHECK_REGISTRY.map((entry) => entry.id),
    );
  });

  it('stamps a whole, non-negative durationMs on every row', () => {
    const repo = populated('timing', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    for (const row of runDoctor({ cwd: repo }).checks) {
      expect(row.durationMs, `${row.id} was not timed`).toBeTypeOf('number');
      expect(Number.isInteger(row.durationMs)).toBe(true);
      expect(row.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('turns a throwing check into one failed row and still runs the rest', () => {
    // The user who most needs a diagnosis is the one whose repository is in a
    // state some check did not anticipate. Losing the other twelve answers to
    // that is the worst possible trade.
    const repo = populated('throwing', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    const victim = CHECK_REGISTRY.find((entry) => entry.id === 'git-trailers');
    if (victim === undefined) throw new Error('git-trailers left the registry');

    const original = victim.run;
    try {
      (victim as { run: CheckDefinition['run'] }).run = () => {
        throw new Error('exploded on purpose\nsecond line');
      };
      const report = runDoctor({ cwd: repo });
      const row = report.checks.find((entry) => entry.id === 'git-trailers');

      expect(row?.status).toBe('fail');
      expect(row?.evidence['error']).toBe('exploded on purpose');
      expect(report.checks).toHaveLength(CHECK_REGISTRY.length);
      expect(report.exitCode).toBe(1);
    } finally {
      (victim as { run: CheckDefinition['run'] }).run = original;
    }
  });
});

/**
 * #464: a skip that does not say why is a skip nothing can act on.
 *
 * The compile-time guard covers the factory. These cover what it cannot: a
 * site that maps to the wrong reason, and a fixture nobody looked at where a
 * new skip site landed bare.
 */
describe('#464 typed skip reasons', () => {
  const REASONS = [
    'command_unrecognized',
    'hook_not_installed',
    'probe_path_unavailable',
    'version_unreadable',
    'unborn_head',
    'nothing_applicable',
  ];

  it('gives every skipped row in a full run a reason from the union', () => {
    // The suite-wide invariant PRD §11 names. A new skip site that bypassed
    // the factory would surface here rather than in a consumer.
    const repos = [
      populated('skipA', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs')),
      populated('skipB', join(temp('skipB-nowhere'), 'no-such-binary.mjs')),
    ];
    let seen = 0;
    for (const repo of repos) {
      for (const row of runDoctor({ cwd: repo }).checks) {
        if (row.status !== 'skipped') continue;
        seen += 1;
        expect(REASONS, `${row.id} skipped with reason ${String(row.skipReason)}`).toContain(
          row.skipReason,
        );
      }
    }
    expect(seen, 'no fixture produced a skipped row, so this proved nothing').toBeGreaterThan(0);
  });

  it('omits the key entirely on rows that are not skipped', () => {
    // ADR-0032 §6: an additive field must be omitted, never null. A consumer
    // that reads `"skipReason" in row` breaks on the null form.
    const repo = populated('skipomit', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    const report = runDoctor({ cwd: repo });

    for (const row of report.checks) {
      if (row.status === 'skipped') continue;
      expect(Object.keys(row), `${row.id} carries skipReason while ${row.status}`).not.toContain(
        'skipReason',
      );
    }
    expect(JSON.stringify(report)).not.toContain('"skipReason":null');
  });

  it('maps an unborn HEAD to unborn_head rather than a generic reason', () => {
    // One named mapping, asserted end to end: a reason that drifts when the
    // site's logic is next touched fails here.
    const repo = createTestRepo({ path: temp('unborn') });
    const row = runDoctor({ cwd: repo }).checks.find((entry) => entry.id === 'squash-conservation');

    expect(row?.status).toBe('skipped');
    expect(row?.skipReason).toBe('unborn_head');
  });
});

/**
 * #465: a diagnostic conclusion is only as useful as the observation beside it.
 *
 * Text rendering deliberately ignores these fields until its own ticket, so
 * these assertions look at the report object directly. That keeps the text
 * snapshot meaningful while making the JSON contract hard to erode unnoticed.
 */
describe('#465 doctor evidence', () => {
  const assertEvidence = (checks: readonly DoctorCheck[]): void => {
    for (const row of checks) {
      if (Object.keys(row.evidence).length === 0) {
        throw new Error(`${row.id} is ${row.status} without evidence`);
      }
    }
  };

  const injectContext: Parameters<typeof evaluateInjectRun>[1] = {
    id: 'inject-runtime',
    category: 'delivery',
    title: 'PreToolUse hook runtime',
    executable: 'configured-commitlore',
    path: 'probe.ts',
    fix: 'reinstall the configured executable',
    unavailableFix: 'make the configured executable available',
  };

  const injectRun = (stderr: string): SpawnSyncReturns<string> => ({
    pid: 1,
    output: [null, '', stderr],
    stdout: '',
    stderr,
    status: 7,
    signal: null,
  });

  it('gives every full-run row evidence, and rejects a deliberately bare finding', () => {
    // A new failure path can otherwise read plausibly in text while dropping
    // the observation a JSON consumer needs to distinguish it from another.
    const reports = [
      runDoctor({ cwd: populated('evidence-working', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs')) }),
      runDoctor({ cwd: populated('evidence-broken', join(temp('evidence-missing'), 'missing.mjs')) }),
    ];
    const rows = reports.flatMap((report) => report.checks);

    assertEvidence(rows);
    expect(rows.some((row) => row.status !== 'ok')).toBe(true);
    for (const row of rows) {
      for (const [key, value] of Object.entries(row.evidence)) {
        expect(key, `${row.id} emitted a non-contract evidence key`).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(value, `${row.id}.${key} is not a string`).toBeTypeOf('string');
      }
    }

    const broken: DoctorCheck = {
      id: 'test-only-bare-finding',
      title: 'test-only bare finding',
      status: 'fail',
      needsAttention: true,
      detail: 'this row exists only to exercise the invariant',
      fix: null,
      fixed: false,
      category: 'runtime',
      severity: 'error',
      evidence: {},
      optional: false,
    };
    expect(() => assertEvidence([broken])).toThrow('test-only-bare-finding is fail without evidence');
  });

  it('renders paths under HOME as home-relative evidence', () => {
    // Fixture paths are the path shape users paste into bug reports. Pointing
    // HOME at their parent proves sanitisation reaches paths from every check,
    // not only the one that introduced this field.
    const home = temp('evidence-home');
    const repo = createTestRepo({ path: join(home, 'repo') });
    const previousHome = process.env['HOME'];
    process.env['HOME'] = home;
    try {
      const values = runDoctor({ cwd: repo }).checks.flatMap((row) => Object.values(row.evidence));
      expect(values.some((value) => value.includes('~/'))).toBe(true);
      for (const value of values) expect(value).not.toContain(home);
    } finally {
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
    }
  });

  it('bounds captured stderr while preserving whether anything was omitted', () => {
    // The bound is what keeps a broken hook that prints a large stack trace
    // from turning a diagnostic response into an unbounded JSON payload.
    const truncated = evaluateInjectRun(injectRun(`${'x'.repeat(10_000)}\nsecond line`), injectContext);
    const untruncated = evaluateInjectRun(injectRun('short diagnostic\nsecond line'), injectContext);

    expect(truncated.evidence['stderr_first_line']).toHaveLength(200);
    expect(truncated.evidence['stderr_truncated']).toBe('true');
    expect(untruncated.evidence['stderr_first_line']).toBe('short diagnostic');
    expect(untruncated.evidence['stderr_truncated']).toBe('false');
  });

  it('records the configured executable it runs and both sides of a hook version comparison', () => {
    // #149 reconstructed a path that did not appear in settings; #382 had both
    // versions in hand but left the skew trapped inside prose. This fixture
    // makes the configured command do both jobs so the two observations stay
    // coupled to the executions that produced them.
    const repo = populated('evidence-inject', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    const bin = temp('evidence-inject-bin');
    const command = join(bin, 'commitlore');
    writeFileSync(
      command,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  printf \'0.0.0\\n\'\nelse\n  printf \'{"hookSpecificOutput":{"additionalContext":"context"}}\\n\'\nfi\n',
    );
    chmodSync(command, 0o755);
    installClaudeHook({ settingsPath: claudeSettingsPath(repo) });

    const previousPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:/usr/bin:/bin`;
    try {
      const rows = runDoctor({ cwd: repo }).checks;
      const runtime = rows.find((row) => row.id === 'inject-runtime');
      const version = rows.find((row) => row.id === 'inject-version');

      expect(runtime?.status).toBe('ok');
      expect(runtime?.evidence['executable']).toBe('commitlore');
      expect(runtime?.evidence['exit_code']).toBe('0');
      expect(version?.evidence['executable']).toBe('commitlore');
      expect(version?.evidence['theirs']).toBe('0.0.0');
      expect(version?.evidence['mine']).not.toBe('');
    } finally {
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
    }
  });

  it('surfaces the hook target recorded at installation and an active override', () => {
    // #49 was invisible because doctor observed the target but kept it only in
    // prose. The override matters for the same reason: it wins resolution.
    const bin = resolve(PACKAGE_ROOT, 'dist/commitlore.mjs');
    const repo = populated('evidence-hook-target', bin);
    const override = join(repo, 'override.mjs');
    const previousOverride = process.env['COMMITLORE_BIN'];
    process.env['COMMITLORE_BIN'] = override;
    try {
      const hook = runDoctor({ cwd: repo }).checks.find((row) => row.id === 'commit-msg-hook');
      const home = process.env['HOME'];
      const homeRelative = (value: string): string =>
        home !== undefined && value.startsWith(`${home}/`) ? `~/${value.slice(home.length + 1)}` : value;

      expect(hook?.evidence['hook_path']).toContain('hooks/commit-msg');
      expect(hook?.evidence['bin']).toBe(homeRelative(bin));
      expect(hook?.evidence['node']).toBe(homeRelative(process.execPath));
      expect(hook?.evidence['commitlore_bin_override']).toBe(override);
    } finally {
      if (previousOverride === undefined) delete process.env['COMMITLORE_BIN'];
      else process.env['COMMITLORE_BIN'] = previousOverride;
    }
  });

  it('keeps the counts that licence an index-health verdict', () => {
    // Counting a different trailer convention produced a persuasive but wrong
    // green report in #335/#458. Keeping these numbers structured lets a test
    // compare the conclusion with the observation that licensed it.
    const repo = populated('evidence-index-counts', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    const index = runDoctor({ cwd: repo }).checks.find((row) => row.id === 'index-health');

    expect(index?.evidence['trailers']).not.toBe('');
    expect(index?.evidence['commits']).not.toBe('');
    expect(index?.detail).toContain(`${index?.evidence['trailers']} trailers`);
    expect(index?.detail).toContain(`${index?.evidence['commits']} commits`);
  });
});
