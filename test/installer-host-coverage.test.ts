/**
 * #689: a host that is defined and never dispatched must not be possible.
 *
 * `install.sh` defines `has_claude_code` and `wire_claude_code` and calls
 * neither, and the CLI's enumeration had no branch for it. So Claude Code
 * appeared in neither `hosts` nor `notDetected`, the plugin cache went untouched
 * by every release, and `notDetected: []` read as *every host was detected*.
 *
 * The defect was not the missing branch. It was that nothing could notice the
 * branch was missing — which is what this file is for.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { inspectAndApplyHosts, type HostSummary } from '../src/commands/installer-hosts.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf8');

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * The hosts this installer claims to support. Written here rather than derived
 * from the module under test: a list read out of the same file it checks would
 * shrink with it and report nothing when a host silently disappeared.
 *
 * Until #691 this list lived in `install.sh` as `has_`/`wire_` pairs and the
 * guard compared the two files. Those pairs were dead code that nothing called
 * — deleted now — so the comparison went with them.
 */
const KNOWN_HOSTS = [
  'claude-code',
  'codex',
  'gemini-cli',
  'cursor',
  'windsurf',
  'opencode',
  'hermes',
] as const;

/**
 * The enumeration, called as the installer calls it.
 *
 * Detection asks PATH as well as `--home`, so on a developer machine with
 * agents installed this would wire real hosts into a scratch directory and fail
 * for a reason unrelated to the invariant. Emptying PATH for the call makes
 * "nothing is installed" true of the run rather than of the runner.
 */
const enumerate = async (home: string): Promise<HostSummary> => {
  const previous = process.env['PATH'];
  process.env['PATH'] = '';
  try {
    return await inspectAndApplyHosts({
      wrapper: join(home, 'bin', 'commitlore'),
      dataRoot: home,
      home,
    });
  } finally {
    process.env['PATH'] = previous;
  }
};

describe('#689 every host the installer knows about is reachable', () => {
  // The invariant, recorded as r-689host: a host is wired or reported
  // undetected, never absent. #689 was a host that fell out of both lists, so
  // `notDetected: []` read as *everything was detected*.
  //
  // Asserted by running the enumeration rather than reading it. A branch that
  // returns early without pushing is invisible to any text search — it is
  // missing code, not wrong code — and that is the shape being guarded.
  it('accounts for every known host when none is installed', async () => {
    const home = mkdtempSync(join(tmpdir(), 'cl-hosts-'));
    scratch.push(home);

    const result = await enumerate(home);

    expect(result.hosts, 'an empty home has nothing to wire').toEqual([]);
    for (const host of KNOWN_HOSTS) {
      expect(
        result.notDetected,
        `${host} appears in neither hosts nor notDetected — it was dropped, not skipped`,
      ).toContain(host);
    }
  });

  it('reports claude-code as a host, since that is the one that was missing', () => {
    const enumeration = read('src/commands/installer-hosts.ts');

    expect(enumeration, 'the host itself').toContain("'claude-code'");
    // Adding a marketplace that is already present is a no-op, so without the
    // update a reinstall reinstates the same version — this is the whole of #660.
    expect(enumeration, 'the refresh that makes a new version visible').toContain('marketplace');
    expect(enumeration).toContain('update');
  });

  it('puts an undetected host in notDetected rather than nowhere', () => {
    const enumeration = read('src/commands/installer-hosts.ts');

    for (const host of ['codex', 'hermes', 'claude-code']) {
      expect(
        enumeration,
        `${host} has no notDetected branch, so its absence would be silent`,
      ).toContain(`notDetected.push('${host}')`);
    }
  });
});
