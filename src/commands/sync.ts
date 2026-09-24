/**
 * `commitlore sync` — publish and collect the notes mirror (#416).
 *
 * The `pre-push` hook runs this automatically, and that is how it is meant to
 * be reached: after `commitlore init`, a `git push` carries the records with
 * the code they describe and nobody types this command. It exists as a command
 * for the cases the hook cannot cover — a repository whose hooks were never
 * installed, a mirror that needs collecting without a push, and finding out
 * what would happen before it does.
 */

import type { Command } from 'commander';

import {
  SYNC_REMOTE_CONFIG,
  resolveSyncRemotes,
  syncNeedsAttention,
  syncNotes,
  type SyncResult,
  type SyncTargets,
} from '../core/sync.js';

interface SyncCommandOptions {
  cwd?: string;
  remote?: string[];
  fetchOnly?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

/** Exit 2 when a remote needs a human, or no remote could be chosen. Everything else is 0. */
export const SYNC_ATTENTION_EXIT = 2;

const line = (result: SyncResult): string => {
  const detail = result.detail === '' ? result.outcome : result.detail;
  return `${result.remote.padEnd(12)} ${result.outcome.padEnd(14)} ${detail}`;
};

const CHOSEN_BY: Record<SyncTargets['source'], string> = {
  named: 'the remotes named with --remote',
  configured: `the remotes listed in ${SYNC_REMOTE_CONFIG}`,
  'push-remote': "this branch's push remote",
  origin: 'origin, since this branch has no push remote',
  'only-remote': 'the only remote',
  none: 'no remote',
};

export const runSync = (options: SyncCommandOptions = {}): { code: number; stdout: string } => {
  const cwd = options.cwd === undefined ? {} : { cwd: options.cwd };
  // Resolved here as well as inside `syncNotes` so the remotes left alone can
  // be named (#1128): a remote nobody chose is reported, never written to.
  const targets = resolveSyncRemotes({
    ...cwd,
    ...(options.remote === undefined || options.remote.length === 0 ? {} : { remotes: options.remote }),
  });
  const results = syncNotes({
    ...cwd,
    remotes: targets.remotes,
    ...(options.fetchOnly === undefined ? {} : { fetchOnly: options.fetchOnly }),
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
  });
  const unchosen = targets.source === 'none' && targets.skipped.length > 0;
  const code = unchosen || syncNeedsAttention(results) ? SYNC_ATTENTION_EXIT : 0;

  if (options.json === true) {
    return {
      code,
      stdout: `${JSON.stringify({ remotes: results, skipped: targets.skipped, source: targets.source }, null, 2)}\n`,
    };
  }

  if (unchosen) {
    return {
      code,
      stdout:
        `not synced: ${targets.skipped.join(', ')} — this branch has no push remote and none is called origin, ` +
        `so no remote was chosen; name one with --remote, or list them with ` +
        `git config --add ${SYNC_REMOTE_CONFIG} <remote>\n`,
    };
  }

  if (results.length === 0) {
    // Not a failure. A repository with no remote has nowhere to publish, and
    // saying so is a truer answer than an empty table.
    return { code: 0, stdout: 'no remotes configured — the mirror has nowhere to go\n' };
  }

  const skipped =
    targets.source === 'named' || targets.skipped.length === 0
      ? []
      : [`not synced: ${targets.skipped.join(', ')} — sync writes only to ${CHOSEN_BY[targets.source]}; name one with --remote to sync it`];
  return { code, stdout: `${[...results.map(line), ...skipped].join('\n')}\n` };
};

export const register = (program: Command): void => {
  program
    .command('sync')
    .description('publish and collect the notes mirror (the pre-push hook runs this for you)')
    .option('--remote <name>', "sync this remote instead of the branch's push remote (repeatable)", (value: string, previous: string[] = []) => [
      ...previous,
      value,
    ])
    .option('--fetch-only', 'collect from the remote and publish nothing')
    .option('--dry-run', 'report what would happen and change nothing')
    .option('--json', 'machine-readable output')
    .action((options: SyncCommandOptions) => {
      const result = runSync(options);
      process.stdout.write(result.stdout);
      if (result.code !== 0) process.exitCode = result.code;
    });
};
