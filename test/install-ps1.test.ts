/**
 * T-1121 (#282) — `install.ps1` implements the same contract as `install.sh`.
 *
 * PRD-F14 requirements 16-19.
 *
 * These are shape assertions, and shape is not the evidence. This test runs on
 * a non-Windows host, so it cannot establish PowerShell behavior. The evidence
 * is the `windows-latest` CI job that runs the script on a real runner:
 * prerequisites, checkout, shim, re-run, and a repository that ends up with a
 * working hook. What this file is for is the part a Windows runner cannot show
 * cheaply -- that the two installers agree, clause by clause, on the decisions
 * that were already argued out for the shell one.
 *
 * Two of those decisions exist because this project shipped the defect they
 * forbid, and both are recorded on `install.sh`:
 *
 *   - the installer never edits the user's environment. Printing the line is
 *     honest; writing it silently is what makes people distrust a piped
 *     installer. A user-scope `PATH` write is that same act in Windows spelling.
 *   - runtime verification decides activation. A checkout that proves unusable
 *     cannot be reported as a successful install.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PS1 = join(REPO_ROOT, 'install.ps1');
const SH = join(REPO_ROOT, 'install.sh');
const RUNTIME_MANIFEST = join(REPO_ROOT, 'installer', 'runtime-manifest.txt');

const body = (): string => readFileSync(PS1, 'utf8');

/**
 * A parse error reached CI because nothing here parses the file. PowerShell is
 * not installed on most contributors' machines, so the suite checks shape and
 * the `windows-latest` job is the only thing that ever executes the script —
 * which is correct as a gate and slow as feedback.
 *
 * This catches one mechanically detectable class rather than pretending to be a
 * parser. `"$Label: ..."` reads as a drive-qualified variable and fails to
 * parse; `${Label}:` is the form that works. `$env:NAME` is the legitimate use
 * of that syntax and is excluded.
 */
/**
 * PowerShell promotes a native command's stderr to a terminating error under
 * `$ErrorActionPreference = 'Stop'`, so a harmless warning aborts a run that
 * succeeded. This repository has hit it twice: once when git's "--depth is
 * ignored in local clones" killed a good clone, and again when Node's
 * "ExperimentalWarning: SQLite is an experimental feature" — printed on every
 * single invocation — made the installer's smoke test report that `validate`
 * could not start, and refuse a working installation.
 *
 * The call site that learned it first left a comment explaining the trap. The
 * next author did not read that comment, which is what comments cost. Only the
 * exit code says whether a native command worked, so every invocation runs with
 * the preference relaxed and is judged on its status.
 */
describe('install.ps1 does not let a native command\'s stderr abort a good run', () => {
  it('every native invocation relaxes ErrorActionPreference first', () => {
    const source = readFileSync(PS1, 'utf8');
    const lines = source.split('\n');
    const unguarded: string[] = [];

    for (const [index, line] of lines.entries()) {
      if (!/(?:^|[^`])&\s+\$(?:NodePath|git\b)/.test(line) && !/^\s*&\s+git\s/.test(line)) continue;
      const window = lines.slice(Math.max(0, index - 6), index).join('\n');
      if (!window.includes("$ErrorActionPreference = 'Continue'")) {
        unguarded.push(`${String(index + 1)}: ${line.trim()}`);
      }
    }

    expect(
      unguarded,
      "wrap native calls in $ErrorActionPreference = 'Continue' and judge them by $LASTEXITCODE",
    ).toEqual([]);
  });
});

describe('install.ps1 avoids drive-qualified variable references in strings', () => {
  it('every interpolated variable followed by a colon is brace-delimited', () => {
    const source = readFileSync(PS1, 'utf8');
    const hazards = [...source.matchAll(/\$(?!env:)([A-Za-z_][A-Za-z0-9_]*):/g)].map((match) => {
      const line = source.slice(0, match.index).split('\n').length;
      return `${String(line)}: $${match[1] ?? ''}:`;
    });

    expect(hazards, 'use ${Name}: so PowerShell does not read Name as a drive').toEqual([]);
  });
});

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
    // Helper definitions appear first, but their writes run only after the
    // prerequisites. This is the first write in the installation transaction.
    const firstWrite = text.indexOf('New-Item -ItemType Directory -Force -Path $dataRoot');
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
    // 1 prerequisite or usage, 2 fetch, 3 verified-unusable, 4 occupied
    // destination, 5 verification could not run.
    expect(text).toMatch(/Stop-Install "Node\.js \$NodeMajorMin or newer is required[\s\S]*?" 1/);
    expect(text).toMatch(/could not fetch \$Version[\s\S]*?" 2/);
    expect(text).toMatch(/runtime verification ran and found an unusable path[\s\S]*?" 3/);
    expect(text).toMatch(/refusing to overwrite it[\s\S]*?" 4/);
    expect(text).toMatch(/runtime verification could not run[\s\S]*?" 5/);
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

  it('binds the requested tag and its reported version before activation', () => {
    const text = body();
    expect(text).toContain("$RuntimeManifestPath = 'installer/runtime-manifest.txt'");
    expect(text).toContain("$RuntimeManifestFormat = 'commitlore-runtime-manifest-v1'");
    expect(text).toContain('Test-TrackedRuntimeFile $Root $RuntimeManifestPath');
    expect(text).toContain('Get-Content -LiteralPath $manifestPath');
    expect(text).toContain('Test-LegacyRuntime $Root');
    expect(text).toContain('function Test-RequestedTag');
    expect(text).toContain('Test-RequestedTag $checkout $Version');
    expect(text).toContain('Test-RequestedTag $checkoutTmp $Version');
    expect(text).toContain('Invoke-LegacySmoke $candidate $nodeBin');
    expect(readFileSync(SH, 'utf8')).toContain('RUNTIME_MANIFEST="installer/runtime-manifest.txt"');
    for (const asset of [
      'AGENTS.md',
      'dist/commitlore.mjs',
      'package.json',
      'spec/SPEC.md',
      'spec/schema/record.schema.json',
      'hermes/skills/commitlore/DESCRIPTION.md',
      'hermes/skills/commitlore/commits/SKILL.md',
      'hermes/skills/commitlore/query/SKILL.md',
      'hermes/skills/commitlore/setup/SKILL.md',
    ]) {
      expect(readFileSync(RUNTIME_MANIFEST, 'utf8')).toContain(asset);
    }
    expect(text).toContain('Invoke-IncomingSmoke $candidate $nodeBin');
    expect(text).toContain('if ($version -cne $ExpectedVersion)');
    expect(text).toContain('want requested version');
    expect(text).toContain('validate --message-file $validMessage');
    expect(text).toContain('validate --message-file $invalidMessage');
    expect(text).toContain('doctor --json');
    expect(text.indexOf('Invoke-IncomingSmoke $candidate $nodeBin')).toBeLessThan(text.indexOf('$destTmp ='));
    expect(text).not.toContain('installed, but unverified');
    expect(text).not.toContain('Start-Sleep -Seconds 1');
  });

  it('is re-runnable only after an existing checkout binds to its requested tag', () => {
    const text = body();
    expect(text).toContain('reusing the existing checkout at $checkout (runtime manifest and requested tag verified)');
    expect(text).toContain('upgrading the existing commitlore shim at');
    expect(text).toContain('already mentions commitlore -- left unchanged');
  });

  it('names an explicit manual repair for an unusable existing checkout', () => {
    // The installer must not delete an unverified path by itself. This command
    // is intentionally printed for the operator to run, after which the same
    // installer invocation can materialize a fresh requested checkout.
    const text = body();
    expect(text).toContain('function Stop-UnusableCheckout');
    expect(text).toContain("Remove-Item -LiteralPath '$quotedCheckout' -Recurse -Force");
    expect(text).toContain('Stop-UnusableCheckout $manifest $checkout $dest');
    expect(text).toContain('Stop-UnusableCheckout $smoke $checkout $dest');
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
  it('judges the clone by its exit code, not by whether git printed to stderr', () => {
    // Windows PowerShell 5.1 promotes a native command's stderr to a terminating
    // error under `$ErrorActionPreference = 'Stop'`. A first draft merged git's
    // stderr with `2>&1`, so git's harmless "--depth is ignored in local clones"
    // warning aborted a clone that had succeeded. Only the exit code distinguishes
    // a warning from a failure.
    const text = body();
    expect(text).toContain('2> $cloneLogPath');
    expect(text).toContain('$cloneCode = $LASTEXITCODE');
    expect(text).toContain('if ($cloneCode -ne 0)');
    expect(text).not.toMatch(/git clone[^\n]*2>&1/);
  });

  it('uses Codex MCP commands when the CLI exists and names the config fallback', () => {
    const text = body();
    expect(text).toContain('& codex mcp list --json');
    expect(text).toContain('& codex mcp add commitlore -- $dest mcp');
    expect(text).toContain('config-file fallback; codex CLI is unavailable');
  });
});
