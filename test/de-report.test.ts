/**
 * The saved-evidence report — #1037, revision `native-efficacy-r6.1`.
 *
 * "All modes use saved evidence only and perform zero model/checker calls."
 * "Start from the complete planned schedule … Preserve unstarted, failed and
 *  unknown rows, not only surviving successful files."
 * "Show feedback-pass/audit-fail with zero repair as a detector miss, not
 *  avoided rework."
 *
 * The fixtures here are episode files on disk, because that is what a report
 * actually reads. One case drives the whole thing through the real execution
 * loop first, so the report is exercised against evidence the runner wrote
 * rather than against a shape a test invented.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { buildReport, renderReport, readEpisode } from '../bench/de/report.ts';
import { planSchedule, type Arm, type ScheduledPair } from '../bench/de/schedule.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const runDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'de-report-'));
  roots.push(dir);
  return dir;
};

const arm = (
  name: Arm,
  over: { score?: boolean | null; audit?: boolean | null; repair?: string; handoff?: string } = {},
) => ({
  arm: name,
  capture: { handoff: over.handoff ?? 'valid', committed: 'sha' },
  solve:
    over.score === undefined && over.handoff === 'terminal_failure'
      ? null
      : {
          execution: 'completed',
          checkpoint: 'complete',
          // `over.score ?? true` turns an explicit `null` into `true`, which is
          // the `value || 0` mistake the accounting module forbids -- and it
          // silently made an unresolved row look like a pass here.
          feedback: {
            trusted: true,
            verdict: { score: 'score' in over ? over.score! : true },
            public_explanation: true,
            environment_fault: false,
          },
          artifact: 'sha',
        },
  repairChoice: { decision: over.repair ?? 'not_triggered', rule: 5, reason: 'fixture' },
  repair: null,
  audit: 'audit' in over ? { verdict: { score: over.audit! } } : { verdict: { score: true } },
  notes: [],
});

const writeEpisode = (dir: string, pair: ScheduledPair, arms: unknown[]): void => {
  const pairDir = join(dir, `${pair.case_id}-rep${String(pair.repetition)}`);
  mkdirSync(pairDir, { recursive: true });
  writeFileSync(
    join(pairDir, 'episode.json'),
    JSON.stringify({ pair, solveInstant: 't1', repairInstant: 't2', arms }),
  );
};

const plan = planSchedule({
  cases: [
    { id: 'c1', cluster_id: 'repo-a' },
    { id: 'c2', cluster_id: 'repo-b' },
  ],
  repeat: 1,
  seed: 'report',
});

const inputs = (dir: string) => ({ plan, sourceGroupOf: () => 'g1', runDir: dir });

describe('#1037 the report starts from the plan', () => {
  it('keeps a planned pair whose episode never landed', () => {
    // Episodes that go missing are the ones that crashed or were never
    // reached. Iterating the directory would drop exactly those.
    const dir = runDir();
    writeEpisode(dir, plan[0]!, [arm('off'), arm('native')]);

    const report = buildReport(inputs(dir));

    expect(report.planned_pairs).toBe(2);
    expect(report.episodes_present).toBe(1);
    expect(report.rows).toHaveLength(4);
    expect(report.rows.filter((row) => row.status === 'unobserved')).toHaveLength(2);
  });

  it('treats an unreadable episode as absent rather than as a result', () => {
    const dir = runDir();
    const pairDir = join(dir, `${plan[0]!.case_id}-rep1`);
    mkdirSync(pairDir, { recursive: true });
    writeFileSync(join(pairDir, 'episode.json'), '{ not json');

    expect(readEpisode(dir, plan[0]!)).toBeNull();
    expect(buildReport(inputs(dir)).episodes_present).toBe(0);
  });
});

describe('#1037 the numbers carry what qualifies them', () => {
  it('withholds the difference when one arm has no mean', () => {
    const dir = runDir();
    writeEpisode(dir, plan[0]!, [arm('off', { score: true }), arm('native', { score: null })]);
    writeEpisode(dir, plan[1]!, [arm('off', { score: true }), arm('native', { score: null })]);

    const report = buildReport(inputs(dir));

    expect(report.h1.off.value).toBe(1);
    expect(report.h1.native.value).toBeNull();
    expect(report.h1.differencePoints).toBeNull();
    expect(renderReport(report)).toMatch(/withheld — one arm has no mean/);
  });

  it('withholds the relative reduction when the control is zero', () => {
    const dir = runDir();
    writeEpisode(dir, plan[0]!, [arm('off', { score: false }), arm('native', { score: true })]);
    writeEpisode(dir, plan[1]!, [arm('off', { score: false }), arm('native', { score: true })]);

    const report = buildReport(inputs(dir));

    expect(report.h1.differencePoints).toBe(100);
    expect(report.h1.relativeReduction).toBeNull();
    expect(renderReport(report)).toMatch(/needs both means and a positive control/);
  });

  it('prints the observed, unresolved and group counts beside each mean', () => {
    const dir = runDir();
    writeEpisode(dir, plan[0]!, [arm('off'), arm('native')]);

    const rendered = renderReport(buildReport(inputs(dir)));

    expect(rendered).toMatch(/OFF .*1\/2 rows observed, 1 unresolved, 1 source group/);
  });
});

describe('#1037 a detector miss is not avoided rework', () => {
  it('counts feedback-pass with audit-fail and no repair', () => {
    // "Show feedback-pass/audit-fail with zero repair as a detector miss."
    // Counting it as a success is how a study congratulates itself for a
    // failure nobody caught.
    const dir = runDir();
    writeEpisode(dir, plan[0]!, [
      arm('off', { score: true, audit: false, repair: 'not_triggered' }),
      arm('native', { score: true, audit: true }),
    ]);

    const report = buildReport(inputs(dir));

    expect(report.detector_misses).toHaveLength(1);
    expect(report.detector_misses[0]!.arm).toBe('off');
  });

  it('does not count it when a repair actually ran', () => {
    const dir = runDir();
    writeEpisode(dir, plan[0]!, [
      arm('off', { score: true, audit: false, repair: 'repair' }),
      arm('native', { score: true }),
    ]);

    expect(buildReport(inputs(dir)).detector_misses).toHaveLength(0);
  });

  it('keeps the audit verdict beside the first score rather than merging them', () => {
    const dir = runDir();
    writeEpisode(dir, plan[0]!, [arm('off', { score: true, audit: false }), arm('native')]);

    const observed = buildReport(inputs(dir)).observations.find((entry) => entry.arm === 'off')!;

    expect(observed.score).toBe(true);
    expect(observed.audit_score).toBe(false);
  });
});

describe('#1037 a terminal handoff is shown, not dropped', () => {
  it('reports it beside the rows that did run', () => {
    const dir = runDir();
    writeEpisode(dir, plan[0]!, [
      { ...arm('off'), capture: { handoff: 'terminal_failure', committed: null }, solve: null, audit: null },
      arm('native'),
    ]);

    const report = buildReport(inputs(dir));

    expect(report.terminal_handoffs).toHaveLength(1);
    expect(report.rows).toHaveLength(4);
    expect(renderReport(report)).toMatch(/terminal handoff failures: 1/);
  });
});

describe('#1037 the report calls nothing', () => {
  it('says so, and reads only what is on disk', () => {
    const dir = runDir();
    writeEpisode(dir, plan[0]!, [arm('off'), arm('native')]);

    expect(renderReport(buildReport(inputs(dir)))).toMatch(/reads saved evidence only/);
  });
});
