/**
 * #660: an installed plugin is the upgrade case, not a reason to stop.
 *
 * `wire_claude_code` returned as soon as `claude plugin list` mentioned
 * commitlore, so a release reached the CLI wrapper and never the plugin cache.
 * Four generations accumulated that way and v1.0.0 joined them without
 * displacing one — the wrapper reported `1.0.0` while the tools an agent calls
 * stayed at `0.8.0`.
 *
 * Every existing installer test reads `install.sh` as text. That is why this
 * survived: the file contained everything it needed to contain, and the control
 * flow never ran. This one executes the function against a fake `claude` and
 * asserts on what it did.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * A `claude` that records every invocation and reports commitlore as installed.
 * Recording is the assertion surface: what matters is which subcommands ran.
 */
const fakeClaude = (listOutput: string): { bin: string; log: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-fake-claude-'));
  scratch.push(dir);
  const log = join(dir, 'calls.log');
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const script = join(bin, 'claude');
  writeFileSync(
    script,
    ['#!/bin/sh', `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`, `if [ "$1 $2" = "plugin list" ]; then printf '%s\\n' ${JSON.stringify(listOutput)}; fi`, 'exit 0', ''].join('\n'),
    'utf8',
  );
  chmodSync(script, 0o755);
  return { bin, log };
};

/** Source `install.sh` far enough to call one wiring function, nothing else. */
const runWireClaudeCode = (binDir: string): void => {
  const work = mkdtempSync(join(tmpdir(), 'cl-wire-'));
  scratch.push(work);
  const shim = join(work, 'run.sh');
  writeFileSync(
    shim,
    [
      '#!/bin/sh',
      'set -e',
      `work=${JSON.stringify(work)}`,
      'REPO=MongLong0214/commitlore',
      `: >"$work/wired.log"; : >"$work/skipped.log"`,
      'wired_log="$work/wired.log"; skipped_log="$work/skipped.log"',
      'record_wired() { printf "%s\\n" "$1" >>"$wired_log"; }',
      'record_skipped() { printf "%s: %s\\n" "$1" "$2" >>"$skipped_log"; }',
      // Only the function under test, lifted out so sourcing the installer
      // cannot run anything that touches this machine.
      `eval "$(awk '/^wire_claude_code\\(\\) \\{/,/^\\}/' ${JSON.stringify(join(REPO_ROOT, 'install.sh'))})"`,
      'wire_claude_code',
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(shim, 0o755);
  execFileSync('/bin/sh', [shim], {
    env: { ...process.env, PATH: `${binDir}:${process.env['PATH'] ?? ''}` },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  scratch.push(work);
};

describe('#660 installing over an existing Claude plugin', () => {
  it('updates the marketplace and reinstalls instead of returning', () => {
    const { bin, log } = fakeClaude('commitlore@commitlore  v0.8.0');

    runWireClaudeCode(bin);
    const calls = readFileSync(log, 'utf8');

    expect(calls, 'the marketplace must be refreshed or the new version is invisible').toContain(
      'plugin marketplace update',
    );
    expect(calls, 'and the plugin reinstalled from it').toContain('plugin install commitlore@commitlore');
  });

  // The old path stopped at `plugin list`. Pinning the call count keeps a future
  // early return from passing because the strings are still in the file.
  it('does more than ask whether it is installed', () => {
    const { bin, log } = fakeClaude('commitlore@commitlore  v0.8.0');

    runWireClaudeCode(bin);
    const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);

    expect(calls.length, `only ran: ${calls.join(' | ')}`).toBeGreaterThan(1);
  });
});
