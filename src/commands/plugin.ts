/** `commitlore plugin install-codex` — the one-command Codex plugin route. */

import type { Command } from 'commander';

import { codexPluginInstallCommand, installCodexPlugin } from '../core/codex-plugin.js';

export const register = (program: Command): void => {
  const plugin = program.command('plugin').description('manage CommitLore coding-agent plugins');

  plugin
    .command('install-codex')
    .description('install or repair the CommitLore Codex plugin through the Codex CLI')
    .option('--print', 'print the one command instead of running it')
    .addHelpText(
      'after',
      '\nRegisters the CommitLore marketplace and installs commitlore@commitlore only when each is absent. ' +
        'It never edits Codex configuration or cache files directly. Exit codes: 0 installed or already installed, 2 Codex could not complete the operation.',
    )
    .action((options: { print?: boolean }) => {
      if (options.print === true) {
        console.log(codexPluginInstallCommand());
        return;
      }
      const result = installCodexPlugin();
      for (const line of result.report) console.log(line);
      process.exitCode = result.exitCode;
    });
};
