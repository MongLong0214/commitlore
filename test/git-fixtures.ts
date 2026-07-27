import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

interface InitRepo {
  readonly path: string;
  readonly bare?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly source?: never;
}

interface CloneRepo {
  readonly path: string;
  readonly source: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly branch?: string;
  readonly depth?: number;
  readonly bare?: never;
}

export const createTestRepo = (options: InitRepo | CloneRepo): string => {
  const env = options.env ?? process.env;
  const args =
    'source' in options
      ? [
          'clone',
          '--quiet',
          '--template=',
          ...(options.depth === undefined ? [] : ['--depth', String(options.depth)]),
          ...(options.branch === undefined ? [] : ['--branch', options.branch]),
          options.source,
          options.path,
        ]
      : [
          'init',
          '--quiet',
          '--template=',
          '--initial-branch=main',
          ...(options.bare === true ? ['--bare'] : []),
          options.path,
        ];
  execFileSync('git', args, {
    cwd: dirname(options.path),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!('bare' in options && options.bare === true)) {
    // Production code starts its own Git processes, so invocation-only flags cannot supply identity.
    execFileSync('git', ['config', 'user.name', 'CommitLore Test'], { cwd: options.path, env });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], {
      cwd: options.path,
      env,
    });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: options.path, env });
  }

  return options.path;
};
