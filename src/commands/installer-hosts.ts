/**
 * The host-wiring half of the platform installers.
 *
 * install.sh and install.ps1 deliberately do not inspect registrations.  They
 * activate a verified wrapper, invoke this command, print its JSON summary,
 * and return its exit status.  Keeping the test, write, and outcome in one
 * process is what makes an installer success claim useful on both platforms.
 */

import { accessSync, constants, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type { Command } from 'commander';

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

const executable = (command: string): string | null => {
  try {
    if (statSync(command).isDirectory()) return 'command is a directory';
    accessSync(command, constants.X_OK);
    return null;
  } catch {
    return 'command does not exist or is not executable';
  }
};

/** Speak enough MCP to distinguish an executable from a usable CommitLore server. */
export const probeMcp = async (command: string, args: string[]): Promise<string | null> => {
  const unusable = executable(command);
  if (unusable !== null) return unusable;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (problem: string | null): void => {
      if (settled) return;
      settled = true;
      child?.kill();
      resolve(problem);
    };
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    } catch (error) {
      finish(`could not start command: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    let buffer = '';
    let initialized = false;
    const timer = setTimeout(() => finish('MCP initialize timed out'), 5_000);
    child.once('error', (error) => finish(`could not start command: ${error.message}`));
    child.once('exit', (code) => {
      if (!settled) finish(`command exited before MCP verification (status ${String(code)})`);
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        let message: { id?: number; result?: { serverInfo?: { name?: unknown; version?: unknown }; tools?: Array<{ name?: unknown }> } };
        try { message = JSON.parse(line) as typeof message; } catch { continue; }
        if (!initialized && message.id === 1) {
          const info = message.result?.serverInfo;
          if (info?.name !== 'commitlore' || typeof info.version !== 'string' || info.version === '') {
            clearTimeout(timer);
            finish('MCP initialize did not identify CommitLore with a version');
            return;
          }
          initialized = true;
          child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
        } else if (initialized && message.id === 2) {
          const tools = new Set((message.result?.tools ?? []).map((tool) => tool.name));
          clearTimeout(timer);
          finish(tools.has('commitlore_query') && tools.has('commitlore_before_change') ? null : 'MCP server lacks CommitLore minimum tools');
          return;
        }
      }
    });
    // A command that is not an MCP server usually proves it by exiting at once,
    // and then this write lands on a closed pipe. Node delivers EPIPE as an
    // `error` event on the stream, and an unhandled one takes the whole
    // inspector down with it: the installer then exits non-zero having said
    // nothing about any host — a worse answer than the `unhealthy` it was one
    // step away from giving. Whether the write or the child's exit wins is a
    // race, which is why this survived locally and died under CI load.
    child.stdin.on('error', () => finish('command closed its input before MCP verification'));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'commitlore-installer', version: '1' } } })}\n`);
  });
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
    if (problem !== null) return { host, requested: true, outcome: 'failed', healthy: false, detail: `existing registration is unhealthy: ${problem}` };
    return { host, requested: true, outcome: ownEntry(format, entry, wrapper) ? 'owned' : 'custom-preserved', healthy: true, detail: ownEntry(format, entry, wrapper) ? 'healthy installer-owned registration' : 'healthy custom registration preserved' };
  }
  config[key] = { ...group, commitlore: entryFor(format, wrapper) };
  try { atomicJsonWrite(path, config); } catch (error) {
    return { host, requested: true, outcome: 'failed', healthy: false, detail: `atomic config write failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const problem = await probeMcp(wrapper, ['mcp']);
  return problem === null
    ? { host, requested: true, outcome: 'installed', healthy: true, detail: existed ? 'registration added and live-verified' : 'registration created and live-verified' }
    : { host, requested: true, outcome: 'failed', healthy: false, detail: `registration was written but is unhealthy: ${problem}` };
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
    if (problem !== null) return { host: 'codex', requested: true, outcome: 'failed', healthy: false, detail: `existing registration is unhealthy: ${problem}` };
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
  return problem === null
    ? { host: 'codex', requested: true, outcome: 'installed', healthy: true, detail: 'Codex config fallback added and live-verified' }
    : { host: 'codex', requested: true, outcome: 'failed', healthy: false, detail: `Codex registration was written but is unhealthy: ${problem}` };
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
    if (problem !== null) return { host, requested: true, outcome: 'failed', healthy: false, detail: `existing registration is unhealthy: ${problem}` };
    return { host, requested: true, outcome: command === wrapper && args.length === 1 && args[0] === 'mcp' ? 'owned' : 'custom-preserved', healthy: true, detail: command === wrapper && args.length === 1 && args[0] === 'mcp' ? 'healthy installer-owned registration' : 'healthy custom registration preserved' };
  }
  // A non-zero `get` with no registration is the Codex CLI's ordinary absence
  // response; the add itself is the operation whose failure must fail install.
  const added = commandResult('codex', ['mcp', 'add', 'commitlore', '--', wrapper, 'mcp']);
  if (!added.ok) return { host, requested: true, outcome: 'failed', healthy: false, detail: 'codex mcp add failed' };
  const problem = await probeMcp(wrapper, ['mcp']);
  return problem === null
    ? { host, requested: true, outcome: 'installed', healthy: true, detail: 'Codex registration added and live-verified' }
    : { host, requested: true, outcome: 'failed', healthy: false, detail: `Codex registration was written but is unhealthy: ${problem}` };
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
