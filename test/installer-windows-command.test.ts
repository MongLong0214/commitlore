import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { commandInterpreterInvocation, resolveCommand } from '../src/commands/installer-hosts.js';

const scratch: string[] = [];

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

const temporary = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'commitlore-windows-command-'));
  scratch.push(path);
  return path;
};

const restoreEnvironment = (key: 'PATH' | 'PATHEXT', value: string | undefined): void => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

const withWindowsPath = <T>(path: string, pathExt: string, action: () => T): T => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  if (platform === undefined) throw new Error('process.platform is not configurable for this test');
  const previousPath = process.env['PATH'];
  const previousPathExt = process.env['PATHEXT'];
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  process.env['PATH'] = path;
  process.env['PATHEXT'] = pathExt;
  try {
    return action();
  } finally {
    Object.defineProperty(process, 'platform', platform);
    restoreEnvironment('PATH', previousPath);
    restoreEnvironment('PATHEXT', previousPathExt);
  }
};

describe('#716 Windows command resolution', () => {
  it('finds a command that exists only as a PATHEXT batch shim', () => {
    // Given
    const root = temporary();
    const bin = join(root, 'bin');
    const shim = join(bin, 'codex.CMD');
    mkdirSync(bin);
    writeFileSync(shim, '@echo off\r\n');
    if (process.platform !== 'win32') chmodSync(shim, 0o755);

    // When
    const resolved = withWindowsPath(bin, '.COM;.EXE;.BAT;.CMD', () => resolveCommand('codex'));

    // Then
    expect(resolved).toEqual({ path: shim, usesCommandInterpreter: true });
  });

  it('uses the same resolver for a concrete batch wrapper path', () => {
    // Given
    const root = temporary();
    const shim = join(root, 'commitlore.cmd');
    writeFileSync(shim, '@echo off\r\n');
    if (process.platform !== 'win32') chmodSync(shim, 0o755);

    // When
    const resolved = withWindowsPath('', '.CMD', () => resolveCommand(shim));

    // Then
    expect(resolved).toEqual({ path: shim, usesCommandInterpreter: true });
  });

  it('does not treat a genuinely absent host as detected', () => {
    // Given / When
    const resolved = withWindowsPath('', '.CMD', () => resolveCommand('claude'));

    // Then
    expect(resolved).toBeNull();
  });

  it.runIf(process.platform === 'win32')('starts a batch shim in a path with spaces without reparsing its arguments', () => {
    const root = temporary();
    const bin = join(root, 'bin & with spaces');
    const shim = join(bin, 'codex.cmd');
    const capture = join(root, 'capture.cjs');
    const output = join(root, 'output.json');
    mkdirSync(bin);
    writeFileSync(capture, `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(2)))`);
    writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${capture}" %*\r\n`);

    const expected = [
      'A&B',
      'A|B',
      'A^B',
      '!PATH!',
      'with spaces',
      `${join(root, 'data root')}\\`,
      '100% Ready',
      '%PATH%',
    ];
    const invocation = commandInterpreterInvocation(shim, expected);
    expect(invocation).not.toBeNull();
    const result = spawnSync(process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', invocation?.args ?? [], {
      encoding: 'utf8',
      env: invocation?.env,
      shell: false,
      windowsVerbatimArguments: true,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(output)).toBe(true);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(expected);
  });

  it('rejects values that can terminate or split the cmd.exe command line', () => {
    expect(commandInterpreterInvocation('C:\\safe\\wrapper.cmd', ['bad"quote'])).toBeNull();
    expect(commandInterpreterInvocation('C:\\safe\\wrapper.cmd', ['line\rbreak'])).toBeNull();
    expect(commandInterpreterInvocation('C:\\safe\\wrapper.cmd', ['line\nbreak'])).toBeNull();
    expect(commandInterpreterInvocation('C:\\safe\\wrapper.cmd', ['nul\0byte'])).toBeNull();
  });
});
