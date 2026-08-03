/**
 * T-1012 (#204) — Result-oriented default `init` output.
 *
 * Tests the contract: the default `formatInitReport` output is a concise
 * result summary (≤6 lines for a clean run), does not expose internal
 * command names, and — crucially — never hides a failure or warning.
 */

import { describe, expect, it } from 'vitest';

import { formatInitReport, type InitReport } from '../src/commands/init.js';

const cleanReport: InitReport = {
  steps: [
    { step: 'hooks', title: 'hooks install', code: 0, lines: ['commit-msg hook installed'], detail: {} as never },
    {
      step: 'index',
      title: 'index --rebuild',
      code: 0,
      lines: ['rebuilt: scanned 5 commit(s), indexed 3 trailer(s) in 12ms'],
      detail: {} as never,
    },
    {
      step: 'claude-hook',
      title: 'claude hook install',
      code: 0,
      lines: ['PreToolUse hook registered'],
      detail: {} as never,
    },
    {
      step: 'doctor',
      title: 'doctor --fix',
      code: 0,
      lines: ['all checks passed'],
      detail: {} as never,
    },
  ],
  exitCode: 0,
};

const failedHooksReport: InitReport = {
  steps: [
    {
      step: 'hooks',
      title: 'hooks install',
      code: 2,
      lines: ['foreign hook exists and chained slot occupied — use --force to override'],
      detail: {} as never,
    },
    {
      step: 'index',
      title: 'index --rebuild',
      code: 0,
      lines: ['rebuilt: scanned 5 commit(s), indexed 3 trailer(s) in 12ms'],
      detail: {} as never,
    },
    {
      step: 'claude-hook',
      title: 'claude hook install',
      code: 0,
      lines: ['PreToolUse hook registered'],
      detail: {} as never,
    },
    {
      step: 'doctor',
      title: 'doctor --fix',
      code: 0,
      lines: ['all checks passed'],
      detail: {} as never,
    },
  ],
  exitCode: 2,
};

const warningReport: InitReport = {
  steps: [
    { step: 'hooks', title: 'hooks install', code: 0, lines: ['commit-msg hook installed'], detail: {} as never },
    {
      step: 'index',
      title: 'index --rebuild',
      code: 0,
      lines: ['rebuilt: scanned 5 commit(s), indexed 3 trailer(s) in 12ms'],
      detail: {} as never,
    },
    {
      step: 'claude-hook',
      title: 'claude hook install',
      code: 0,
      lines: ['PreToolUse hook registered'],
      detail: {} as never,
    },
    {
      step: 'doctor',
      title: 'doctor --fix',
      code: 1,
      lines: ['could not verify remote push — remote appears unreachable'],
      detail: {} as never,
    },
  ],
  exitCode: 1,
};

describe('formatInitReport — result-oriented default output', () => {
  it('clean run produces ≤6 lines', () => {
    const output = formatInitReport(cleanReport);
    const nonEmptyLines = output.split('\n').filter(Boolean);
    expect(nonEmptyLines.length).toBeLessThanOrEqual(6);
  });

  it('no internal command names in default output', () => {
    const output = formatInitReport(cleanReport);
    expect(output).not.toContain('interpret-trailers');
    expect(output).not.toContain('notes refspec');
    expect(output).not.toContain('index --rebuild');
  });

  it('failure is visible — a failed step is named with actionable detail', () => {
    const output = formatInitReport(failedHooksReport);
    expect(output).toContain('hooks install');
    expect(output).toContain('could not run');
  });

  it('warning is visible — a step that needs attention is named', () => {
    const output = formatInitReport(warningReport);
    expect(output).toContain('doctor');
    expect(output).toContain('attention');
  });

  it('all step outcomes are represented in clean output', () => {
    const output = formatInitReport(cleanReport);
    // Each of the 4 steps must have some status indicator
    expect(output).toMatch(/hook/i);
    expect(output).toMatch(/index/i);
    expect(output).toMatch(/claude|agent/i);
    expect(output).toMatch(/doctor|check/i);
  });
});

/**
 * #402: `init` reported `ready` on a fresh clone whose `refs/notes/commitlore`
 * had never been fetched, and said nothing about it. That is the default state
 * of a clone — `git fetch` does not carry the ref — and `init` is the one screen
 * most users read.
 *
 * The subtle part, and the reason a naive fix does not work: `init`'s own doctor
 * step writes the notes refspec, which moves the state from `unfetched` to
 * `absent` before the report is formatted. So the state has to be captured
 * before any step runs. These pin both halves — that the line appears from the
 * captured state, and that it does not appear otherwise.
 */
describe('#402 init names an unfetched notes mirror', () => {
  const withNotes = (notesBefore: InitReport['notesBefore']): InitReport => ({
    ...cleanReport,
    notesBefore,
  });

  it('says so when the mirror was unfetched before the run', () => {
    const output = formatInitReport(withNotes('unfetched'));
    expect(output).toContain('has not been fetched');
    expect(output).toContain('git fetch');
  });

  it('still fits the six-line contract with the line present', () => {
    const output = formatInitReport(withNotes('unfetched'));
    expect(output.split('\n').filter(Boolean).length).toBeLessThanOrEqual(6);
  });

  it('stays quiet on every other state, so the line is not a permanent fixture', () => {
    for (const state of ['present', 'absent', 'unavailable'] as const) {
      expect(formatInitReport(withNotes(state))).not.toContain('has not been fetched');
    }
  });

  it('still reports ready — an unfetched mirror is not an init failure', () => {
    expect(formatInitReport(withNotes('unfetched'))).toContain('init: ready');
  });
});
