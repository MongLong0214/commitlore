/**
 * `commitlore uninstall` — removes what `install.sh` wrote to the machine:
 * the installed binary and the agent MCP configuration entries.
 *
 * It never removes per-repository state (hooks, index, notes) — that is the
 * job of `commitlore hooks uninstall` and `commitlore inject uninstall-claude-hook`.
 *
 * Privacy: agent config files may contain API tokens for other MCP servers.
 * This command reads them only to remove the `commitlore` entry, and NEVER
 * echoes any other entry's contents into its report or JSON output.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AGENT_CONFIGS, resolveConfigPath, } from '../core/agent-configs.js';
// ─── Binary identification ───────────────────────────────────────────────────
/**
 * The same check `install.sh` uses: run `<binary> --version` and require
 * a bare semver response (`N.N.N`). Anything else means it's not commitlore.
 */
const isSelfIdentifyingCommitlore = (binPath) => {
    try {
        const result = spawnSync(binPath, ['--version'], {
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const version = (result.stdout ?? '').trim();
        return /^[0-9]+\.[0-9]+\.[0-9]+/.test(version);
    }
    catch {
        return false;
    }
};
// ─── Config entry removal ────────────────────────────────────────────────────
/**
 * Remove the `commitlore` key from a JSON config that uses `mcpServers`.
 * Returns the new file content, or null if no change was needed / parse failed.
 */
const removeJsonMcpServersEntry = (content, key) => {
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch {
        return null; // unparseable — leave untouched
    }
    const servers = parsed['mcpServers'];
    if (!servers || !(key in servers))
        return null; // nothing to remove
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete servers[key];
    return JSON.stringify(parsed, null, 2);
};
/**
 * Remove the `commitlore` key from a JSON config that uses `mcp` (opencode format).
 * Returns the new file content, or null if no change was needed / parse failed.
 */
const removeJsonMcpEntry = (content, key) => {
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch {
        return null; // unparseable — leave untouched
    }
    const mcp = parsed['mcp'];
    if (!mcp || !(key in mcp))
        return null; // nothing to remove
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete mcp[key];
    return JSON.stringify(parsed, null, 2);
};
/**
 * Remove the `[mcp_servers.commitlore]` block from a TOML config (codex).
 * Uses line-based removal to avoid needing a full TOML parser, which would
 * reformat the file.
 *
 * Returns the new file content, or null if no change was needed.
 */
const removeTomlMcpServersEntry = (content, key) => {
    const header = `[mcp_servers.${key}]`;
    const lines = content.split('\n');
    const headerIndex = lines.findIndex((line) => line.trim() === header);
    if (headerIndex === -1)
        return null; // nothing to remove
    // Find the end of this TOML block: next [section] header or end of file
    let endIndex = lines.length;
    for (let i = headerIndex + 1; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('[') && !trimmed.startsWith('[[')) {
            endIndex = i;
            break;
        }
    }
    // Remove the block, including any trailing blank lines that were separators
    const before = lines.slice(0, headerIndex);
    const after = lines.slice(endIndex);
    // Clean up: if the block was preceded by a blank line (separator), remove it
    while (before.length > 0 && before[before.length - 1].trim() === '') {
        before.pop();
    }
    // If there's content after, add a single separator
    const result = after.length > 0 && after.some((l) => l.trim() !== '')
        ? [...before, '', ...after].join('\n')
        : [...before, ...after].join('\n');
    return result;
};
/**
 * Attempt to remove the commitlore entry from a config file.
 * Returns the outcome.
 */
const removeEntryFromConfig = (entry, home, dryRun) => {
    // Claude Code uses a plugin CLI, not a config file — we cannot programmatically
    // uninstall it without running `claude plugin uninstall commitlore`. Report as left.
    if (entry.format === 'claude-plugin') {
        return {
            agent: entry.agent,
            outcome: 'left',
            reason: 'uses a plugin CLI — run `claude plugin uninstall commitlore` manually',
        };
    }
    const configPath = resolveConfigPath(entry, home);
    if (configPath === null) {
        return { agent: entry.agent, outcome: 'not-found', reason: 'no config path defined' };
    }
    if (!existsSync(configPath)) {
        return { agent: entry.agent, outcome: 'not-found', reason: 'config file does not exist' };
    }
    const content = readFileSync(configPath, 'utf8');
    let newContent = null;
    switch (entry.format) {
        case 'json-mcpServers':
            newContent = removeJsonMcpServersEntry(content, entry.entryKey);
            break;
        case 'json-mcp':
            newContent = removeJsonMcpEntry(content, entry.entryKey);
            break;
        case 'toml-mcp_servers':
            newContent = removeTomlMcpServersEntry(content, entry.entryKey);
            break;
    }
    if (newContent === null) {
        // Either unparseable or entry not found
        if (entry.format.startsWith('json')) {
            // Check if it's unparseable vs just not present
            try {
                JSON.parse(content);
                return { agent: entry.agent, outcome: 'not-found', reason: 'no commitlore entry in config' };
            }
            catch {
                return { agent: entry.agent, outcome: 'left', reason: 'config file is not parseable — left untouched' };
            }
        }
        // TOML: if header not found, entry not present
        return { agent: entry.agent, outcome: 'not-found', reason: 'no commitlore entry in config' };
    }
    if (dryRun) {
        return { agent: entry.agent, outcome: 'would-remove' };
    }
    writeFileSync(configPath, newContent);
    return { agent: entry.agent, outcome: 'removed' };
};
// ─── Main logic ──────────────────────────────────────────────────────────────
export const runUninstall = (options) => {
    const home = options.home ?? homedir();
    const dryRun = options.dryRun ?? false;
    const binPath = join(home, '.local', 'bin', 'commitlore');
    // Binary removal
    let binary;
    if (!existsSync(binPath)) {
        binary = { path: binPath, outcome: 'not-found', reason: 'binary does not exist' };
    }
    else if (!isSelfIdentifyingCommitlore(binPath)) {
        binary = {
            path: binPath,
            outcome: 'left',
            reason: 'does not identify itself as commitlore — refusing to remove',
        };
    }
    else if (dryRun) {
        binary = { path: binPath, outcome: 'would-remove' };
    }
    else {
        rmSync(binPath);
        binary = { path: binPath, outcome: 'removed' };
    }
    // Agent config entry removal
    const agents = AGENT_CONFIGS.map((entry) => removeEntryFromConfig(entry, home, dryRun));
    return {
        binary,
        agents,
        hint: 'Per-repository state (hooks, index, notes) is not affected. Use `commitlore hooks uninstall` and `commitlore inject uninstall-claude-hook` in each repository.',
    };
};
const formatReport = (result) => {
    const lines = [];
    lines.push('== commitlore uninstall ==');
    lines.push('');
    // Binary
    switch (result.binary.outcome) {
        case 'removed':
            lines.push(`Binary: removed ${result.binary.path}`);
            break;
        case 'would-remove':
            lines.push(`Binary: would remove ${result.binary.path}`);
            break;
        case 'left':
            lines.push(`Binary: left ${result.binary.path} (${result.binary.reason})`);
            break;
        case 'not-found':
            lines.push(`Binary: not found at ${result.binary.path}`);
            break;
    }
    lines.push('');
    // Agents
    const removed = [];
    const left = [];
    const notFound = [];
    for (const agent of result.agents) {
        switch (agent.outcome) {
            case 'removed':
            case 'would-remove':
                removed.push(`  - ${agent.agent}${agent.outcome === 'would-remove' ? ' (dry-run)' : ''}`);
                break;
            case 'left':
                left.push(`  - ${agent.agent}: ${agent.reason}`);
                break;
            case 'not-found':
                notFound.push(`  - ${agent.agent}`);
                break;
        }
    }
    if (removed.length > 0) {
        lines.push(result.binary.outcome === 'would-remove' ? 'Would remove MCP entries:' : 'Removed MCP entries:');
        lines.push(...removed);
    }
    if (left.length > 0) {
        lines.push('Left (with reason):');
        lines.push(...left);
    }
    if (notFound.length > 0) {
        lines.push('Not found:');
        lines.push(...notFound);
    }
    lines.push('');
    lines.push(result.hint);
    lines.push('');
    return lines.join('\n');
};
export const register = (program) => {
    program
        .command('uninstall')
        .description('remove the installed binary and agent MCP config entries that install.sh wrote')
        .option('--dry-run', 'print what would be done without changing anything')
        .option('--json', 'emit the report as JSON')
        .addHelpText('after', '\nRemoves only what install.sh wrote: the binary at ~/.local/bin/commitlore ' +
        'and the commitlore MCP entry from each agent config.' +
        '\nPer-repository state (hooks, index, notes) is not affected — use ' +
        '`commitlore hooks uninstall` and `commitlore inject uninstall-claude-hook` in each repository.' +
        '\n\nExit codes: 0 ran successfully, 2 usage error (SPEC §10).')
        .action((options) => {
        const result = runUninstall({
            dryRun: options.dryRun ?? false,
            json: options.json ?? false,
        });
        if (options.json === true) {
            // Privacy: only output the safe fields, never config file contents
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        }
        else {
            process.stdout.write(formatReport(result));
        }
    });
};
//# sourceMappingURL=uninstall.js.map