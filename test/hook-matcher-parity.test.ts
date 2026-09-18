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
  hooks: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>;
} => JSON.parse(readFileSync(join(process.cwd(), 'hooks/hooks.json'), 'utf8'));

/**
 * The entry that runs the injector, chosen by what it runs.
 *
 * The manifest carries a second `PreToolUse` entry now -- the commit gate, on
 * `Bash` -- and selecting by position would silently start grading whichever
 * one happened to be first. What this file is about is the injector's matcher,
 * so the injector is what it looks for.
 */
const injectorEntry = (): { matcher?: string } | undefined =>
  (pluginHooks().hooks[CLAUDE_HOOK_EVENT] ?? []).find((entry) =>
    (entry.hooks ?? []).some((hook) => String(hook.command).includes('inject')),
  );

describe('hook matcher parity', () => {
  it('the plugin matches on exactly the tools the injector honours', () => {
    expect(injectorEntry()?.matcher).toBe(PATH_TOOL_MATCHER);
  });

  it('exactly one entry claims the path tools, so no second hook fires on an edit', () => {
    // What `toHaveLength(1)` used to say before a second entry existed. The
    // property was never "one hook" -- it was "one hook on these tools", and
    // r-hookmatcherunify records what a double fire on an edit costs.
    const claiming = (pluginHooks().hooks[CLAUDE_HOOK_EVENT] ?? []).filter((entry) =>
      PATH_TOOLS.some((tool) => String(entry.matcher ?? '').includes(tool)),
    );
    expect(claiming).toHaveLength(1);
  });

  it('the CLI installer writes the same matcher as the plugin', () => {
    expect(CLAUDE_HOOK_MATCHER).toBe(injectorEntry()?.matcher);
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

  // `F14-distribution.md` says of its capability table: "The assertion checks
  // this table, not prose." Nothing did. The row named the matcher and drifted
  // a full tool behind the file it claims to describe, which is the failure
  // this whole change is about wearing a documentation costume.
  //
  // `ADR-0026` carries the same row and is deliberately excluded: it records
  // what was verified present at a named commit, and a decision record that
  // silently tracks the present is no longer a record of a decision.
  it.each(['docs/COMPATIBILITY.md', 'docs/tickets/F14-distribution.md'])(
    'the matcher named in %s is the one that ships',
    (doc) => {
      const escaped = PATH_TOOL_MATCHER.split('|').join(String.raw`\|`);
      const text = readFileSync(join(process.cwd(), doc), 'utf8');
      /*
       * Rows about the *path-tool* hook, not every row that says PreToolUse:
       * the commit gate is a second `PreToolUse` row and matches on `Bash`,
       * which names no path tool. The teeth are unchanged -- a row that drifted
       * to `Edit\|Write` still mentions a path tool, is still selected, and
       * still fails for missing the rest of the set.
       */
      const rows = text
        .split('\n')
        .filter((line) => line.includes('PreToolUse') && PATH_TOOLS.some((tool) => line.includes(tool)));

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row).toContain(escaped);
    },
  );
});
