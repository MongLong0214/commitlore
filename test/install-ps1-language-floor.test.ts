/**
 * #703: `install.ps1` runs on PowerShell 5.1 by accident, not by assertion.
 *
 * It works there today — no PS7-only syntax appears in it, and CI runs it under
 * both `powershell.exe` (5.1) and `pwsh` (7). But nothing states the floor, so
 * nothing stops it moving.
 *
 * The failure that would follow is worse than a normal one. A parse error
 * happens before any statement executes, so the installer's own diagnostics —
 * "Node.js 22.23.2 or newer is required", "Nothing was installed" — never get a
 * chance to run. A 5.1 user would see a syntax error from a file they did not
 * write, about a version they were never told they needed.
 *
 * Running under 5.1 in CI proves it works on the day someone maintains that
 * job. This proves it on the day someone writes `??`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = (): string => readFileSync(join(REPO_ROOT, 'install.ps1'), 'utf8');

/** Code only, so a comment or a message may name any of these freely. */
const statements = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

/**
 * Constructs Windows PowerShell 5.1 cannot parse. Each is a parse-time failure,
 * not a runtime one — which is what makes the floor worth asserting rather than
 * discovering.
 */
const PS7_ONLY: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'null-coalescing (??)', pattern: /\?\?/ },
  { name: 'null-conditional (?.)', pattern: /\$\w+\?\./ },
  { name: 'pipeline chain (&& or ||)', pattern: /(^|\s)(&&|\|\|)(\s|$)/m },
  { name: 'ternary (? :)', pattern: /\)\s*\?\s*[^:\n]+\s*:\s*/ },
  { name: 'ForEach-Object -Parallel', pattern: /-Parallel\b/ },
  { name: 'Test-Json / ConvertFrom-Json -AsHashtable', pattern: /\bTest-Json\b|-AsHashtable\b/ },
];

describe('#703 install.ps1 states the PowerShell floor it depends on', () => {
  it.each(PS7_ONLY)('uses no $name', ({ pattern }) => {
    expect(pattern.test(statements(script()))).toBe(false);
  });

  // The floor has to be readable by someone editing the file, not only by this
  // test. A contributor who does not know 5.1 is supported cannot keep it.
  it('says the floor in the file itself', () => {
    const text = script();

    expect(text, 'the supported version is named').toMatch(/PowerShell\s+5\.1/i);
    expect(
      text,
      'and why it is a floor rather than a preference',
    ).toMatch(/parse|syntax|before|diagnos/i);
  });
});
