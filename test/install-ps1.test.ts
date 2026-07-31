/**
 * T-1121 (#282) — `install.ps1` implements the same contract as `install.sh`.
 *
 * PRD-F14 requirements 16-19.
 *
 * These are shape assertions, and shape is not the evidence. The evidence is the
 * `windows-latest` CI job that runs the script on a real runner: prerequisites,
 * checkout, shim, re-run, and a repository that ends up with a working hook.
 * What this file is for is the part a Windows runner cannot show cheaply --
 * that the two installers agree, clause by clause, on the decisions that were
 * already argued out for the shell one.
 *
 * Two of those decisions exist because this project shipped the defect they
 * forbid, and both are recorded on `install.sh`:
 *
 *   - the installer never edits the user's environment. Printing the line is
 *     honest; writing it silently is what makes people distrust a piped
 *     installer. A user-scope `PATH` write is that same act in Windows spelling.
 *   - post-install verification never decides the exit code. An install that
 *     succeeded must not be failed by a check that could not run.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PS1 = join(REPO_ROOT, 'install.ps1');
const SH = join(REPO_ROOT, 'install.sh');

const body = (): string => readFileSync(PS1, 'utf8');

describe('T-1121 install.ps1 exists and matches install.sh clause for clause', () => {
  it('is ASCII only, like its shell twin', () => {
    // A non-ASCII character in a string silently terminated `/bin/sh` in
    // install.sh's history while `sh -n` accepted the file. A script that
    // arrives down a pipe has no encoding declaration to fall back on either.
    const bytes = readFileSync(PS1);
    const offenders = [...bytes.entries()].filter(([, byte]) => byte > 127);
    expect(offenders.map(([index]) => index)).toEqual([]);
  });

  it('checks Node and Git before writing anything', () => {
    const text = body();
    const nodeCheck = text.indexOf('NodeMajorMin = 22');
    const gitCheck = text.indexOf('git --version');
    const firstWrite = text.indexOf('New-Item -ItemType Directory');
    expect(nodeCheck).toBeGreaterThan(-1);
    expect(gitCheck).toBeGreaterThan(-1);
    expect(nodeCheck).toBeLessThan(firstWrite);
    expect(gitCheck).toBeLessThan(firstWrite);
    // The same floor as the shell script and package.json, not a second opinion.
    expect(readFileSync(SH, 'utf8')).toContain('NODE_MAJOR_MIN=22');
  });

  it('names the missing prerequisite and says nothing was installed', () => {
    const text = body();
    for (const phrase of [
      // The floor is interpolated from one constant rather than typed twice, so
      // the source carries the variable and the user sees the number.
      'Node.js $NodeMajorMin or newer is required',
      'Git is required',
      'Nothing was installed',
    ]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it('uses the same exit codes for the same conditions', () => {
    const text = body();
    // 1 prerequisite or usage, 2 fetch, 4 occupied destination.
    expect(text).toMatch(/Stop-Install "Node\.js \$NodeMajorMin or newer is required[\s\S]*?" 1/);
    expect(text).toMatch(/could not fetch \$Version[\s\S]*?" 2/);
    expect(text).toMatch(/refusing to overwrite it[\s\S]*?" 4/);
  });

  it('installs a pinned tag and never resolves a branch', () => {
    const text = body();
    expect(text).toContain('git ls-remote --tags --refs');
    expect(text).toMatch(/refs\/tags\/\(v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\)\$/);
    expect(text).toContain('--branch $Version');
  });

  it('writes a shim that runs node against the bundle, and nothing compiled', () => {
    const text = body();
    expect(text).toContain('dist\\commitlore.mjs');
    expect(text).toContain(':: commitlore:wrapper:v1');
    for (const forbidden of ['SHA256SUMS', '.tar.gz', 'releases/download', '.exe"', 'postject']) {
      expect(text, `${forbidden} must not appear`).not.toContain(forbidden);
    }
  });

  it('writes the shim with CRLF, which cmd.exe requires', () => {
    // Not a preference: a batch file with LF endings is mis-parsed in ways that
    // depend on the line, and a `set` can swallow the one after it.
    expect(body()).toContain('-join "`r`n"');
  });

  it('installs user-local, with no elevation and no machine-wide write', () => {
    const text = body();
    expect(text).toContain('$env:LOCALAPPDATA');
    // Comment lines are excluded: the header says what this script does *not* do,
    // and forbidding the words there would forbid saying so.
    const code = text
      .split('\n')
      .filter((line) => !/^\s*(#|<#|\s*\w*\s*-)/.test(line) && !line.trimStart().startsWith('#'))
      .join('\n');
    for (const forbidden of ['Program Files', 'RunAs', 'requireAdministrator', "'Machine'"]) {
      expect(code, `${forbidden} must not appear in code`).not.toContain(forbidden);
    }
  });

  it('prints the PATH instruction instead of writing PATH', () => {
    const text = body();
    expect(text).toContain('is not on PATH');
    // The printed instruction names the User scope, which is what a reader would
    // run. What must not happen is this script running it.
    const writes = text
      .split('\n')
      .filter((line) => line.includes('SetEnvironmentVariable'))
      .filter((line) => !line.trimStart().startsWith('Write-Log'));
    expect(writes).toEqual([]);
  });

  it('lets verification report without deciding the exit code', () => {
    const text = body();
    expect(text).toContain('installed, but unverified');
    // The retry, then exit 0 regardless.
    expect(text).toContain('Start-Sleep -Seconds 1');
    const lastExit = text.lastIndexOf('exit 0');
    expect(lastExit).toBeGreaterThan(text.indexOf('installed, but unverified'));
  });

  it('is re-runnable: an existing checkout and an existing shim are both upgrades', () => {
    const text = body();
    expect(text).toContain('reusing the existing checkout at');
    expect(text).toContain('upgrading the existing commitlore shim at');
    expect(text).toContain('already mentions commitlore -- left unchanged');
  });

  it('writes the shim beside the target and moves it into place', () => {
    const text = body();
    expect(text).toContain('$destTmp');
    expect(text).toMatch(/Move-Item -LiteralPath \$destTmp/);
  });

  it('runs on Windows PowerShell 5.1: no 7-only syntax', () => {
    const text = body();
    // The ternary and null-coalescing operators are PowerShell 7+. A 5.1 host
    // fails to parse the whole file, so one use makes the script unusable on the
    // version most Windows machines have by default.
    expect(text).not.toMatch(/\?\?/);
    expect(text).not.toMatch(/\s\?\s[^\s]+\s:\s/);
  });

  it('does not claim Windows is supported', () => {
    // That claim has a precondition owned by T-1124: #71's install-root
    // containment has to hold on Windows first.
    const text = body().toLowerCase();
    expect(text).not.toContain('windows is supported');
    expect(text).not.toContain('windows support is complete');
  });

  it('is exercised by a windows-latest CI job that runs it', () => {
    const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('windows-latest');
    expect(ci).toContain('install.ps1');
  });
  it('takes the first node on PATH, not every match', () => {
    // Found by the Windows runner, not by reading: `Get-Command` returns every
    // match, a hosted runner carries two `node.exe`, and the array turned the
    // version check into an invocation of two paths joined by a space. The first
    // match is also the correct one -- it is what typing `node` would run.
    expect(body()).toMatch(/Get-Command node[^\n]*\| Select-Object -First 1/);
  });
});
