/**
 * `commitlore uninstall` — removes what `install.sh` and `install.ps1` wrote,
 * and nothing else.
 *
 * The restraint is the feature. Three rules shape every branch below:
 *
 * - **Never remove what this installer did not write.** The wrapper is checked
 *   for its marker; an MCP entry is matched on its shape and on the wrapper it
 *   points at, never on the key it sits under. A user may name their own server
 *   `commitlore`, and a machine may carry two installs.
 * - **Never reformat a config beyond the one entry removed.** A config that
 *   cannot be parsed is left exactly as it was and reported.
 * - **Never do another tool's job.** Per-repository state belongs to
 *   `hooks uninstall` and `inject uninstall-claude-hook`; the Claude Code plugin
 *   cache belongs to Claude Code. Both are named, neither is touched.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import { AGENT_CONFIGS, SERVER_KEY, isCommitloreEntry, type ConfigFormat } from '../core/agent-configs.js';
import { removeHermesConfig } from '../core/hermes-config.js';
import { installedPath } from '../core/paths.js';

/** Written into the wrapper by both installers; its absence means it is not ours. */
const WRAPPER_MARKER = '# commitlore:wrapper:v1';

export interface UninstallOptions {
  readonly home?: string;
  /** `XDG_DATA_HOME`, when the installer honoured it. */
  readonly dataHome?: string;
  readonly dryRun?: boolean;
  /** Test seam for a Codex CLI executable; ordinary invocations use `codex`. */
  readonly codexCommand?: string;
}

export interface UninstallResult {
  readonly exitCode: number;
  readonly report: readonly string[];
  readonly removed: readonly string[];
  readonly json: {
    readonly removed: readonly string[];
    readonly kept: readonly string[];
    readonly dryRun: boolean;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Removes the `commitlore` entry from a parsed JSON config, but only when the
 * entry is one we wrote. Returns null when there is nothing to do, so the caller
 * never rewrites a file it had no reason to touch.
 */
const withoutJsonEntry = (
  parsed: unknown,
  format: ConfigFormat,
  wrapper: string,
): Record<string, unknown> | null => {
  if (!isRecord(parsed)) return null;
  const container = format === 'json-mcp' ? 'mcp' : 'mcpServers';
  const servers = parsed[container];
  if (!isRecord(servers)) return null;
  if (!isCommitloreEntry(format, servers[SERVER_KEY], wrapper)) return null;
  const { [SERVER_KEY]: _removed, ...rest } = servers;
  return { ...parsed, [container]: rest };
};

/**
 * Removes a `[mcp_servers.commitlore]` block from a TOML config.
 *
 * Line-based rather than parsed and re-emitted: a TOML round-trip normalises
 * whitespace, quoting and key order across the whole file, which is the
 * "reformat beyond the one entry" this ticket forbids. The block runs from its
 * header to the next header or end of file.
 */
const withoutTomlBlock = (contents: string, wrapper: string): string | null => {
  const lines = contents.split('\n');
  const start = lines.findIndex((l) => l.trim() === `[mcp_servers.${SERVER_KEY}]`);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !(lines[end] ?? '[').trim().startsWith('[')) end += 1;

  const block = lines.slice(start, end);
  const value = (key: string): string | undefined =>
    block.find((l) => l.trim().startsWith(`${key} `) || l.trim().startsWith(`${key}=`))?.split('=')[1]?.trim();
  const command = value('command')?.replace(/^"|"$/g, '');
  const args = value('args')?.replace(/\s/g, '');
  if (command !== wrapper || args !== '["mcp"]') return null;

  // The blank line the installer appended before the block goes with it.
  let from = start;
  if (from > 0 && (lines[from - 1] ?? 'x').trim() === '') from -= 1;
  return [...lines.slice(0, from), ...lines.slice(end)].join('\n');
};

interface CodexMcpServer {
  readonly name?: unknown;
  readonly transport?: {
    readonly type?: unknown;
    readonly command?: unknown;
    readonly args?: unknown;
  };
}

interface CodexMcpListResult {
  readonly state: 'absent' | 'unavailable' | 'listed' | 'invalid';
  readonly servers: readonly CodexMcpServer[];
}

/**
 * Codex owns its config format, so use its CLI to remove an entry it recognises.
 * The explicit shape check preserves uninstall's central restraint: a user can
 * independently name another server `commitlore`, and `mcp remove` alone has
 * no way to distinguish that server from the one this installer registered.
 */
const listCodexMcp = (command: string): CodexMcpListResult => {
  const listed = spawnSync(command, ['mcp', 'list', '--json'], { encoding: 'utf8' });
  if ((listed.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return { state: 'absent', servers: [] };
  }
  if (listed.error !== undefined || listed.status !== 0) return { state: 'unavailable', servers: [] };
  try {
    const parsed: unknown = JSON.parse(listed.stdout);
    if (!Array.isArray(parsed)) return { state: 'invalid', servers: [] };
    return { state: 'listed', servers: parsed.filter(isRecord) as CodexMcpServer[] };
  } catch {
    return { state: 'invalid', servers: [] };
  }
};

const isInstalledCodexServer = (server: CodexMcpServer, wrapper: string): boolean =>
  server.name === SERVER_KEY &&
  server.transport?.type === 'stdio' &&
  server.transport.command === wrapper &&
  Array.isArray(server.transport.args) &&
  server.transport.args.length === 1 &&
  server.transport.args[0] === 'mcp';

export const runUninstall = async (options: UninstallOptions = {}): Promise<UninstallResult> => {
  const home = options.home ?? homedir();
  const dataHome =
    options.dataHome ??
    (process.platform === 'win32'
      ? process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
      : join(home, '.local', 'share'));
  const dryRun = options.dryRun === true;
  const say = dryRun ? 'would remove' : 'removed';

  const report: string[] = [];
  const removed: string[] = [];
  const kept: string[] = [];

  const wrapper = join(home, '.local', 'bin', 'commitlore');
  if (existsSync(wrapper)) {
    const contents = (() => {
      try {
        return readFileSync(wrapper, 'utf8');
      } catch {
        return '';
      }
    })();
    if (contents.includes(WRAPPER_MARKER)) {
      if (!dryRun) rmSync(wrapper, { force: true });
      removed.push(wrapper);
      report.push(`${say}: ${wrapper}`);
    } else {
      kept.push(wrapper);
      report.push(`kept: ${wrapper} — it carries no commitlore marker, so it was not written by this installer`);
    }
  }

  const dataRoot = join(dataHome, 'commitlore');
  if (existsSync(dataRoot)) {
    if (!dryRun) rmSync(dataRoot, { recursive: true, force: true });
    removed.push(dataRoot);
    report.push(`${say}: ${dataRoot}`);
  }

  const codexConfig = AGENT_CONFIGS.find((config) => config.agent === 'codex');
  // `home` is an in-process test seam, not an alternate Codex home. A real
  // invocation has no `home` option and therefore lets Codex select and edit
  // its own config. Tests can opt into the same path with `codexCommand`.
  const codexCommand = options.codexCommand ?? (options.home === undefined ? 'codex' : undefined);
  const codexList = codexCommand === undefined ? null : listCodexMcp(codexCommand);
  if (codexConfig !== undefined && codexList !== null) {
    const path = join(home, ...codexConfig.homeRelativePath);
    if (codexList.state === 'unavailable' || codexList.state === 'invalid') {
      kept.push(path);
      report.push(`kept: ${path} — codex mcp list could not verify its entry, so the config was left untouched`);
    } else if (codexList.state === 'listed') {
      const named = codexList.servers.find((server) => server.name === SERVER_KEY);
      if (named !== undefined && !isInstalledCodexServer(named, wrapper)) {
        kept.push(path);
        report.push(`kept: ${path} — its ${SERVER_KEY} server is not this install, so codex mcp remove was not called`);
      } else if (named !== undefined) {
        if (dryRun) {
          removed.push(`${path} (${SERVER_KEY} entry)`);
          report.push(`${say}: the ${SERVER_KEY} entry through codex mcp remove`);
        } else {
          const removedByCli = spawnSync(codexCommand!, ['mcp', 'remove', SERVER_KEY], { encoding: 'utf8' });
          if (removedByCli.error === undefined && removedByCli.status === 0) {
            removed.push(`${path} (${SERVER_KEY} entry)`);
            report.push(`${say}: the ${SERVER_KEY} entry through codex mcp remove`);
          } else {
            kept.push(path);
            report.push(`kept: ${path} — codex mcp remove could not remove its entry, so the config was left untouched`);
          }
        }
      }
    }
  }

  for (const config of AGENT_CONFIGS) {
    if (config.agent === 'codex' && codexList !== null && codexList.state !== 'absent') continue;
    const path = join(home, ...config.homeRelativePath);
    if (!existsSync(path)) continue;
    let contents: string;
    try {
      contents = readFileSync(path, 'utf8');
    } catch {
      kept.push(path);
      report.push(`kept: ${path} — it could not be read, so it was left untouched`);
      continue;
    }

    if (config.format === 'toml-mcp_servers') {
      const next = withoutTomlBlock(contents, wrapper);
      if (next === null) continue;
      if (!dryRun) writeFileSync(path, next);
      removed.push(`${path} (${SERVER_KEY} entry)`);
      report.push(`${say}: the ${SERVER_KEY} entry in ${path}`);
      continue;
    }

    if (config.format === 'yaml-mcp_servers') {
      const next = removeHermesConfig(contents, {
        wrapperPath: [wrapper, join(dataRoot, 'bin', 'commitlore.cmd')],
        dataRoot,
        installedSkillsDir: installedPath('hermes', 'skills'),
      });
      if (next.removed.length === 0) continue;
      if (!dryRun) writeFileSync(path, next.contents);
      removed.push(`${path} (${next.removed.join(' and ')} ${SERVER_KEY} entries)`);
      report.push(`${say}: the ${next.removed.join(' and ')} ${SERVER_KEY} entries in ${path}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      // Untouched on purpose. Rewriting a file we could not parse is how an
      // uninstall destroys a config it was only supposed to edit one key of.
      kept.push(path);
      report.push(`kept: ${path} — it could not be parsed as JSON, so it was left untouched`);
      continue;
    }
    const next = withoutJsonEntry(parsed, config.format, wrapper);
    if (next === null) continue;
    // Two spaces, and a trailing newline: what both installers write through
    // `jq` and `ConvertTo-Json`. Only the one key changes.
    if (!dryRun) writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    removed.push(`${path} (${SERVER_KEY} entry)`);
    report.push(`${say}: the ${SERVER_KEY} entry in ${path}`);
  }

  report.push('');
  report.push('Not removed by this command, because it did not write them:');
  report.push('  per-repository hooks and index — run `commitlore hooks uninstall` in each repository');
  report.push('  the Claude Code agent hook — run `commitlore inject uninstall-claude-hook`');
  report.push('  the Claude Code plugin — remove it with `/plugin uninstall commitlore@commitlore`');

  return {
    exitCode: 0,
    report,
    removed,
    json: { removed, kept, dryRun },
  };
};

export const registerUninstall = (program: Command): void => {
  program
    .command('uninstall')
    .description('Remove what install.sh or install.ps1 wrote: the wrapper, the checkout and the MCP entries')
    .option('--dry-run', 'report what would be removed and change nothing')
    .option('--json', 'emit the result as JSON')
    .action(async (options: { dryRun?: boolean; json?: boolean }) => {
      const result = await runUninstall(options.dryRun === true ? { dryRun: true } : {});
      if (options.json === true) console.log(JSON.stringify(result.json, null, 2));
      else for (const line of result.report) console.log(line);
      process.exitCode = result.exitCode;
    });
};
