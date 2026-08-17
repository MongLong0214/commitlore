import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inspectAndApplyHosts } from '../src/commands/installer-hosts.js';

const scratch: string[] = [];

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

const inspectWithIsolatedPath = async (options: Parameters<typeof inspectAndApplyHosts>[0]) => {
  const previousPath = process.env['PATH'];
  const previousPathExt = process.env['PATHEXT'];
  process.env['PATH'] = '';
  process.env['PATHEXT'] = '.CMD';
  try {
    return await inspectAndApplyHosts(options);
  } finally {
    if (previousPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = previousPath;
    if (previousPathExt === undefined) delete process.env['PATHEXT'];
    else process.env['PATHEXT'] = previousPathExt;
  }
};

describe('#716 Windows Hermes wrapper execution', () => {
  it.runIf(process.platform === 'win32')('runs the Hermes installer through the resolved batch wrapper', async () => {
    // Given
    const root = mkdtempSync(join(tmpdir(), 'commitlore-windows-hermes-'));
    scratch.push(root);
    const home = join(root, 'home');
    const dataRoot = `${join(root, 'data 100% Ready')}\\`;
    const bin = join(root, 'bin & with spaces');
    const shim = join(bin, 'commitlore.cmd');
    const capture = join(root, 'capture.cjs');
    const output = join(root, 'hermes-args.json');
    mkdirSync(join(home, '.hermes'), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(home, '.hermes', 'config.yaml'), '');
    writeFileSync(capture, `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(2)))`);
    writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${capture}" %*\r\n`);

    // When
    const summary = await inspectWithIsolatedPath({ wrapper: shim, dataRoot, home });

    // Then
    expect(summary.hosts).toContainEqual({
      host: 'hermes',
      requested: true,
      outcome: 'installed',
      healthy: true,
      detail: 'Hermes setup verified',
    });
    expect(existsSync(output)).toBe(true);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual([
      'hermes',
      'install',
      '--config',
      join(home, '.hermes', 'config.yaml'),
      '--command',
      shim,
      '--data-root',
      dataRoot,
      '--verify',
    ]);
  });

  it.runIf(process.platform === 'win32')('reports the batch wrapper stderr when Hermes setup fails', async () => {
    // Given
    const root = mkdtempSync(join(tmpdir(), 'commitlore-windows-hermes-failure-'));
    scratch.push(root);
    const home = join(root, 'home');
    const shim = join(root, 'commitlore.cmd');
    mkdirSync(join(home, '.hermes'), { recursive: true });
    writeFileSync(join(home, '.hermes', 'config.yaml'), '');
    writeFileSync(shim, '@echo off\r\n>&2 echo missing Hermes skills sentinel\r\nexit /b 23\r\n');

    // When
    const summary = await inspectWithIsolatedPath({ wrapper: shim, dataRoot: join(root, 'data'), home });

    // Then
    expect(summary.hosts).toContainEqual({
      host: 'hermes',
      requested: true,
      outcome: 'failed',
      healthy: false,
      detail: 'Hermes setup failed: missing Hermes skills sentinel',
    });
  });
});
