/**
 * The Claude Code side of the injection hook (T-402, ADR-0006 decision 1):
 * writing a `PreToolUse` entry into a `settings.json` so that opening or
 * editing a file delivers that path's active records first.
 *
 * This module edits a file somebody else owns, and that governs every rule in
 * it:
 *
 * - **It never overwrites what it cannot read.** A `settings.json` that does
 *   not parse is a file with something valuable in it that this build does not
 *   understand. Installing over it would destroy a configuration to add a
 *   convenience, so a parse failure stops the install and says so.
 * - **It merges, it does not replace.** Every other key, every other hook, and
 *   every unknown field inside the entries it does touch survive untouched.
 * - **It is idempotent.** Our entry is identified by a fixed marker inside the
 *   command string, so installing twice leaves exactly one — "ours" is a fact
 *   about the file, not a guess about how many times somebody ran the command.
 *
 * The marker lives in the command rather than in a field of its own because
 * `settings.json` is validated against a schema this project does not control:
 * a trailing `# commitlore-inject-hook` is a shell comment to the runner, an
 * unambiguous identity to us, and a field nobody's validator has to know about.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PATH_TOOL_MATCHER } from '../core/path-tools.js';
/** The hook event that fires before a tool runs (PRD-F4 requirement 2). */
export const CLAUDE_HOOK_EVENT = 'PreToolUse';
/**
 * The tools that touch a path, and therefore the tools worth injecting for.
 * Derived, not restated: `core/path-tools.ts` owns the set (#775).
 */
export const CLAUDE_HOOK_MATCHER = PATH_TOOL_MATCHER;
/** How our entry is recognised. A shell comment to the runner, identity to us. */
export const CLAUDE_HOOK_MARKER = '# commitlore-inject-hook';
/** The command the hook runs. `--hook-input` reads the event payload on stdin. */
export const CLAUDE_HOOK_COMMAND = `commitlore inject --hook-input ${CLAUDE_HOOK_MARKER}`;
/** Where the command writes when the caller names no file. */
export const claudeSettingsPath = (cwd) => join(cwd, '.claude', 'settings.json');
export const INJECT_HOOK = {
    event: CLAUDE_HOOK_EVENT,
    marker: CLAUDE_HOOK_MARKER,
    command: CLAUDE_HOOK_COMMAND,
    matcher: CLAUDE_HOOK_MATCHER,
    label: 'injection',
};
const messageOf = (error) => error instanceof Error ? error.message : String(error);
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const failure = (settingsPath, message) => ({
    code: 2,
    stdout: '',
    stderr: `commitlore: ${message}\n`,
    changed: false,
    status: { settingsPath, state: 'unreadable', entries: 0, commands: [], problem: message },
});
const success = (status, lines, changed) => ({
    code: 0,
    stdout: `${lines.join('\n')}\n`,
    stderr: '',
    status,
    changed,
});
/**
 * Reads and validates the settings file.
 *
 * Throws — with the reason — for anything this module refuses to edit: text
 * that is not JSON, a top-level value that is not an object, a `hooks` that is
 * not an object, a `PreToolUse` that is not an array. Every one of those is a
 * file whose shape contradicts what an install would write, and the only safe
 * response is to stop with the path in the message.
 */
const load = (settingsPath, kind = INJECT_HOOK) => {
    if (!existsSync(settingsPath))
        return { settings: {}, existed: false };
    let raw;
    try {
        raw = readFileSync(settingsPath, 'utf8');
    }
    catch (error) {
        throw new Error(`cannot read ${settingsPath}: ${messageOf(error)}`);
    }
    if (raw.trim() === '')
        return { settings: {}, existed: true };
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`${settingsPath} is not valid JSON (${messageOf(error)}) — refusing to overwrite it; ` +
            'fix the file, or move it aside, and run this again');
    }
    if (!isPlainObject(parsed)) {
        throw new Error(`${settingsPath} does not contain a JSON object — refusing to overwrite it`);
    }
    const hooks = parsed['hooks'];
    if (hooks !== undefined && !isPlainObject(hooks)) {
        throw new Error(`${settingsPath} has a "hooks" value that is not an object — refusing to edit it`);
    }
    if (isPlainObject(hooks)) {
        const event = hooks[kind.event];
        if (event !== undefined && !Array.isArray(event)) {
            throw new Error(`${settingsPath} has a "hooks.${kind.event}" value that is not an array — refusing to edit it`);
        }
    }
    return { settings: parsed, existed: true };
};
const eventGroups = (settings, kind) => {
    const hooks = settings['hooks'];
    if (!isPlainObject(hooks))
        return [];
    const event = hooks[kind.event];
    return Array.isArray(event) ? event.filter(isPlainObject) : [];
};
const isOurs = (entry, kind) => isPlainObject(entry) &&
    typeof entry['command'] === 'string' &&
    entry['command'].includes(kind.marker);
const ourCommands = (settings, kind) => eventGroups(settings, kind).flatMap((group) => (Array.isArray(group.hooks) ? group.hooks : [])
    .filter((entry) => isOurs(entry, kind))
    .map((entry) => String(entry['command'])));
const stateOf = (commands, expected) => {
    if (commands.length === 0)
        return 'absent';
    if (commands.length > 1)
        return 'conflicting';
    return commands[0] === expected ? 'installed' : 'outdated';
};
export const readClaudeHookStatus = (settingsPath, command, kind = INJECT_HOOK) => {
    const expected = command ?? kind.command;
    let loaded;
    try {
        loaded = load(settingsPath, kind);
    }
    catch (error) {
        return {
            settingsPath,
            state: 'unreadable',
            entries: 0,
            commands: [],
            problem: messageOf(error),
        };
    }
    const commands = ourCommands(loaded.settings, kind);
    return {
        settingsPath,
        state: stateOf(commands, expected),
        entries: commands.length,
        commands,
    };
};
// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
/**
 * Removes every entry of ours, and reports whether anything went.
 *
 * A group emptied by the removal is dropped, because an entry with no hooks in
 * it is noise the install added. A group that was already empty is left alone:
 * this module removes what it wrote, never what it found.
 */
const withoutOurs = (groups, kind) => {
    let removed = 0;
    const kept = [];
    for (const group of groups) {
        if (!Array.isArray(group.hooks)) {
            kept.push(group);
            continue;
        }
        const entries = group.hooks.filter((entry) => !isOurs(entry, kind));
        const dropped = group.hooks.length - entries.length;
        removed += dropped;
        if (dropped > 0 && entries.length === 0)
            continue;
        kept.push(dropped === 0 ? group : { ...group, hooks: entries });
    }
    return { groups: kept, removed };
};
/** Rebuilds one `hooks.<event>` while leaving every other key exactly as found. */
const withGroups = (settings, groups, kind) => {
    const hooks = isPlainObject(settings['hooks']) ? { ...settings['hooks'] } : {};
    if (groups.length === 0)
        delete hooks[kind.event];
    else
        hooks[kind.event] = groups;
    const next = { ...settings };
    if (Object.keys(hooks).length === 0)
        delete next['hooks'];
    else
        next['hooks'] = hooks;
    return next;
};
/**
 * Written through a temporary file in the same directory: a settings file that
 * an editor or the agent reads while it is half written is a broken
 * configuration, and a crash mid-write must leave the original intact.
 */
const writeAtomic = (settingsPath, settings) => {
    mkdirSync(dirname(settingsPath), { recursive: true });
    let mode;
    try {
        mode = statSync(settingsPath).mode & 0o777;
    }
    catch {
        mode = undefined;
    }
    const temporary = `${settingsPath}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    const body = `${JSON.stringify(settings, null, 2)}\n`;
    try {
        writeFileSync(temporary, body, mode === undefined ? {} : { mode });
        renameSync(temporary, settingsPath);
    }
    catch (error) {
        try {
            unlinkSync(temporary);
        }
        catch {
            // The temporary file is already gone, or was never created.
        }
        throw new Error(`cannot write ${settingsPath}: ${messageOf(error)}`);
    }
};
const validateCommand = (command, kind) => {
    if (!command.includes(kind.marker)) {
        throw new Error(`the hook command must contain the marker ${JSON.stringify(kind.marker)}, ` +
            'or uninstall would not be able to find it again');
    }
};
export const installClaudeHook = (input) => {
    const { settingsPath } = input;
    const kind = input.kind ?? INJECT_HOOK;
    const command = input.command ?? kind.command;
    const matcher = input.matcher ?? kind.matcher;
    let loaded;
    try {
        validateCommand(command, kind);
        loaded = load(settingsPath, kind);
    }
    catch (error) {
        return failure(settingsPath, messageOf(error));
    }
    const before = ourCommands(loaded.settings, kind);
    const { groups } = withoutOurs(eventGroups(loaded.settings, kind), kind);
    const next = withGroups(loaded.settings, [...groups, { matcher, hooks: [{ type: 'command', command }] }], kind);
    const state = stateOf(before, command);
    const unchanged = state === 'installed' && JSON.stringify(next) === JSON.stringify(loaded.settings);
    if (!unchanged) {
        try {
            writeAtomic(settingsPath, next);
        }
        catch (error) {
            return failure(settingsPath, messageOf(error));
        }
    }
    const headline = {
        absent: `installed the ${kind.event} ${kind.label} hook: ${settingsPath}`,
        installed: `${kind.event} ${kind.label} hook already installed: ${settingsPath} (unchanged)`,
        outdated: `updated the ${kind.event} ${kind.label} hook: ${settingsPath}`,
        conflicting: `collapsed ${before.length} duplicate ${kind.label} hooks into one: ${settingsPath}`,
        unreadable: `installed the ${kind.event} ${kind.label} hook: ${settingsPath}`,
    }[state];
    return success(readClaudeHookStatus(settingsPath, command, kind), [
        headline,
        `  matcher: ${matcher}`,
        `  command: ${command}`,
    ], !unchanged);
};
export const uninstallClaudeHook = (input) => {
    const { settingsPath } = input;
    const kind = input.kind ?? INJECT_HOOK;
    const command = input.command ?? kind.command;
    let loaded;
    try {
        loaded = load(settingsPath, kind);
    }
    catch (error) {
        return failure(settingsPath, messageOf(error));
    }
    if (!loaded.existed) {
        return success(readClaudeHookStatus(settingsPath, command, kind), [
            `no settings file to clean: ${settingsPath}`,
        ], false);
    }
    // Only entries carrying *this* kind's marker. An uninstall of one must leave
    // the other in place, and must leave every foreign hook alone in both cases.
    const { groups, removed } = withoutOurs(eventGroups(loaded.settings, kind), kind);
    if (removed === 0) {
        return success(readClaudeHookStatus(settingsPath, command, kind), [
            `no commitlore ${kind.label} hook in ${settingsPath}`,
        ], false);
    }
    try {
        writeAtomic(settingsPath, withGroups(loaded.settings, groups, kind));
    }
    catch (error) {
        return failure(settingsPath, messageOf(error));
    }
    return success(readClaudeHookStatus(settingsPath, command, kind), [
        `removed ${removed} ${kind.label} hook entr${removed === 1 ? 'y' : 'ies'}: ${settingsPath}`,
    ], true);
};
export const claudeHookStatus = (input) => {
    const status = readClaudeHookStatus(input.settingsPath, input.command ?? CLAUDE_HOOK_COMMAND);
    if (status.state === 'unreadable') {
        return failure(input.settingsPath, status.problem ?? `cannot read ${input.settingsPath}`);
    }
    const described = {
        absent: 'not installed',
        installed: 'installed (commitlore)',
        outdated: 'installed (commitlore), command differs from this build',
        conflicting: `installed ${status.entries} times — run install to collapse them`,
        unreadable: 'unreadable',
    }[status.state];
    return success(status, [
        `settings: ${status.settingsPath}`,
        `${CLAUDE_HOOK_EVENT} injection hook: ${described}`,
        ...status.commands.map((command) => `  command: ${command}`),
    ], false);
};
//# sourceMappingURL=claude-settings.js.map