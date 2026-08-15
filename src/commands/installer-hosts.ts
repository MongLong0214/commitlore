/**
 * The host-wiring half of the platform installers.
 *
 * install.sh and install.ps1 deliberately do not inspect registrations.  They
 * activate a verified wrapper, invoke this command, print its JSON summary,
 * and return its exit status.  Keeping the test, write, and outcome in one
 * process is what makes an installer success claim useful on both platforms.
 */

import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import type { Command } from 'commander';

import { isMcpProbeFailure, probeMcp } from '../core/mcp-probe.js';
import { runtimeIdentity, type RuntimeIdentity } from '../core/runtime-identity.js';

export const INSTALLER_HOSTS_SCHEMA = 'commitlore_installer_hosts.v1';

type JsonFormat = 'json-mcpServers' | 'json-mcp';
type HostOutcome = 'installed' | 'owned' | 'custom-preserved' | 'failed';

export interface HostResult {
  host: string;
  requested: true;
  outcome: HostOutcome;
  healthy: boolean;
  detail: string;
}

export interface HostSummary {
  schema: typeof INSTALLER_HOSTS_SCHEMA;
  /** Identity of the installer process that performed this live probe. */
  runtimeIdentity: RuntimeIdentity;
  ok: boolean;
  hosts: HostResult[];
  notDetected: string[];
}

interface Options {
  wrapper: string;
  dataRoot: string;
  home: string;
}

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

const ownEntry = (format: JsonFormat, entry: unknown, wrapper: string): boolean => {
  if (!isObject(entry)) return false;
  if (format === 'json-mcp') {
    const command = entry.command;
    return Array.isArray(command) && command.length === 2 && command[0] === wrapper && command[1] === 'mcp';
  }
  return entry.command === wrapper && Array.isArray(entry.args) && entry.args.length === 1 && entry.args[0] === 'mcp';
};

const commandOf = (format: JsonFormat, entry: unknown): { command: string; args: string[] } | null => {
  if (!isObject(entry)) return null;
  if (format === 'json-mcp') {
    if (!Array.isArray(entry.command) || !entry.command.every((part) => typeof part === 'string') || entry.command.length === 0) return null;
    return { command: entry.command[0] as string, args: entry.command.slice(1) as string[] };
  }
  if (typeof entry.command !== 'string' || !Array.isArray(entry.args) || !entry.args.every((part) => typeof part === 'string')) return null;
  return { command: entry.command, args: entry.args as string[] };
};

const entryFor = (format: JsonFormat, wrapper: string): JsonObject =>
  format === 'json-mcp'
    ? { type: 'local', command: [wrapper, 'mcp'], enabled: true }
    : { command: wrapper, args: ['mcp'] };

const atomicJsonWrite = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${String(path.split('/').pop())}.commitlore-${process.pid}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    // Fault injection exists solely to prove the promise callers depend on:
    // an interruption before rename never changes the original config.
    if (process.env.COMMITLORE_INSTALLER_TEST_INTERRUPT_WRITE === '1') {
      throw new Error('interrupted before atomic rename');
    }
    JSON.parse(readFileSync(temporary, 'utf8'));
    renameSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch { /* renamed or never created */ }
  }
};

const jsonHost = async (host: string, path: string, format: JsonFormat, wrapper: string): Promise<HostResult> => {
  let config: JsonObject;
  let existed = true;
  try {
    config = JSON.parse(readFileSync(path, 'utf8')) as JsonObject;
    if (!isObject(config)) throw new Error('root is not an object');
  } catch (error) {
    if (!existsSync(path)) {
      existed = false;
      config = {};
    } else {
      return { host, requested: true, outcome: 'failed', healthy: false, detail: `config is not parseable JSON: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const key = format === 'json-mcp' ? 'mcp' : 'mcpServers';
  if (config[key] !== undefined && !isObject(config[key])) {
    return { host, requested: true, outcome: 'failed', healthy: false, detail: `${key} is not an object` };
  }
  const group = (config[key] as JsonObject | undefined) ?? {};
  const entry = group.commitlore;
  if (entry !== undefined) {
    const launch = commandOf(format, entry);
    if (launch === null) return { host, requested: true, outcome: 'failed', healthy: false, detail: 'commitlore registration has no runnable command and args' };
    const problem = await probeMcp(launch.command, launch.args);
    if (isMcpProbeFailure(problem)) return { host, requested: true, outcome: 'failed', healthy: false, detail: `existing registration is unhealthy: ${problem.detail}` };
    return { host, requested: true, outcome: ownEntry(format, entry, wrapper) ? 'owned' : 'custom-preserved', healthy: true, detail: ownEntry(format, entry, wrapper) ? 'healthy installer-owned registration' : 'healthy custom registration preserved' };
  }
  config[key] = { ...group, commitlore: entryFor(format, wrapper) };
  try { atomicJsonWrite(path, config); } catch (error) {
    return { host, requested: true, outcome: 'failed', healthy: false, detail: `atomic config write failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const problem = await probeMcp(wrapper, ['mcp']);
  return !isMcpProbeFailure(problem)
    ? { host, requested: true, outcome: 'installed', healthy: true, detail: existed ? 'registration added and live-verified' : 'registration created and live-verified' }
    : { host, requested: true, outcome: 'failed', healthy: false, detail: `registration was written but is unhealthy: ${problem.detail}` };
};

const tomlRegistration = (source: string): { command: string; args: string[] } | null => {
  const table = /^\s*\[mcp_servers\.commitlore\]\s*$/m.exec(source);
  if (table === null || table.index === undefined) return null;
  const body = source.slice(table.index + table[0].length).split(/^\s*\[/m, 1)[0] ?? '';
  const command = /^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m.exec(body)?.[1];
  const args = /^\s*args\s*=\s*\[\s*"mcp"\s*\]\s*$/m.test(body) ? ['mcp'] : null;
  if (command === undefined || args === null) throw new Error('CommitLore table does not contain command plus args = ["mcp"]');
  try { return { command: JSON.parse(`"${command}"`) as string, args }; } catch { throw new Error('CommitLore command is not a valid quoted string'); }
};

const tomlHost = async (path: string, wrapper: string): Promise<HostResult> => {
  let source = '';
  try { source = readFileSync(path, 'utf8'); } catch (error) {
    if (existsSync(path)) return { host: 'codex', requested: true, outcome: 'failed', healthy: false, detail: `could not read config: ${String(error)}` };
  }
  let existing: { command: string; args: string[] } | null;
  try { existing = tomlRegistration(source); } catch (error) {
    return { host: 'codex', requested: true, outcome: 'failed', healthy: false, detail: `config is not parseable TOML: ${String(error)}` };
  }
  if (existing !== null) {
    const problem = await probeMcp(existing.command, existing.args);
    if (isMcpProbeFailure(problem)) return { host: 'codex', requested: true, outcome: 'failed', healthy: false, detail: `existing registration is unhealthy: ${problem.detail}` };
    return { host: 'codex', requested: true, outcome: existing.command === wrapper ? 'owned' : 'custom-preserved', healthy: true, detail: existing.command === wrapper ? 'healthy installer-owned registration' : 'healthy custom registration preserved' };
  }
  const escaped = JSON.stringify(wrapper);
  const next = `${source}${source === '' || source.endsWith('\n') ? '' : '\n'}[mcp_servers.commitlore]\ncommand = ${escaped}\nargs = ["mcp"]\n`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.${String(path.split('/').pop())}.commitlore-${process.pid}-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, next, { encoding: 'utf8', mode: 0o600 });
      if (process.env.COMMITLORE_INSTALLER_TEST_INTERRUPT_WRITE === '1') throw new Error('interrupted before atomic rename');
      tomlRegistration(readFileSync(temporary, 'utf8'));
      renameSync(temporary, path);
    } finally { try { unlinkSync(temporary); } catch { /* renamed or never created */ } }
  } catch (error) {
    return { host: 'codex', requested: true, outcome: 'failed', healthy: false, detail: `atomic config write failed: ${String(error)}` };
  }
  const problem = await probeMcp(wrapper, ['mcp']);
  return !isMcpProbeFailure(problem)
    ? { host: 'codex', requested: true, outcome: 'installed', healthy: true, detail: 'Codex config fallback added and live-verified' }
    : { host: 'codex', requested: true, outcome: 'failed', healthy: false, detail: `Codex registration was written but is unhealthy: ${problem.detail}` };
};

const hasCommand = (command: string): boolean =>
  (process.env.PATH ?? '').split(delimiter).some((directory) => {
    const path = join(directory, command);
    try { return !statSync(path).isDirectory(); } catch { return false; }
  });

const commandResult = (command: string, args: string[]): { ok: boolean; stdout: string } => {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false });
  return { ok: result.status === 0 && result.error === undefined, stdout: result.stdout ?? '' };
};

const cliHost = async (host: string, wrapper: string): Promise<HostResult> => {
  const existing = commandResult('codex', ['mcp', 'get', 'commitlore']);
  if (existing.stdout.trim() !== '') {
    const command = existing.stdout.match(/^\s*command:\s*(.+?)\s*$/m)?.[1];
    const args = existing.stdout.match(/^\s*args:\s*\[?(.+?)\]?\s*$/m)?.[1]
      ?.split(',').map((part) => part.trim().replace(/^"|"$/g, '')).filter(Boolean);
    if (command === undefined || args === undefined) {
      return { host, requested: true, outcome: 'failed', healthy: false, detail: 'codex CLI returned an unverifiable registration' };
    }
    const problem = await probeMcp(command, args);
    if (isMcpProbeFailure(problem)) return { host, requested: true, outcome: 'failed', healthy: false, detail: `existing registration is unhealthy: ${problem.detail}` };
    return { host, requested: true, outcome: command === wrapper && args.length === 1 && args[0] === 'mcp' ? 'owned' : 'custom-preserved', healthy: true, detail: command === wrapper && args.length === 1 && args[0] === 'mcp' ? 'healthy installer-owned registration' : 'healthy custom registration preserved' };
  }
  // A non-zero `get` with no registration is the Codex CLI's ordinary absence
  // response; the add itself is the operation whose failure must fail install.
  const added = commandResult('codex', ['mcp', 'add', 'commitlore', '--', wrapper, 'mcp']);
  if (!added.ok) return { host, requested: true, outcome: 'failed', healthy: false, detail: 'codex mcp add failed' };
  const problem = await probeMcp(wrapper, ['mcp']);
  return !isMcpProbeFailure(problem)
    ? { host, requested: true, outcome: 'installed', healthy: true, detail: 'Codex registration added and live-verified' }
    : { host, requested: true, outcome: 'failed', healthy: false, detail: `Codex registration was written but is unhealthy: ${problem.detail}` };
};

/**
 * Refresh the marketplace, then install. Reported healthy only when both
 * succeed — a plugin that is present at an old version is the case this exists
 * to fix, so "already installed" is not success.
 */
const claudePluginHost = (): HostResult => {
  const host = 'claude-code';
  const run = (args: string[]): number | null =>
    spawnSync('claude', args, { stdio: 'ignore', shell: false, timeout: 60_000 }).status;

  if (run(['plugin', 'marketplace', 'add', 'MongLong0214/commitlore']) === null) {
    return { host, requested: true, outcome: 'failed', healthy: false, detail: 'claude plugin marketplace add could not run' };
  }
  // Already-added is not an error, and update is what makes a new version
  // visible. Both are attempted; only the install decides the verdict.
  run(['plugin', 'marketplace', 'update', 'commitlore']);
  return run(['plugin', 'install', 'commitlore@commitlore', '--scope', 'user']) === 0
    ? { host, requested: true, outcome: 'installed', healthy: true, detail: 'Claude Code plugin installed from the refreshed marketplace (restart running sessions to load it)' }
    : { host, requested: true, outcome: 'failed', healthy: false, detail: 'claude plugin install failed — run manually: claude plugin marketplace update commitlore && claude plugin install commitlore@commitlore' };
};

export const inspectAndApplyHosts = async (options: Options): Promise<HostSummary> => {
  const requested: Array<Promise<HostResult>> = [];
  const notDetected: string[] = [];
  const home = options.home;
  if (hasCommand('codex')) {
    requested.push(cliHost('codex', options.wrapper));
  } else if (existsSync(join(home, '.codex'))) {
    requested.push(tomlHost(join(home, '.codex', 'config.toml'), options.wrapper));
  } else notDetected.push('codex');
  const candidates: Array<[string, string, JsonFormat, boolean]> = [
    ['gemini-cli', join(home, '.gemini', 'settings.json'), 'json-mcpServers', hasCommand('gemini') || existsSync(join(home, '.gemini'))],
    ['cursor', join(home, '.cursor', 'mcp.json'), 'json-mcpServers', hasCommand('cursor') || existsSync(join(home, '.cursor'))],
    ['windsurf', join(home, '.codeium', 'windsurf', 'mcp_config.json'), 'json-mcpServers', hasCommand('windsurf') || existsSync(join(home, '.codeium', 'windsurf'))],
    ['opencode', join(home, '.config', 'opencode', 'opencode.json'), 'json-mcp', hasCommand('opencode') || existsSync(join(home, '.config', 'opencode'))],
  ];
  for (const [host, path, format, present] of candidates) {
    if (present) requested.push(jsonHost(host, path, format, options.wrapper)); else notDetected.push(host);
  }
  // Hermes is intentionally still delegated to its existing transactional
  // helper. This command judges its exit and reports it in the same schema.
  if (hasCommand('hermes') || existsSync(join(home, '.hermes'))) {
    const result = spawnSync(options.wrapper, ['hermes', 'install', '--config', join(home, '.hermes', 'config.yaml'), '--command', options.wrapper, '--data-root', options.dataRoot, '--verify'], { stdio: 'ignore', shell: false, timeout: 30_000 });
    requested.push(Promise.resolve(result.status === 0
      ? { host: 'hermes', requested: true, outcome: 'installed', healthy: true, detail: 'Hermes setup verified' }
      : { host: 'hermes', requested: true, outcome: 'failed', healthy: false, detail: 'Hermes setup failed' }));
  } else notDetected.push('hermes');
  /**
   * Claude Code, which was in neither list until now (#689).
   *
   * `install.sh` defines `has_claude_code` and `wire_claude_code` and calls
   * neither; this enumeration had no branch for it. So the plugin cache went
   * untouched by every release and nothing said so — `notDetected: []` read as
   * "every host was detected", which is how a missing host stays missing.
   *
   * It is a marketplace plugin rather than an MCP registration, so it needs the
   * marketplace refreshed before installing: adding one that is already present
   * is a no-op, and without the refresh a reinstall reinstates the same version
   * (#660).
   */
  if (hasCommand('claude')) {
    requested.push(Promise.resolve(claudePluginHost()));
  } else notDetected.push('claude-code');
  const hosts = await Promise.all(requested);
  return { schema: INSTALLER_HOSTS_SCHEMA, runtimeIdentity: runtimeIdentity(), ok: hosts.every((host) => host.healthy), hosts, notDetected };
};

interface CommandOptions { wrapper: string; dataRoot: string; home: string; json?: boolean; }

export const register = (program: Command): void => {
  program.command('installer-hosts')
    .description('inspect, apply, and live-verify detected CommitLore host registrations')
    .requiredOption('--wrapper <path>', 'the verified CommitLore wrapper path')
    .requiredOption('--data-root <path>', 'the CommitLore data root')
    .requiredOption('--home <path>', 'the target user home directory')
    .option('--json', 'emit the installer host summary as JSON')
    .action(async (options: CommandOptions) => {
      const summary = await inspectAndApplyHosts(options);
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      if (!summary.ok) process.exitCode = 1;
    });
};
