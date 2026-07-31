/**
 * #296: `doctor` prescribes `commitlore hooks install` for a stale
 * `commitlore.bin`, and running it changes nothing.
 *
 * The reported cause was a short-circuit on "already installed (unchanged)".
 * `recordBinPath` is in fact called on every install, so that is not it. The
 * cause is that it records `resolve(process.argv[1])` without checking the
 * result exists: when the CLI is invoked by bare name and `argv[1]` is the typed
 * string rather than a path, `resolve` produces `<cwd>/commitlore` — the exact
 * value in the report, a path that has never existed. Re-running records the
 * same wrong value, which is why the prescribed remedy appears inert.
 *
 * The fix is to validate before recording. These tests drive the resolution
 * directly, because reproducing the reported `argv[1]` needs a compiled binary
 * that ADR-0026 removed from the product.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { resolveEntryForRecord } from '../src/commands/hooks.js';

const scratch: string[] = [];
const dir = (label: string): string => {
  const d = mkdtempSync(join(tmpdir(), `commitlore-296-${label}-`));
  scratch.push(d);
  return d;
};
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

describe('#296 the recorded entry point must exist', () => {
  it('records an absolute path that exists', () => {
    const d = dir('abs');
    const entry = join(d, 'commitlore.mjs');
    writeFileSync(entry, '// bundle\n');
    expect(resolveEntryForRecord(entry, d)).toBe(entry);
  });

  it('records nothing for a bare name that is on no PATH entry', () => {
    // This is the report's shape: a bare name with nothing beside the repository
    // to resolve it to. The old code produced <repo>/commitlore, which never
    // existed; nothing is the correct answer. PATH is emptied so the machine's
    // own installation cannot satisfy the lookup.
    const d = dir('bare');
    const previous = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      expect(resolveEntryForRecord('commitlore', d)).toBeNull();
    } finally {
      process.env['PATH'] = previous;
    }
  });

  it('resolves a bare name through PATH when one is there', () => {
    const bin = dir('path');
    const real = join(bin, 'commitlore');
    writeFileSync(real, '#!/bin/sh\nexit 0\n');
    chmodSync(real, 0o755);
    const previous = process.env['PATH'];
    process.env['PATH'] = `${bin}:${previous ?? ''}`;
    try {
      expect(resolveEntryForRecord('commitlore', dir('cwd'))).toBe(real);
    } finally {
      process.env['PATH'] = previous;
    }
  });

  it('refuses a candidate that exists but is a directory', () => {
    const bin = dir('dirbin');
    mkdirSync(join(bin, 'commitlore'));
    const previous = process.env['PATH'];
    process.env['PATH'] = bin;
    try {
      expect(resolveEntryForRecord('commitlore', dir('dircwd'))).toBeNull();
    } finally {
      process.env['PATH'] = previous;
    }
  });

  it('refuses a relative path whose target does not exist', () => {
    const d = dir('rel');
    expect(resolveEntryForRecord('./commitlore', d)).toBeNull();
  });
});

describe('#296 install does not record a path that does not exist', () => {
  it('leaves commitlore.bin unset rather than recording a fabricated path', async () => {
    const repo = dir('repo');
    execFileSync('git', ['init', '--quiet'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't@e.invalid'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo });

    const { installHook } = await import('../src/commands/hooks.js');
    const previousArgv = process.argv[1];
    const previousPath = process.env['PATH'];
    // What the report saw: a bare name with nothing to resolve it to. PATH is
    // emptied so this machine's own installation cannot stand in for it.
    process.argv[1] = 'commitlore';
    process.env['PATH'] = '';
    let recorded: string | null = null;
    try {
      const result = installHook({ cwd: repo });
      // HookResult carries an exit code, not an ok flag. With PATH emptied the
      // install may not complete at all; either way the fabricated path must not
      // be recorded, which is what the assertion below checks.
      expect([0, 2]).toContain(result.code);
      try {
        recorded = execFileSync('git', ['config', '--local', '--get', 'commitlore.bin'], {
          cwd: repo,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        recorded = null; // unset, which is the desired outcome
      }
    } finally {
      process.argv[1] = previousArgv;
      process.env['PATH'] = previousPath;
    }
    // The fabricated path is the defect. Either nothing is recorded, or something
    // that exists is — never <repo>/commitlore.
    expect(recorded).not.toBe(join(repo, 'commitlore'));
  });
});
