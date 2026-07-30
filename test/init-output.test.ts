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
