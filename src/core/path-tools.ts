/**
 * The tools that take a path, and therefore the tools worth injecting for.
 *
 * One list, three readers: the payload filter in `commands/inject.ts`, the
 * matcher the CLI installer writes into settings.json, and the matcher the
 * plugin ships in `hooks/hooks.json`. They disagreed until #775 -- a CLI
 * install delivered nothing when the agent edited with `MultiEdit`, a plugin
 * install delivered nothing when it read a file before deciding -- because
 * each site named the set for itself. A name repeated in three places is
 * three chances to be wrong; this is the one place.
 *
 * `hooks.json` is JSON and cannot import. `test/hook-matcher-parity.test.ts`
 * is its enforcement site.
 *
 * Every name must be spelled out. A matcher of only letters, digits, and
 * `|` is read as a list of *exact* strings, not as a regular expression, so
 * `Edit` does not cover `MultiEdit` and `Write` does not cover any longer
 * name that contains it. The listing is the mechanism, not verbosity.
 *
 * `Read` is in the set because that is where the record arrives *before* the
 * agent has committed to an approach. Measured (#775): the one observed case
 * of an agent changing course on a record took delivery on a `Read`. It is
 * also the cheapest place to be wrong about: a path with no active records
 * renders no text at all (`core/inject.ts`), so the payload cost of a read is
 * paid only where there is something to say.
 */

export const PATH_TOOLS = ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const;

/** The same set in the alternation form a Claude Code hook matcher takes. */
export const PATH_TOOL_MATCHER = PATH_TOOLS.join('|');
