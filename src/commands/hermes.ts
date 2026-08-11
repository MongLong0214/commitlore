/** Host-side setup for the Hermes coding agent.
 *
 * Repository wiring remains `commitlore init`; this command owns only the
 * active Hermes profile. Keeping that boundary explicit prevents an installer
 * from unexpectedly touching whichever repository happened to be current.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import type { Command } from 'commander';

import { addHermesConfig } from '../core/hermes-config.js';
import { installedPath } from '../core/paths.js';

export interface HermesInstallOptions {
  readonly configPath?: string;
  readonly home?: string;
  readonly dataHome?: string;
  readonly dataRoot?: string;
  readonly wrapperPath?: string;
  /** Test seam; ordinary calls detect Hermes from its executable or profile. */
  readonly detected?: boolean;
  /** The deployed bundle location is injectable so this can be tested without a release checkout. */
  readonly skillsDir?: string;
  readonly verify?: boolean;
}

export interface HermesInstallResult {
  readonly exitCode: 0 | 1 | 2;
  readonly report: readonly string[];
  readonly changed: readonly ('mcp' | 'skills')[];
  readonly verified: readonly string[];
}

const commandExists = (command: string): boolean => {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 5_000, stdio: 'ignore' });
  return result.error === undefined;
};

const backupPathFor = (configPath: string): string => {
  const base = `${configPath}.commitlore-backup`;
  if (!existsSync(base)) return base;
  for (let index = 1; ; index += 1) {
    const candidate = `${base}.${index}`;
    if (!existsSync(candidate)) return candidate;
  }
};

const atomicallyWrite = (path: string, contents: string, mode?: number): void => {
  const temporary = join(dirname(path), `.${basename(path)}.commitlore-${process.pid}.tmp`);
  try {
    if (mode === undefined) writeFileSync(temporary, contents, 'utf8');
    else writeFileSync(temporary, contents, { encoding: 'utf8', mode });
    renameSync(temporary, path);
  } catch (error) {
    // `renameSync` is deliberately the final operation. If it fails, the old
    // config stays in place and the caller gets the real reason.
    throw error;
  }
};

const runVerification = (report: string[], verified: string[]): void => {
  if (!commandExists('hermes')) {
    report.push('unverified: Hermes is not on PATH, so start a fresh session to load the configured profile');
    return;
  }

  const skills = spawnSync('hermes', ['skills', 'list', '--source', 'all'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  const skillOutput = `${skills.stdout ?? ''}${skills.stderr ?? ''}`;
  const names = ['commitlore-setup', 'commitlore-query', 'commitlore-commits'];
  if (skills.status === 0 && names.every((name) => skillOutput.includes(name))) {
    verified.push('fresh Hermes process lists the CommitLore skills');
    report.push('verified: fresh Hermes process lists commitlore-setup, commitlore-query and commitlore-commits');
  } else {
    report.push('unverified: Hermes did not list every CommitLore skill; start a fresh session and run `hermes skills list --source all`');
  }

  const mcp = spawnSync('hermes', ['mcp', 'test', 'commitlore'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  const mcpOutput = `${mcp.stdout ?? ''}${mcp.stderr ?? ''}`;
  if (mcp.status === 0 && mcpOutput.includes('commitlore_before_change')) {
    verified.push('Hermes MCP probe lists CommitLore tools');
    report.push('verified: Hermes MCP probe lists CommitLore tools');
  } else {
    report.push('unverified: Hermes could not list the CommitLore MCP tools; run `hermes mcp test commitlore`');
  }
};

export const runHermesInstall = (options: HermesInstallOptions = {}): HermesInstallResult => {
  const home = options.home ?? homedir();
  // Hermes treats HERMES_HOME as the profile directory itself (where
  // config.yaml lives), not as the OS home directory. Keep the CommitLore
  // wrapper and installed bundle under the user's normal data locations while
  // targeting the profile Hermes has selected for this process.
  const hermesHome = process.env['HERMES_HOME'];
  const configPath = options.configPath ?? (hermesHome === undefined ? join(home, '.hermes', 'config.yaml') : join(hermesHome, 'config.yaml'));
  const dataHome = options.dataHome ?? process.env['XDG_DATA_HOME'] ?? join(home, '.local', 'share');
  const dataRoot = options.dataRoot ?? join(dataHome, 'commitlore');
  const skillsDir = options.skillsDir ?? installedPath('hermes', 'skills');
  const detected = options.detected ?? (existsSync(dirname(configPath)) || commandExists('hermes'));
  const report: string[] = [];
  const verified: string[] = [];

  if (!detected) {
    return {
      exitCode: 0,
      report: ['Hermes not detected — left its profile untouched.'],
      changed: [],
      verified,
    };
  }

  if (!existsSync(skillsDir)) {
    return {
      exitCode: 2,
      report: [`could not find the CommitLore Hermes skill bundle at ${skillsDir}`],
      changed: [],
      verified,
    };
  }

  const wrapperPath = options.wrapperPath ?? join(home, '.local', 'bin', 'commitlore');
  const before = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const edit = addHermesConfig(before, {
    wrapperPath,
    skillsDir: resolve(skillsDir),
    dataRoot,
  });

  // A host setup with either half missing is not complete. More importantly,
  // writing the other half after finding a foreign entry makes a failed run
  // unexpectedly mutate the profile. Report the conflict and leave the whole
  // file byte-identical so the operator has one clear recovery point.
  if (edit.blocked.length > 0) {
    for (const reason of edit.blocked) report.push(`could not configure: ${reason}`);
    return { exitCode: 1, report, changed: [], verified };
  }

  if (edit.added.length > 0) {
    try {
      mkdirSync(dirname(configPath), { recursive: true });
      if (existsSync(configPath)) {
        const backup = backupPathFor(configPath);
        copyFileSync(configPath, backup);
        report.push(`backed up: ${configPath} -> ${backup}`);
      }
      const mode = existsSync(configPath) ? statSync(configPath).mode : undefined;
      atomicallyWrite(configPath, edit.contents, mode);
      report.push(`configured: ${edit.added.join(' and ')} in ${configPath}`);
    } catch (error) {
      return {
        exitCode: 2,
        report: [...report, `could not update ${configPath}: ${error instanceof Error ? error.message : String(error)}`],
        changed: [],
        verified,
      };
    }
  } else {
    report.push('Hermes already configured (unchanged).');
  }

  if (options.verify === true) runVerification(report, verified);

  return {
    exitCode: 0,
    report,
    changed: edit.added,
    verified,
  };
};

export const register = (program: Command): void => {
  const hermes = program
    .command('hermes')
    .description('configure the active Hermes profile with CommitLore MCP tools and skills');

  hermes
    .command('install')
    .description('wire Hermes host configuration; repository setup remains `commitlore init`')
    .option('--config <path>', 'Hermes config.yaml path (defaults to the active profile)')
    .option('--command <path>', 'CommitLore wrapper Hermes should execute (defaults to ~/.local/bin/commitlore)')
    .option('--data-root <path>', 'CommitLore install data root, used when replacing an older skill bundle')
    .option('--verify', 'probe skill discovery and MCP tools after configuring')
    .action((options: { config?: string; command?: string; dataRoot?: string; verify?: boolean }) => {
      const result = runHermesInstall({
        ...(options.config === undefined ? {} : { configPath: options.config }),
        ...(options.command === undefined ? {} : { wrapperPath: options.command }),
        ...(options.dataRoot === undefined ? {} : { dataRoot: options.dataRoot }),
        verify: options.verify === true,
      });
      for (const line of result.report) console.log(line);
      process.exitCode = result.exitCode;
    });
};
