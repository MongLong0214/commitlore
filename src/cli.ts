#!/usr/bin/env node
/**
 * `commitlore` entry point.
 *
 * Every command other than `parse` lives in its own module under
 * `commands/` and exposes `register(program)`. This file only wires them up:
 * commands are built in parallel and a shared entry point that each one edits
 * is a merge conflict by construction.
 *
 * Still to land: `guard` (T-405), `squash-preserve` (T-302), `mcp`
 * (T-401), `inject` (T-402), `backfill` (T-801).
 */

import { readFileSync } from 'node:fs';

import { Command } from 'commander';

import { register as registerDoctor } from './commands/doctor.js';
import { register as registerHarvest } from './commands/harvest.js';
import { register as registerHooks } from './commands/hooks.js';
import { register as registerIndex } from './commands/index-cmd.js';
import { register as registerQuery } from './commands/query.js';
import { register as registerStale } from './commands/stale.js';
import { register as registerValidate } from './commands/validate.js';
import { parseCommitMessage, serializeTrailers } from './core/trailers.js';

const pkg: { version?: string } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

const STDIN_FD = 0;

const readMessage = (messageFile: string | undefined): string => {
  if (messageFile !== undefined) return readFileSync(messageFile, 'utf8');
  if (process.stdin.isTTY) {
    throw new Error('no commit message on stdin — pipe one in or pass --message-file <path>');
  }
  return readFileSync(STDIN_FD, 'utf8');
};

interface ParseOptions {
  messageFile?: string;
  json?: boolean;
}

const runParse = (options: ParseOptions): void => {
  const trailers = parseCommitMessage(readMessage(options.messageFile));
  // A message with no trailers prints nothing and exits 0 (SPEC §2.1 B7).
  process.stdout.write(
    options.json === true
      ? `${JSON.stringify({ trailers }, null, 2)}\n`
      : serializeTrailers(trailers),
  );
};

const program = new Command();

program
  .name('commitlore')
  .description('Git commit trailers as institutional memory for AI coding agents')
  .version(pkg.version ?? '0.0.0');

program
  .command('parse')
  .description('Parse a commit message into its CommitLore trailers (SPEC §2)')
  .option('--message-file <path>', 'read the message from a file instead of stdin')
  .option('--json', 'emit the parsed trailers as JSON')
  .action((options: ParseOptions) => {
    runParse(options);
  });

registerValidate(program);
registerHooks(program);
registerIndex(program);
registerQuery(program);
registerStale(program);
registerDoctor(program);
registerHarvest(program);

try {
  program.parse(process.argv);
} catch (error) {
  process.stderr.write(`commitlore: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
