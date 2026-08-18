/**
 * Whether the Claude Code plugin will answer for this repository (#781).
 *
 * Two installers each register a `PreToolUse` hook and neither can see the
 * other: the plugin ships `hooks/hooks.json`, `init` writes `settings.json`,
 * and a user who follows the README to the plugin and then runs the
 * documented `init` carries both. Every matched tool call is then answered
 * twice, at about 330 ms and one payload each.
 *
 * Nothing supported reports the answer, so this reads Claude Code's own
 * state. Measured on a live session, that state is trustworthy in one half
 * and not the other:
 *
 * - `installed_plugins.json` lists `commitlore@commitlore`. Existence is a
 *   fact it states reliably.
 * - The `version` it records is not what fires. One machine read `0.8.0`
 *   while its cache held `0.8.0` through `1.1.4`, the newest written that
 *   day. So this never asks which version; only whether one is there.
 * - `enabledPlugins` in settings carries the on/off switch, and a project
 *   file overrides the user file.
 *
 * **The failure direction is the whole design.** Guessing "the plugin will
 * fire" when it will not leaves the agent with no records and no sign that
 * anything is missing -- the exact silence this product exists to remove.
 * Guessing the other way costs a duplicate payload, which is visible and
 * measurable and which somebody will report. So `willFire` is true only when
 * both halves say so out loud; unreadable files, absent keys, and unexpected
 * shapes all answer `false`, and `init` writes its hook.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
/** How the plugin registry and the settings files name this plugin. */
export const CLAUDE_PLUGIN_KEY = 'commitlore@commitlore';
const readJson = (path) => {
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
};
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInstalled = (home) => {
    const registry = readJson(join(home, '.claude', 'plugins', 'installed_plugins.json'));
    if (!isRecord(registry))
        return false;
    const plugins = registry['plugins'];
    return isRecord(plugins) && Object.hasOwn(plugins, CLAUDE_PLUGIN_KEY);
};
/**
 * The nearest explicit on/off, project before user. `undefined` means no file
 * said anything, which is not the same as `false` and is reported as such.
 */
const enablement = (home, cwd) => {
    for (const path of [
        join(cwd, '.claude', 'settings.local.json'),
        join(cwd, '.claude', 'settings.json'),
        join(home, '.claude', 'settings.json'),
    ]) {
        const settings = readJson(path);
        if (!isRecord(settings))
            continue;
        const enabled = settings['enabledPlugins'];
        if (!isRecord(enabled))
            continue;
        const value = enabled[CLAUDE_PLUGIN_KEY];
        if (typeof value === 'boolean')
            return value;
    }
    return undefined;
};
export const pluginDeliveryProof = (cwd, home = homedir()) => {
    if (!isInstalled(home)) {
        return { willFire: false, reason: 'the Claude Code plugin is not installed for this user' };
    }
    const enabled = enablement(home, cwd);
    if (enabled === undefined) {
        return { willFire: false, reason: 'the Claude Code plugin is installed but nothing says it is enabled' };
    }
    if (!enabled) {
        return { willFire: false, reason: 'the Claude Code plugin is installed and switched off' };
    }
    return { willFire: true, reason: 'the Claude Code plugin is installed and enabled, and registers this hook itself' };
};
//# sourceMappingURL=claude-plugin.js.map