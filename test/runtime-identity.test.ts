/**
 * F-001: all things called "commitlore" must prove they are the same runtime,
 * not merely print the same command name.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { runDoctor } from '../src/commands/doctor.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

const install = (version: string, schema: number, assets = true): string => {
  const root = mkdtempSync(join(tmpdir(), 'commitlore-runtime-identity-'));
  scratch.push(root);
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist', 'commitlore.mjs'), '');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'commitlore', version, commitlore: { indexSchemaVersion: schema } }),
  );
  if (assets) {
    mkdirSync(join(root, 'spec', 'schema'), { recursive: true });
    writeFileSync(join(root, 'spec', 'schema', 'record.schema.json'), '{}');
  }
  return root;
};

describe('F-001 runtime identity convergence', () => {
  it('reports a hook pin whose version and package root differ from the PATH CLI', async () => {
    const identity = await import('../src/core/runtime-identity.js');
    const cli = install('0.8.2', 4);
    const hook = install('0.8.0', 3);
    const repo = createTestRepo({ path: mkdtempSync(join(tmpdir(), 'commitlore-runtime-hook-')) });
    scratch.push(repo);
    expect(execGit(['config', '--local', 'commitlore.bin', join(hook, 'dist', 'commitlore.mjs')], { cwd: repo }).code).toBe(0);
    expect(execGit(['config', '--local', 'commitlore.root', hook], { cwd: repo }).code).toBe(0);
    const report = runDoctor({ cwd: repo }).checks.find((check) => check.id === 'runtime-identity');

    expect(report?.status).toBe('warn');
    expect(report?.detail).toContain('hook');
    expect(report?.detail).toContain('0.8.0');
    expect(report?.fix).toContain('commitlore hooks install');
  });

  it('rejects an MCP package root missing the asset capture loads', async () => {
    const identity = await import('../src/core/runtime-identity.js');
    const mcp = install('0.8.2', 4, false);
    const observed = identity.runtimeIdentity(join(mcp, 'dist', 'commitlore.mjs'));

    expect(identity.runtimeAssetProblems(observed)).toEqual([
      join(observed.packageRoot, 'spec', 'schema', 'record.schema.json'),
    ]);
  });

  it('does not leave a v4 index permanently on the full-scan path of a v3 reader', async () => {
    const identity = await import('../src/core/runtime-identity.js');
    const writer = install('0.8.2', 4);
    const reader = install('0.8.0', 3);
    const report = identity.convergeIndexSchema({
      writer: identity.runtimeIdentity(join(writer, 'dist', 'commitlore.mjs')),
      reader: identity.runtimeIdentity(join(reader, 'dist', 'commitlore.mjs')),
    });

    expect(report.ok).toBe(false);
    expect(report.fix).toBe('commitlore index --rebuild');
    expect(report.detail).toContain('writer schema v4');
    expect(report.detail).toContain('reader schema v3');
  });
});
