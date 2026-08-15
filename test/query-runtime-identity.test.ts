/**
 * #631: an answer says which build produced it.
 *
 * Four generations of this product were found installed at once, two of them
 * from a plugin cache `install.sh` never touches (#660), and a session that
 * reconnects through the plugin talks to a different binary than the terminal
 * does. When the CLI and MCP then disagree, a client has no way to tell whether
 * it asked one runtime twice or two runtimes once.
 *
 * The field is set in `toJson`, which both routes serialize through. That
 * placement is the test: adding it to either route alone would create exactly
 * the divergence it exists to expose, so what is pinned here is that one
 * function owns it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { toJson } from '../src/commands/query.js';
import { runQuery } from '../src/core/query.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const declaredVersion = (): string => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    version?: string;
  };
  return manifest.version ?? '';
};

describe('#631 an answer names the runtime that produced it', () => {
  it('carries the version and the bundle it ran from', () => {
    const answer = toJson('limits', runQuery({ cwd: PACKAGE_ROOT, kind: 'limits', scanBudgetMs: 0 }));

    expect(answer.runtime.version, 'the version a client compares against').toBe(declaredVersion());
    expect(answer.runtime.entrypoint, 'and which file answered, since versions repeat').not.toBe('');
  });

  // The guarantee is that one function owns the field. Two calls through it must
  // agree, or a client comparing routes is comparing noise.
  it('answers with the same identity for two questions in one process', () => {
    const first = toJson('limits', runQuery({ cwd: PACKAGE_ROOT, kind: 'limits', scanBudgetMs: 0 }));
    const second = toJson('warnings', runQuery({ cwd: PACKAGE_ROOT, kind: 'warnings', scanBudgetMs: 0 }));

    expect(second.runtime).toEqual(first.runtime);
  });

  // A version alone cannot distinguish the four installed generations #660
  // found: three of them reported 0.8.0.
  it('does not rely on the version alone to identify a build', () => {
    const answer = toJson('limits', runQuery({ cwd: PACKAGE_ROOT, kind: 'limits', scanBudgetMs: 0 }));

    expect(answer.runtime.entrypoint, 'two installations can share a version').toMatch(/commitlore\.mjs$|src|dist/);
  });
});
