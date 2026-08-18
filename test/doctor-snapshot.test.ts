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
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  CHECK_REGISTRY,
  evaluateInjectRun,
  formatCheckReport,
  formatReport,
  runDoctor as runDoctorWithContext,
  type CheckDefinition,
  type DoctorCheck,
  type DoctorReport,
} from '../src/commands/doctor.js';
import { closeIndex, openIndex, rebuildIndex } from '../src/core/index-db.js';
import { claudeSettingsPath, installClaudeHook } from '../src/hooks/claude-settings.js';
import { HOOK_MARKER, commitMsgStub } from '../src/hooks/commit-msg.js';
import { defaultDoctorContext } from '../src/commands/doctor/model.js';
import { createTestRepo } from './git-fixtures.js';

/**
 * A pinned report describes the repository; `mcp-runtime-identity` describes
 * the machine, and its *status* moves with whatever CommitLore servers happen
 * to be running. The first attempt at this snapshot embedded four of them.
 * The seam exists so process enumeration never reaches a fixture, and using it
 * is what makes the pin a statement about the format.
 */
const runDoctor = (opts: Parameters<typeof runDoctorWithContext>[0] = {}): ReturnType<typeof runDoctorWithContext> =>
  runDoctorWithContext(opts, {
    ...defaultDoctorContext(opts),
    liveMcpRuntimes: () => ({ available: true, runtimes: [], detail: 'pinned fixture: no live runtimes' }),
  });




const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch: string[] = [];

// `inject-runtime` reports whether the Claude Code plugin covers the
// repository (#781), and it reads that from `HOME`. Left to the ambient one,
// these pinned reports say one thing on a developer's machine with the plugin
// installed and another on CI, which is not a pin. Point it at an empty
// directory: no plugin, the case a fresh reader is being shown.
const PINNED_HOME = mkdtempSync(join(realpathSync(tmpdir()), 'cl-snap-home-'));
const AMBIENT_HOME = process.env['HOME'];
process.env['HOME'] = PINNED_HOME;

// `release-freshness` asks a remote for its tags (T-1605). Left alone it
// reports one thing on a connected laptop and another on an air-gapped runner,
// which is not a pin. Switched off here, so the row is the deterministic
// "not checked" one; T-1605's own suite covers the answers.
const AMBIENT_NO_CHECK = process.env['COMMITLORE_NO_UPDATE_CHECK'];
process.env['COMMITLORE_NO_UPDATE_CHECK'] = '1';

afterAll(() => {
  if (AMBIENT_HOME === undefined) delete process.env['HOME'];
  else process.env['HOME'] = AMBIENT_HOME;
  if (AMBIENT_NO_CHECK === undefined) delete process.env['COMMITLORE_NO_UPDATE_CHECK'];
  else process.env['COMMITLORE_NO_UPDATE_CHECK'] = AMBIENT_NO_CHECK;
  rmSync(PINNED_HOME, { recursive: true, force: true });
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
/**
 * The check writes the interpreter path home-relative, so the raw `execPath`
 * replacements below never see it on a machine where node lives under `$HOME`.
 * Producing the same tilde form here catches the laptop case; on a runner,
 * where node is outside `$HOME`, this returns the absolute path the
 * replacements already handle, so both environments normalise alike.
 */
const asWritten = (value: string): string => {
  const home = homedir();
  return value.startsWith(`${home}/`) ? `~/${value.slice(home.length + 1)}` : value;
};

// `mcp-runtime-identity` enumerates live processes, so its detail is a fact
// about the machine and not about the report. Both rendering paths see the same
// processes and still agree byte for byte; collapsing the varying half is what
// lets the pinned text stay a statement about the format (#660).
const canonicaliseLiveRuntimes = (line: string): string =>
  /live (?:CommitLore )?MCP runtime/i.test(line)
    ? line.replace(/(live MCP runtime identity —|live CommitLore MCP runtime\(s\)).*$/i, '$1 <machine state>')
    : line;

/**
 * The totals count `mcp-runtime-identity`, whose status is a fact about the
 * machine: doctor spawns an MCP probe of its own, so two runs cannot agree
 * about the process table even when nothing else differs. Collapsing the counts
 * keeps these comparisons about the format they exist to pin (#661).
 */
const canonicaliseTotals = (line: string): string =>
  line.replace(/^\d+ ok, \d+ warnings?, \d+ failed, \d+ skipped/, '<totals>');

/**
 * Every check except the one that reads the process table (#661).
 *
 * The two comparisons below exist to pin that the library and the shipped
 * binary render one report identically, and that NO_COLOR changes nothing but
 * colour. `mcp-runtime-identity` enumerates live processes, so its status moves
 * with whatever else is running — under a parallel suite it can flip between
 * runs, which shifts the numbered warning list and every number after it.
 * Canonicalising those lines only hides it until the next check reads the
 * machine; leaving the check out of a format comparison is the thing that is
 * actually true about what these tests measure.
 *
 * Derived from the registry rather than listed, so adding a check does not
 * silently drop out of these comparisons.
 */
const FORMAT_CHECK_IDS: readonly string[] = CHECK_REGISTRY.map((definition) => definition.id).filter(
  (id) => id !== 'mcp-runtime-identity',
);

const normalise = (text: string, repo: string): string =>
  text
    .split('\n')
    .map((line) =>
      canonicaliseTotals(canonicaliseLiveRuntimes(line))
        .replaceAll(realpathSync(repo), '<repo>')
        .replaceAll(repo, '<repo>')
        // Both spellings of this checkout's root. The report writes paths
        // home-relative, so a checkout under $HOME appears as `~/…` and one
        // outside it as an absolute path -- and a snapshot recorded in one
        // place then failed everywhere else (#555). Collapsing the tilde form
        // to the same token makes the pinned text a fact about the report
        // rather than about where somebody keeps their repositories.
        .replaceAll(asWritten(realpathSync(PACKAGE_ROOT)), '<root>')
        .replaceAll(asWritten(PACKAGE_ROOT), '<root>')
        .replaceAll(realpathSync(PACKAGE_ROOT), '<root>')
        .replaceAll(PACKAGE_ROOT, '<root>')
        .replaceAll(realpathSync(tmpdir()), '<tmp>')
        // The interpreter's path is the machine's, not the report's: nvm on a
        // laptop, hostedtoolcache on a runner. Leaving it in makes the
        // snapshot a record of where it was first generated.
        .replaceAll(asWritten(realpathSync(process.execPath)), '<node>')
        .replaceAll(asWritten(process.execPath), '<node>')
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
        .replace(/durationMs: \d+/g, 'durationMs: <ms>')
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

/** #470 deliberately adds this triage header; the check block stays pinned below. */
describe('#470 doctor text report header', () => {
  const fixtureCheck = (
    id: string,
    status: DoctorCheck['status'],
    detail: string,
    fix: string | null,
  ): DoctorCheck => ({
    id,
    title: id,
    status,
    needsAttention: status === 'warn' || status === 'fail',
    detail,
    fix,
    fixed: false,
    category: 'runtime',
    severity: status === 'fail' ? 'error' : status === 'warn' ? 'warning' : 'info',
    evidence: { fixture: id },
    optional: false,
  });

  const mixedReport = (): DoctorReport => {
    const sharedFix = 'commitlore hooks install';
    const checks = [
      fixtureCheck('root-failure', 'fail', 'the root finding needs repair', sharedFix),
      fixtureCheck('first-echo', 'warn', 'the first dependent is affected', sharedFix),
      fixtureCheck('second-echo', 'warn', 'the second dependent is affected', sharedFix),
      fixtureCheck('third-echo', 'warn', 'the third dependent is affected', sharedFix),
    ];
    return {
      schema: 'commitlore_doctor.v2',
      version: 'fixture',
      status: 'failed',
      installSource: 'unknown',
      headline: 'Next action [root-failure]: the root finding needs repair — commitlore hooks install',
      summary: { total: 4, ok: 0, warn: 3, fail: 1, skipped: 0, durationMs: 412 },
      fixPlan: checks.map((check) => check.id),
      checks,
      exitCode: 1,
    };
  };

  it('puts the headline on line one and the summary on line two for mixed statuses', () => {
    const lines = formatReport(mixedReport()).trimEnd().split('\n');

    expect(lines.slice(0, 2)).toEqual([
      'Next action [root-failure]: the root finding needs repair — commitlore hooks install',
      '0 ok, 3 warnings, 1 failed, 0 skipped (412ms)',
    ]);
  });

  it('prints four plan entries but a shared fix string only once', () => {
    const plan = formatReport(mixedReport()).trimEnd().split('\n').slice(2, 6);

    expect(plan).toEqual([
      '1. [fail] root-failure — the root finding needs repair (commitlore hooks install)',
      '2. [warn] first-echo — the first dependent is affected',
      '3. [warn] second-echo — the second dependent is affected',
      '4. [warn] third-echo — the third dependent is affected',
    ]);
  });

  it('renders a degraded report with no actionable entry as usable, never healthy', () => {
    const report: DoctorReport = {
      schema: 'commitlore_doctor.v2',
      version: 'fixture',
      status: 'degraded',
      installSource: 'unknown',
      headline: 'Doctor is usable; some checks could not be verified.',
      summary: { total: 1, ok: 0, warn: 0, fail: 0, skipped: 1, durationMs: 4 },
      fixPlan: [],
      checks: [fixtureCheck('unverified', 'skipped', 'a source could not be read', null)],
      exitCode: 0,
    };

    const headline = formatReport(report).split('\n', 1)[0];
    expect(headline).toBe('Doctor is usable; some checks could not be verified.');
    expect(headline).not.toContain('healthy');
  });

  it('keeps the per-check tail byte-identical to the pre-ticket rows', () => {
    const broken = populated('tailbroken', join(temp('tailnowhere'), 'missing.mjs'));
    const working = populated('tailworking', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));

    expect({
      broken: normalise(formatCheckReport(runDoctor({ cwd: broken })), broken),
      working: normalise(formatCheckReport(runDoctor({ cwd: working })), working),
    }).toMatchSnapshot();
  });

  it('pins verbose diagnostics while the default adds no per-check lines', () => {
    const repo = populated('verbose', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    // Both sides read the real machine here on purpose. What this pins is that
    // the library and the shipped binary render identically; a pinned seam on
    // one side only would make them differ for a reason that is not the format.
    const report = runDoctorWithContext({ cwd: repo, only: FORMAT_CHECK_IDS });
    const plain = formatReport(report);
    const verbose = normalise(formatReport(report, { verbose: true }), repo);
    const cliVerbose = normalise(
      execFileSync(process.execPath, [resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'), 'doctor', '--verbose', '--only', FORMAT_CHECK_IDS.join(',')], {
        cwd: repo,
        encoding: 'utf8',
      }),
      repo,
    );

    expect(plain).not.toMatch(/^\s+(?:evidence\.|skipReason:|durationMs:)/m);
    expect(verbose).toContain('evidence.');
    expect(verbose).toContain('skipReason:');
    expect(verbose).toContain('durationMs:');
    expect(cliVerbose).toBe(verbose);
    // No snapshot here: this report counts a check that reads the machine, so
    // its totals move with what is running. The format is pinned by the
    // snapshots above, which run through the seam.
  });

  it('matches NO_COLOR output byte-for-byte when stdout is non-TTY', () => {
    const repo = populated('no-color', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    const env = { ...process.env };
    delete env.NO_COLOR;
    const run = (childEnv: NodeJS.ProcessEnv): string =>
      execFileSync(
        process.execPath,
        [resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'), 'doctor', '--only', FORMAT_CHECK_IDS.join(',')],
        { cwd: repo, encoding: 'utf8', env: childEnv },
      );

    const plain = run(env);
    // Wall-clock durations are intentionally measured on each command run;
    // they are the only run-specific part of otherwise byte-identical streams.
    expect(normalise(run({ ...env, NO_COLOR: '1' }), repo)).toBe(normalise(plain, repo));
    expect(plain).not.toContain('\u001b');
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
      // #469's honesty clamp reads the final row set, including this runner-
      // synthesized failure. A containment row must never leave the envelope
      // sounding healthy merely because the original check did not return.
      expect(report.status).not.toBe('ok');
      expect(report.status).toBe('failed');
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

/**
 * #466: a repeated symptom names its cause without discarding the observation
 * that made the symptom useful. The blocked row stays in the report because a
 * later independent defect must have somewhere honest to appear.
 */
describe('#466 root-cause collapse', () => {
  const row = (id: string, status: DoctorCheck['status'], blockedBy?: string): DoctorCheck => ({
    id,
    title: id,
    status,
    needsAttention: status === 'warn' || status === 'fail',
    detail: `${id} fixture result`,
    fix: null,
    fixed: false,
    category: 'runtime',
    severity: status === 'fail' ? 'error' : status === 'warn' ? 'warning' : 'info',
    evidence: { fixture: id },
    optional: false,
    ...(blockedBy === undefined ? {} : { blockedBy }),
  });

  const currentHookWithDeadRuntime = (label: string): string => {
    const repo = populated(label, resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    writeFileSync(join(repo, '.git', 'hooks', 'commit-msg'), commitMsgStub());
    git(repo, ['config', '--local', 'commitlore.node', '/nonexistent/node']);
    return repo;
  };

  it('resolves a blocked chain to its root', () => {
    // A consumer should not have to re-walk A → B → C to find the instruction
    // that matters. This substitutes only the registry, leaving the runner
    // that performs the collapse under test.
    const registry = CHECK_REGISTRY as CheckDefinition[];
    const original = [...registry];
    const synthetic: CheckDefinition[] = [
      {
        id: 'collapse-root',
        title: 'collapse root',
        category: 'runtime',
        dependencies: [],
        optional: false,
        run: () => row('collapse-root', 'fail'),
      },
      {
        id: 'collapse-middle',
        title: 'collapse middle',
        category: 'runtime',
        dependencies: ['collapse-root'],
        optional: false,
        run: (_ctx, dependencies) => {
          const root = dependencies.get('collapse-root');
          if (root === undefined) throw new Error('collapse root did not run');
          return row('collapse-middle', 'skipped', root.id);
        },
      },
      {
        id: 'collapse-leaf',
        title: 'collapse leaf',
        category: 'runtime',
        dependencies: ['collapse-middle'],
        optional: false,
        run: (_ctx, dependencies) => {
          const middle = dependencies.get('collapse-middle');
          if (middle === undefined) throw new Error('collapse middle did not run');
          return row('collapse-leaf', 'skipped', middle.id);
        },
      },
    ];

    registry.splice(0, registry.length, ...synthetic);
    try {
      const report = runDoctor();

      expect(report.checks.map((entry) => entry.id)).toEqual(
        ['collapse-root', 'collapse-middle', 'collapse-leaf'],
      );
      expect(report.checks.find((entry) => entry.id === 'collapse-leaf')?.blockedBy).toBe(
        'collapse-root',
      );
    } finally {
      registry.splice(0, registry.length, ...original);
    }
  });

  it('keeps a dead hook runtime\'s dependent row, detail, and evidence', () => {
    // Removing the hook row makes a dead runtime look tidier by hiding the
    // installation it actually affected. The duplicate is an annotation, not
    // permission to stop looking.
    const repo = currentHookWithDeadRuntime('collapse-hook');
    const report = runDoctor({ cwd: repo });
    const runtime = report.checks.find((entry) => entry.id === 'hook-runtime');
    const hook = report.checks.find((entry) => entry.id === 'commit-msg-hook');

    expect(runtime?.status).toBe('fail');
    expect(hook?.blockedBy).toBe('hook-runtime');
    expect(hook?.detail).toContain(`outcome: ${runtime?.detail}`);
    expect(hook?.evidence['runtime_status']).toBe('fail');
    expect(report.checks.filter((entry) => entry.id === 'commit-msg-hook')).toHaveLength(1);
    expect(formatReport(report)).toContain(`${hook?.status?.padEnd(8)}${hook?.title} — ${hook?.detail}`);
  });

  it('keeps a stale stub unblocked when its runtime is also dead', () => {
    // The stale body is actionable in its own right. Attributing it to the
    // missing runtime would make a future fix plan bury the update it needs.
    const repo = currentHookWithDeadRuntime('collapse-stale');
    writeFileSync(
      join(repo, '.git', 'hooks', 'commit-msg'),
      `#!/bin/sh\n${HOOK_MARKER}\nexec commitlore validate "$1"\n`,
    );
    const report = runDoctor({ cwd: repo });
    const runtime = report.checks.find((entry) => entry.id === 'hook-runtime');
    const hook = report.checks.find((entry) => entry.id === 'commit-msg-hook');

    expect(runtime?.status).toBe('fail');
    expect(hook?.status).toBe('warn');
    expect(hook?.detail).toContain('out of date');
    expect(hook?.blockedBy).toBeUndefined();
    expect(Object.keys(hook ?? {})).not.toContain('blockedBy');
  });

  it('marks the unreadable inject version as blocked by its failed runtime', () => {
    const repo = populated('collapse-inject-runtime', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    const bin = temp('collapse-inject-runtime-bin');
    const command = join(bin, 'commitlore');
    writeFileSync(command, '#!/bin/sh\necho broken >&2\nexit 7\n');
    chmodSync(command, 0o755);
    installClaudeHook({ settingsPath: claudeSettingsPath(repo) });

    const previousPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:/usr/bin:/bin`;
    try {
      const report = runDoctor({ cwd: repo });
      const runtime = report.checks.find((entry) => entry.id === 'inject-runtime');
      const version = report.checks.find((entry) => entry.id === 'inject-version');

      expect(runtime?.status).toBe('fail');
      expect(version?.status).toBe('skipped');
      expect(version?.detail).toBe('commitlore did not report a version');
      expect(version?.blockedBy).toBe('inject-runtime');
      expect(version?.evidence).toMatchObject({ executable: 'commitlore', exit_code: '7' });
      expect(formatReport(report)).toContain(
        `skipped ${version?.title} — commitlore did not report a version`,
      );
    } finally {
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
    }
  });

  it('leaves an independent inject version mismatch unblocked', () => {
    // A version comparison that runs and disagrees has fresh evidence. The
    // runtime being a declared prerequisite does not turn that finding into
    // an echo.
    const repo = populated('collapse-inject-version', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs'));
    const bin = temp('collapse-inject-version-bin');
    const command = join(bin, 'commitlore');
    writeFileSync(
      command,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  printf \'0.0.0\\n\'\nelse\n  printf context\\n\nfi\n',
    );
    chmodSync(command, 0o755);
    installClaudeHook({ settingsPath: claudeSettingsPath(repo) });

    const previousPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:/usr/bin:/bin`;
    try {
      const report = runDoctor({ cwd: repo });
      const runtime = report.checks.find((entry) => entry.id === 'inject-runtime');
      const version = report.checks.find((entry) => entry.id === 'inject-version');

      expect(runtime?.status).toBe('ok');
      expect(version?.status).toBe('warn');
      expect(version?.detail).toContain('0.0.0');
      expect(version?.blockedBy).toBeUndefined();
      expect(Object.keys(version ?? {})).not.toContain('blockedBy');
    } finally {
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
    }
  });

  it('never names an ok blocker or omits a row while collapse is active', () => {
    // A recovered dependency must not leave stale metadata behind, and a
    // blocked row still counts because its own observation remains evidence.
    const reports = [
      runDoctor({ cwd: populated('collapse-clean', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs')) }),
      runDoctor({ cwd: currentHookWithDeadRuntime('collapse-count') }),
    ];

    for (const report of reports) {
      expect(report.checks).toHaveLength(CHECK_REGISTRY.length);
      for (const entry of report.checks) {
        if (entry.blockedBy === undefined) continue;
        const blocker = report.checks.find((candidate) => candidate.id === entry.blockedBy);
        expect(blocker?.status, `${entry.id} is blocked by an ok or missing row`).not.toBe('ok');
      }
    }
  });

  it('omits blockedBy rather than serializing null on rows that stand alone', () => {
    // Consumers distinguish absent additive fields from a present key whose
    // value they do not understand. Null would break that compatibility shape.
    const report = runDoctor({
      cwd: populated('collapse-omitted', resolve(PACKAGE_ROOT, 'dist/commitlore.mjs')),
    });

    for (const entry of report.checks) {
      if (entry.blockedBy !== undefined) continue;
      expect(Object.keys(entry), `${entry.id} carries a null blocker`).not.toContain('blockedBy');
    }
    expect(JSON.stringify(report)).not.toContain('"blockedBy":null');
  });
});
