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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf8');

/** Every `wire_<name>` the shell defines. */
const definedHosts = (shell: string): string[] =>
  [...shell.matchAll(/^wire_([a-z_]+)\(\) \{/gm)].map((match) => match[1] ?? '');

describe('#689 every host the installer knows about is reachable', () => {
  // The shell defines has_/wire_ pairs that the CLI is the one to act on. A pair
  // with no counterpart anywhere is a host nobody will ever wire.
  it('names every shell-defined host somewhere in the CLI enumeration', () => {
    const shell = read('install.sh');
    const enumeration = read('src/commands/installer-hosts.ts');

    // A host is a `has_`/`wire_` pair. `wire_mcp_servers_json` is a shared
    // helper and `wire_codex_mcp` an internal of `wire_codex`; neither has a
    // `has_`. Filtering on underscores instead would have dropped
    // `wire_claude_code` too, which is exactly the host this guard exists for.
    const hosts = definedHosts(shell).filter((name) => shell.includes(`has_${name}(`));
    expect(hosts.length, 'no wire_ definitions found — the pattern went stale').toBeGreaterThan(3);

    // Mentioning the name is not dispatching it: the first attempt at this
    // guard passed while `claude-code` appeared only inside a helper nothing
    // called — the defect itself. `notDetected.push('<host>')` is written once,
    // in the enumeration, and only for a host the enumeration handles.
    // The two layers do not always agree on a name: the shell pair is
    // `has_gemini`/`wire_gemini` and the enumeration row is `gemini-cli`. That
    // is a real alias rather than a gap, so it is written down here — a guard
    // that cannot express a legitimate difference becomes noise and then gets
    // deleted.
    const ALIASES: Readonly<Record<string, string>> = { gemini: 'gemini-cli' };

    const dispatched = (name: string): boolean => {
      const spelled = ALIASES[name] ?? name.replace(/_/g, '-');
      // Either its own branch, or a row in the candidate table the loop walks —
      // that loop pushes `notDetected.push(host)` for every row it skips.
      return [spelled, name].some(
        (form) =>
          enumeration.includes(`notDetected.push('${form}')`) || enumeration.includes(`['${form}',`),
      );
    };
    const missing = hosts.filter((name) => !dispatched(name));

    expect(
      missing,
      `defined in install.sh and unknown to the enumeration: ${missing.join(', ')}`,
    ).toEqual([]);
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
