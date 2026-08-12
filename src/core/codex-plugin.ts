/**
 * Codex plugin installation is deliberately mediated by Codex's own CLI. Its
 * marketplace config and cache are client-owned state; editing either would
 * recreate the silent-discovery failure this route exists to avoid.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { AGENT_CONFIGS, isCodexPluginConfig, type CodexPluginConfig } from './agent-configs.js';

export interface CodexCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

export type CodexCommandRunner = (args: readonly string[]) => CodexCommandResult;

export interface CodexPluginOptions {
  readonly dataHome?: string;
  readonly run?: CodexCommandRunner;
}

export interface CodexPluginResult {
  readonly exitCode: 0 | 2;
  readonly report: readonly string[];
}

const MARKER_VERSION = 1;

interface CodexPluginMarker {
  readonly version: number;
  readonly selector: string;
  readonly source: string;
}

const defaultDataHome = (): string =>
  process.platform === 'win32'
    ? process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
    : process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share');

/**
 * What Codex said, as a line worth printing.
 *
 * Every failure below already had this and threw it away, so an operator whose
 * DNS was down read "could not add the marketplace" followed by "retry with"
 * the identical command. Retrying unchanged could not have helped, and the one
 * sentence that would have told them so had been captured and discarded.
 */
const codexSaid = (result: CodexCommandResult): string[] => {
  const said = (result.stderr.trim() || result.stdout.trim()).split('\n')[0]?.trim() ?? '';
  if (said === '') return [];
  return [`codex said: ${said}`];
};

export const runCodexCommand: CodexCommandRunner = (args) => {
  const result = spawnSync('codex', args, { encoding: 'utf8', timeout: 30_000 });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error === undefined ? {} : { error: result.error }),
  };
};

const config = (): CodexPluginConfig => {
  const found = AGENT_CONFIGS.find(isCodexPluginConfig);
  if (found === undefined) throw new Error('Codex plugin installation is missing from the agent configuration table');
  return found;
};

export const codexPluginSelector = (plugin = config()): string => `${plugin.plugin}@${plugin.marketplace}`;

export const codexPluginInstallCommand = (): string => 'commitlore plugin install-codex';

export const codexPluginMarkerPath = (
  plugin: CodexPluginConfig = config(),
  dataHome = defaultDataHome(),
): string => join(dataHome, ...plugin.dataRelativePath);

const successful = (result: CodexCommandResult): boolean => result.status === 0 && result.error === undefined;

const marketplaceIsConfigured = (output: string, plugin: CodexPluginConfig): boolean =>
  output.split('\n').some((line) => line.trim().startsWith(`${plugin.marketplace} `));

export const codexPluginIsInstalled = (
  output: string,
  plugin: CodexPluginConfig = config(),
): boolean =>
  output
    .split('\n')
    .some((line) => line.trim().startsWith(codexPluginSelector(plugin)) && line.includes('installed,'));

const markerFor = (plugin: CodexPluginConfig): CodexPluginMarker => ({
  version: MARKER_VERSION,
  selector: codexPluginSelector(plugin),
  source: plugin.marketplaceSource,
});

export const readCodexPluginMarker = (
  plugin: CodexPluginConfig = config(),
  dataHome = defaultDataHome(),
): CodexPluginMarker | null => {
  const markerPath = codexPluginMarkerPath(plugin, dataHome);
  if (!existsSync(markerPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(markerPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const marker = parsed as Partial<CodexPluginMarker>;
    const expected = markerFor(plugin);
    return marker.version === expected.version && marker.selector === expected.selector && marker.source === expected.source
      ? expected
      : null;
  } catch {
    return null;
  }
};

export const removeCodexPluginMarker = (
  plugin: CodexPluginConfig = config(),
  dataHome = defaultDataHome(),
): void => {
  rmSync(codexPluginMarkerPath(plugin, dataHome), { force: true });
};

const writeCodexPluginMarker = (plugin: CodexPluginConfig, dataHome: string): void => {
  const markerPath = codexPluginMarkerPath(plugin, dataHome);
  mkdirSync(join(markerPath, '..'), { recursive: true });
  writeFileSync(markerPath, `${JSON.stringify(markerFor(plugin), null, 2)}\n`);
};

/**
 * Registers the marketplace once, installs the plugin once, and leaves a small
 * ownership marker only after Codex confirms success. Both `codex` calls are
 * client APIs: their state is never inferred from or written as TOML here.
 */
export const installCodexPlugin = (options: CodexPluginOptions = {}): CodexPluginResult => {
  const plugin = config();
  const dataHome = options.dataHome ?? defaultDataHome();
  const run = options.run ?? runCodexCommand;
  const report: string[] = [];

  const marketplaces = run(['plugin', 'marketplace', 'list']);
  if (!successful(marketplaces)) {
    return {
      exitCode: 2,
      report: [
        'could not list Codex plugin marketplaces; no plugin installation was recorded',
        ...codexSaid(marketplaces),
        `retry with: ${codexPluginInstallCommand()}`,
      ],
    };
  }

  if (!marketplaceIsConfigured(marketplaces.stdout, plugin)) {
    const added = run(['plugin', 'marketplace', 'add', plugin.marketplaceSource]);
    if (!successful(added)) {
      return {
        exitCode: 2,
        report: [
          `could not add the ${plugin.marketplace} Codex marketplace; no plugin installation was recorded`,
          ...codexSaid(added),
          `retry with: ${codexPluginInstallCommand()}`,
        ],
      };
    }
    report.push(`configured Codex marketplace: ${plugin.marketplace}`);
  }

  const listed = run(['plugin', 'list']);
  if (!successful(listed)) {
    return {
      exitCode: 2,
      report: [
        'could not list Codex plugins; no plugin installation was recorded',
        ...codexSaid(listed),
        `retry with: ${codexPluginInstallCommand()}`,
      ],
    };
  }

  if (!codexPluginIsInstalled(listed.stdout, plugin)) {
    const added = run(['plugin', 'add', codexPluginSelector(plugin)]);
    if (!successful(added)) {
      return {
        exitCode: 2,
        report: [
          `could not install ${codexPluginSelector(plugin)}; no plugin installation was recorded`,
          ...codexSaid(added),
          `retry with: ${codexPluginInstallCommand()}`,
        ],
      };
    }
    report.push(`installed Codex plugin: ${codexPluginSelector(plugin)}`);
  } else {
    report.push(`Codex plugin already installed: ${codexPluginSelector(plugin)}`);
  }

  writeCodexPluginMarker(plugin, dataHome);
  report.push('start a new Codex session to load the CommitLore skill and MCP tools');
  return { exitCode: 0, report };
};
