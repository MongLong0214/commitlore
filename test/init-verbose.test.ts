/**
 * T-1013 (#205) — `init --verbose` flag.
 *
 * Tests the contract: `--verbose` produces the step-by-step `[1/4]`…`[4/4]`
 * output with indented detail lines. The default (no flag) stays result-oriented.
 * `--json` is unchanged regardless of `--verbose`.
 */

import { describe, expect, it } from 'vitest';

import {
  formatInitReport,
  formatInitReportVerbose,
  STEP_HEADING,
  VERBOSE_INDENT,
  type InitReport,
} from '../src/commands/init.js';

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

const failedReport: InitReport = {
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
      code: 1,
      lines: ['could not verify remote push — remote appears unreachable'],
      detail: {} as never,
    },
  ],
  exitCode: 2,
};

describe('formatInitReportVerbose — step-by-step [1/4]…[4/4] output', () => {
  it('produces output with all four step headings', () => {
    const output = formatInitReportVerbose(cleanReport);
    expect(output).toContain(STEP_HEADING.hooks);
    expect(output).toContain(STEP_HEADING.index);
    expect(output).toContain(STEP_HEADING['claude-hook']);
    expect(output).toContain(STEP_HEADING.doctor);
  });

  it('detail lines are indented with VERBOSE_INDENT', () => {
    const output = formatInitReportVerbose(cleanReport);
    const lines = output.split('\n');
    // After each heading, detail lines should be indented
    const indentedLines = lines.filter((line) => line.startsWith(VERBOSE_INDENT));
    expect(indentedLines.length).toBeGreaterThanOrEqual(4);
  });

  it('step headings appear in sequential order [1/4] through [4/4]', () => {
    const output = formatInitReportVerbose(cleanReport);
    const idx1 = output.indexOf('[1/4]');
    const idx2 = output.indexOf('[2/4]');
    const idx3 = output.indexOf('[3/4]');
    const idx4 = output.indexOf('[4/4]');
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
    expect(idx4).toBeGreaterThan(idx3);
  });

  it('failures are visible in verbose output — never hidden', () => {
    const output = formatInitReportVerbose(failedReport);
    // The hooks failure detail must be visible
    expect(output).toContain('foreign hook exists');
    // The doctor warning must be visible
    expect(output).toContain('could not verify remote push');
  });

  it('verbose output differs from default output', () => {
    const defaultOutput = formatInitReport(cleanReport);
    const verboseOutput = formatInitReportVerbose(cleanReport);
    expect(verboseOutput).not.toEqual(defaultOutput);
    // Verbose has headings; default does not
    expect(defaultOutput).not.toContain('[1/4]');
    expect(verboseOutput).toContain('[1/4]');
  });
});

describe('init --verbose CLI integration', () => {
  it('the --verbose option is registered on the init command', async () => {
    // Importing the register function and checking the command accepts --verbose
    const { register } = await import('../src/commands/init.js');
    const { Command } = await import('commander');
    const program = new Command();
    register(program);
    const initCmd = program.commands.find((cmd) => cmd.name() === 'init');
    expect(initCmd).toBeDefined();
    const verboseOpt = initCmd!.options.find((opt) => opt.long === '--verbose');
    expect(verboseOpt).toBeDefined();
  });
});
