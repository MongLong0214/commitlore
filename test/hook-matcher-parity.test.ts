/**
 * The two installers must write the same matcher, and it must be the set the
 * injector actually honours (#775).
 *
 * Before this, three places named the set and all three disagreed: the CLI
 * wrote `Read|Edit|Write`, the plugin shipped `Edit|Write|MultiEdit|
 * NotebookEdit`, and `commands/inject.ts` accepted all five. Each install
 * therefore had a hole the other did not, and neither hole was visible from
 * the file that had it -- you had to read the other installer to see it.
 *
 * `core/path-tools.ts` is now the one name. TypeScript keeps the CLI honest
 * by construction; `hooks.json` is JSON and cannot import, so this file is
 * where the plugin is held to it. That asymmetry is the point: the site that
 * cannot derive is the site that needs the test.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATH_TOOLS, PATH_TOOL_MATCHER } from '../src/core/path-tools.js';
import { CLAUDE_HOOK_EVENT, CLAUDE_HOOK_MATCHER } from '../src/hooks/claude-settings.js';

const pluginHooks = (): {
  hooks: Record<string, Array<{ matcher?: string }>>;
} => JSON.parse(readFileSync(join(process.cwd(), 'hooks/hooks.json'), 'utf8'));

describe('hook matcher parity', () => {
  it('the plugin matches on exactly the tools the injector honours', () => {
    const entries = pluginHooks().hooks[CLAUDE_HOOK_EVENT] ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.matcher).toBe(PATH_TOOL_MATCHER);
  });

  it('the CLI installer writes the same matcher as the plugin', () => {
    const entries = pluginHooks().hooks[CLAUDE_HOOK_EVENT] ?? [];
    expect(CLAUDE_HOOK_MATCHER).toBe(entries[0]?.matcher);
  });

  it('covers reading, because delivery after the decision is not delivery', () => {
    expect(PATH_TOOLS).toContain('Read');
  });

  it('covers every editing tool, so no edit path is silently uninstrumented', () => {
    expect(PATH_TOOLS).toContain('Edit');
    expect(PATH_TOOLS).toContain('Write');
    expect(PATH_TOOLS).toContain('MultiEdit');
    expect(PATH_TOOLS).toContain('NotebookEdit');
  });
});
