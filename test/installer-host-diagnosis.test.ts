/**
 * #716: a host failure has to name the file it was about.
 *
 * The Windows run recorded in #714 reported `cursor` as
 * `config is not parseable JSON: Unexpected end of JSON input`. That message
 * says a parse of an empty string happened; it does not say which file was
 * parsed. The installer reads `%USERPROFILE%\.cursor\mcp.json` and only that,
 * while Cursor keeps configuration in more than one place — so a counter-check
 * that found valid JSON and the installer that found none could both be right
 * about different files, and nothing in the output can settle it.
 *
 * That is not a gap in the transcript. The installer never recorded which path
 * it read, so no transcript could contain it. A receipt that names the failure
 * but not its subject sends the next reader to the wrong file.
 *
 * Every assertion here therefore checks for the path, not the wording.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { inspectAndApplyHosts, type HostResult } from '../src/commands/installer-hosts.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * Runs the enumeration against a scratch home with PATH emptied, so detection
 * turns on the config directory this test created rather than on whatever the
 * developer happens to have installed.
 */
const enumerateWith = async (write: (home: string) => void): Promise<HostResult[]> => {
  const home = mkdtempSync(join(tmpdir(), 'cl-diag-'));
  scratch.push(home);
  write(home);
  const previous = process.env['PATH'];
  process.env['PATH'] = '';
  try {
    const summary = await inspectAndApplyHosts({
      wrapper: join(home, 'bin', 'commitlore'),
      dataRoot: home,
      home,
    });
    return summary.hosts;
  } finally {
    process.env['PATH'] = previous;
  }
};

const resultFor = (hosts: HostResult[], host: string): HostResult => {
  const found = hosts.find((entry) => entry.host === host);
  if (found === undefined) throw new Error(`${host} was not in hosts: ${JSON.stringify(hosts)}`);
  return found;
};

describe('#716 a failed host names the file it read', () => {
  it('names the config it could not parse, not just that a parse failed', async () => {
    const hosts = await enumerateWith((home) => {
      mkdirSync(join(home, '.cursor'), { recursive: true });
      // Empty, which is what produces "Unexpected end of JSON input" — the
      // exact message the Windows run could not attribute to a file.
      writeFileSync(join(home, '.cursor', 'mcp.json'), '');
    });

    const cursor = resultFor(hosts, 'cursor');
    expect(cursor.outcome).toBe('failed');
    expect(
      cursor.detail,
      'the reader has to know which of Cursor\'s config locations this was',
    ).toContain(join('.cursor', 'mcp.json'));
  });

  it('names the config whose registration group is the wrong shape', async () => {
    const hosts = await enumerateWith((home) => {
      mkdirSync(join(home, '.gemini'), { recursive: true });
      writeFileSync(join(home, '.gemini', 'settings.json'), '{"mcpServers": []}\n');
    });

    const gemini = resultFor(hosts, 'gemini-cli');
    expect(gemini.outcome).toBe('failed');
    expect(gemini.detail).toContain(join('.gemini', 'settings.json'));
  });

  it('names the Codex config it could not parse', async () => {
    const hosts = await enumerateWith((home) => {
      mkdirSync(join(home, '.codex'), { recursive: true });
      writeFileSync(
        join(home, '.codex', 'config.toml'),
        '[mcp_servers.commitlore]\ncommand = "not closed\n',
      );
    });

    const codex = resultFor(hosts, 'codex');
    expect(codex.outcome).toBe('failed');
    expect(codex.detail).toContain(join('.codex', 'config.toml'));
  });
});
