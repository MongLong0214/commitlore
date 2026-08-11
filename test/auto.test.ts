/** #527 — `auto status` reports whether the policy can begin a capture. */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAutoStatus } from '../src/commands/auto.js';
import { POLICY_FILE_NAME } from '../src/core/capture-policy.js';
import { createTestRepo } from './git-fixtures.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const scratch: string[] = [];

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

beforeAll(() => {
  const build = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`tsc build failed (exit ${String(build.status)}):\n${build.stdout}${build.stderr}`);
  }
}, 120_000);

const unattendedRepo = (): string => {
  const repo = createTestRepo({ path: mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-auto-')) });
  scratch.push(repo);
  writeFileSync(join(repo, POLICY_FILE_NAME), '{ "unattended": true }\n');
  return repo;
};

describe('#527 auto status', () => {
  it('distinguishes policy consent from a capture start trigger', () => {
    const status = runAutoStatus(unattendedRepo());
    if ('outsideRepository' in status) throw new Error('test repository was not recognised');

    expect(status.unattended).toBe(true);
    expect(status.unattendedStart).toBe('agent-host-required');
  });

  it('states that an ordinary git commit cannot begin capture', () => {
    const result = spawnSync(process.execPath, [CLI, 'auto', 'status'], {
      cwd: unattendedRepo(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('policy permits host-driven capture');
    expect(result.stdout).toContain('ordinary git commits only apply a staged transaction');
    expect(result.stdout).toContain('commitlore_prepare_capture');
  });
});
