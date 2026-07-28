import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLI_ENTRY } from '../hooks-settings.ts';
import { command, git } from './shared.ts';
import type { RowBase, SurvivalOperation, SurvivalRow } from './types.ts';

const SOURCE_PATH = 'src/subject.ts';
const RENAMED_PATH = 'src/renamed.ts';

const recordMessage = (index: number): string =>
  [
    `Record decision ${index}`,
    '',
    `Limit: deterministic constraint ${index}`,
    `Ruled-out: discarded option ${index} | it lost for deterministic reason ${index}`,
    `Warn: preserve record ${index} through history rewriting`,
    'Blast: local',
    'Undo: easy',
    'Certainty: firm',
    `Record-Id: r-det${String(index).padStart(4, '0')}`,
    '',
  ].join('\n');

const configureRepo = (repo: string): void => {
  git(repo, ['config', 'user.name', 'CommitLore Deterministic Bench']);
  git(repo, ['config', 'user.email', 'bench@commitlore.invalid']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'core.hooksPath', '/dev/null']);
};

const buildSource = (scratch: string, total: number): string => {
  const repo = join(scratch, 'survival-source');
  mkdirSync(join(repo, 'src'), { recursive: true });
  git(repo, ['init', '-q', '-b', 'main', '--template=']);
  configureRepo(repo);
  writeFileSync(join(repo, SOURCE_PATH), 'export const value = 0;\n');
  git(repo, ['add', SOURCE_PATH]);
  git(repo, ['commit', '-q', '-m', 'Seed history']);
  git(repo, ['checkout', '-q', '-b', 'feature']);
  for (let index = 1; index <= total; index += 1) {
    writeFileSync(join(repo, SOURCE_PATH), `export const value = ${index};\n`);
    git(repo, ['add', SOURCE_PATH]);
    git(repo, ['commit', '-q', '--cleanup=verbatim', '-F', '-'], {
      input: recordMessage(index),
    });
  }
  return repo;
};

const cloneFor = (source: string, scratch: string, operation: SurvivalOperation): string => {
  const repo = join(scratch, `survival-${operation}`);
  command('git', ['clone', '--quiet', '--no-local', source, repo], { cwd: scratch });
  configureRepo(repo);
  git(repo, ['branch', 'main', 'origin/main']);
  git(repo, ['checkout', '-q', 'feature']);
  return repo;
};

const historyCount = (repo: string): number => {
  const output = git(repo, ['log', '--format=%(trailers:key=Record-Id,valueonly)', 'HEAD']).stdout;
  return new Set(output.split('\n').filter((value) => value.startsWith('r-det'))).size;
};

const pathCount = (repo: string): number => {
  const result = command(
    process.execPath,
    [CLI_ENTRY, 'context', RENAMED_PATH, '--json', '--no-index', '--all-history'],
    { cwd: repo, allowed: [0, 3] },
  );
  const parsed: unknown = JSON.parse(result.stdout);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('context returned non-object JSON');
  const records = Reflect.get(parsed, 'records');
  if (!Array.isArray(records)) throw new Error('context JSON omitted records');
  return new Set(
    records
      .map((record) =>
        typeof record === 'object' && record !== null ? Reflect.get(record, 'recordId') : undefined,
      )
      .filter((value): value is string => typeof value === 'string' && value.startsWith('r-det')),
  ).size;
};

const replayCommits = (repo: string): void => {
  const commits = git(repo, ['rev-list', '--reverse', 'main..feature']).stdout
    .split('\n')
    .filter((value) => value !== '');
  git(repo, ['checkout', '-q', 'main']);
  git(repo, ['cherry-pick', ...commits]);
};

const applyOperation = (repo: string, operation: SurvivalOperation): 'history' | 'path-query' => {
  switch (operation) {
    case 'interactive-rebase':
      git(repo, ['rebase', '-i', '--root', '--force-rebase'], {
        env: { ...process.env, GIT_SEQUENCE_EDITOR: ':' },
      });
      return 'history';
    case 'rebase-onto':
      git(repo, ['checkout', '-q', '-b', 'onto-base', 'main']);
      writeFileSync(join(repo, 'onto.txt'), 'new base\n');
      git(repo, ['add', 'onto.txt']);
      git(repo, ['commit', '-q', '-m', 'Advance target base']);
      git(repo, ['checkout', '-q', 'feature']);
      git(repo, ['rebase', '--onto', 'onto-base', 'main', 'feature']);
      return 'history';
    case 'squash-merge':
      git(repo, ['checkout', '-q', 'main']);
      git(repo, ['config', '--unset', 'core.hooksPath']);
      command(process.execPath, [CLI_ENTRY, 'init'], { cwd: repo, allowed: [0, 1] });
      git(repo, ['merge', '--squash', 'feature']);
      git(repo, ['commit', '-q', '-m', 'Squash feature']);
      return 'history';
    case 'cherry-pick':
      replayCommits(repo);
      return 'history';
    case 'filter-branch':
      git(repo, ['filter-branch', '--force', '--msg-filter', 'cat', '--', 'feature'], {
        env: { ...process.env, FILTER_BRANCH_SQUELCH_WARNING: '1' },
      });
      return 'history';
    case 'rename':
      git(repo, ['mv', SOURCE_PATH, RENAMED_PATH]);
      git(repo, ['commit', '-q', '-m', 'Rename subject']);
      return 'path-query';
    case 'rename-heavy-edit':
      git(repo, ['mv', SOURCE_PATH, RENAMED_PATH]);
      writeFileSync(
        join(repo, RENAMED_PATH),
        Array.from({ length: 200 }, (_, index) => `export const replacement${index} = ${index};`).join(
          '\n',
        ) + '\n',
      );
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-q', '-m', 'Rename and replace subject']);
      return 'path-query';
  }
};

export const measureSurvival = (
  base: RowBase,
  scratch: string,
  total: number,
): readonly SurvivalRow[] => {
  const source = buildSource(scratch, total);
  const operations: readonly SurvivalOperation[] = [
    'interactive-rebase',
    'rebase-onto',
    'squash-merge',
    'cherry-pick',
    'filter-branch',
    'rename',
    'rename-heavy-edit',
  ];
  return operations.map((operation) => {
    const repo = cloneFor(source, scratch, operation);
    const method = applyOperation(repo, operation);
    const measurement = method === 'history' ? 'historyCount' : 'pathCount';
    const survived = measurement === 'historyCount' ? historyCount(repo) : pathCount(repo);
    const outcome = measurement === 'historyCount' ? 'history-retention' : 'path-reachability';
    return { ...base, metric: 'record_survival', operation, outcome, measurement, survived, total, rate: survived / total };
  });
};
