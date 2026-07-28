import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { CLI_ENTRY } from '../hooks-settings.ts';
import { command, git, timing } from './shared.ts';
import type { HookOverheadRow, RowBase, Timing } from './types.ts';

const configureRepo = (repo: string): void => {
  git(repo, ['config', 'user.name', 'CommitLore Deterministic Bench']);
  git(repo, ['config', 'user.email', 'bench@commitlore.invalid']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'core.hooksPath', join(repo, '.git', 'hooks')]);
};

const makeRepo = (scratch: string, label: string): string => {
  const repo = join(scratch, label);
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main', '--template=']);
  configureRepo(repo);
  writeFileSync(join(repo, 'subject.ts'), 'export const value = 0;\n');
  git(repo, ['add', 'subject.ts']);
  git(repo, ['commit', '-q', '--no-verify', '-m', 'Seed repository']);
  return repo;
};

const timeCommits = (repo: string, runs: number): Timing => {
  let sequence = 0;
  return timing(() => {
    sequence += 1;
    git(repo, ['commit', '-q', '--allow-empty', '-m', `Measured commit ${sequence}`]);
  }, runs);
};

const commitMsgOverhead = (
  base: RowBase,
  scratch: string,
  runs: number,
): HookOverheadRow => {
  const withoutRepo = makeRepo(scratch, 'commit-without-hook');
  const withRepo = makeRepo(scratch, 'commit-with-hook');
  command(process.execPath, [CLI_ENTRY, 'hooks', 'install'], { cwd: withRepo });

  const withoutHook = timeCommits(withoutRepo, runs);
  const withHook = timeCommits(withRepo, runs);
  return overheadRow(base, 'commit-msg', withoutHook, withHook);
};

const seedInjectionRecord = (repo: string): void => {
  writeFileSync(join(repo, 'subject.ts'), 'export const value = 1;\n');
  git(repo, ['add', 'subject.ts']);
  git(repo, ['commit', '-q', '--cleanup=verbatim', '-F', '-'], {
    input: [
      'Record edit constraint',
      '',
      'Warn: preserve the stable wire format while editing this file',
      'Blast: local',
      'Undo: easy',
      'Certainty: firm',
      'Record-Id: r-hook01',
      '',
    ].join('\n'),
  });
  command(process.execPath, [CLI_ENTRY, 'index', '--rebuild', '--json'], { cwd: repo });
};

const preToolUseOverhead = (
  base: RowBase,
  scratch: string,
  runs: number,
): HookOverheadRow => {
  const repo = makeRepo(scratch, 'pre-tool-use-hook');
  seedInjectionRecord(repo);
  const path = resolve(repo, 'subject.ts');
  const payload = `${JSON.stringify({ cwd: repo, tool_input: { file_path: path } })}\n`;
  let sequence = 0;
  const edit = (): void => {
    sequence += 1;
    writeFileSync(path, `export const value = ${sequence};\n`);
  };

  const withoutHook = timing(edit, runs);
  writeFileSync(path, 'export const value = 1;\n');
  const withHook = timing(() => {
    command(process.execPath, [CLI_ENTRY, 'inject', '--hook-input'], {
      cwd: repo,
      input: payload,
    });
    edit();
  }, runs);
  return overheadRow(base, 'pre-tool-use-inject', withoutHook, withHook);
};

const overheadRow = (
  base: RowBase,
  hook: HookOverheadRow['hook'],
  withoutHook: Timing,
  withHook: Timing,
): HookOverheadRow => ({
  ...base,
  metric: 'hook_overhead',
  hook,
  without_hook: withoutHook,
  with_hook: withHook,
  delta_p50_ms: withHook.p50_ms - withoutHook.p50_ms,
  delta_p95_ms: withHook.p95_ms - withoutHook.p95_ms,
});

export const measureHookOverhead = (
  base: RowBase,
  scratch: string,
  runs: number,
): readonly HookOverheadRow[] => [
  commitMsgOverhead(base, scratch, runs),
  preToolUseOverhead(base, scratch, runs),
];
