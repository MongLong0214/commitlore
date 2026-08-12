/**
 * #483: the release gate asked whether the plugin entry point resolved, not
 * whether it resolved to the plugin.
 *
 * The old runner tried `commitlore` on `PATH` before `CLAUDE_PLUGIN_ROOT`.
 * That made a plugin hook silently run a different installed CLI. Found running
 * the gate against a fresh v0.7.0 clone on a machine with 0.6.0 installed: the
 * clone answered 0.7.0 and the entry point answered 0.6.0, and the gate passed
 * because it only checked the exit code.
 *
 * The expected shadowing behavior deliberately flips here: a plugin is a
 * versioned release artifact, so its hook must run its own bundle. Failing open
 * when that bundle cannot run is safer than accepting context from an unrelated
 * PATH install and presenting it as the plugin's output.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'commitlore-run.sh');
const OWN_VERSION = JSON.parse(
  execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }),
).version as string;

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `cl-plug-${label}-`));
  scratch.push(dir);
  return dir;
};

/** The interpreter's directory, so a narrowed PATH can still find node. */
const nodeDir = dirname(process.execPath);

const run = (path: string): string =>
  execFileSync('sh', [SCRIPT, '--version'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { PATH: path, CLAUDE_PLUGIN_ROOT: REPO_ROOT, HOME: process.env['HOME'] ?? '' },
  }).trim();

describe('#483 the plugin entry point', () => {
  it('answers with the plugin\'s own version when nothing shadows it', () => {
    // What the release gate meant to check all along.
    expect(run(`/usr/bin:/bin:${nodeDir}`)).toBe(OWN_VERSION);
  });

  it('runs the plugin bundle instead of a shadowing commitlore on PATH', () => {
    // This expectation intentionally changed: allowing PATH to win meant a
    // newly installed plugin could silently serve every edit with an older CLI.
    // The plugin root is the release artifact the host selected, so it wins.
    const shadow = temp('shadow');
    const fake = join(shadow, 'commitlore');
    writeFileSync(fake, '#!/bin/sh\necho 0.0.0-shadow\n');
    chmodSync(fake, 0o755);

    expect(run(`${shadow}:/usr/bin:/bin:${nodeDir}`)).toBe(OWN_VERSION);
  });
});
