#!/usr/bin/env node
/**
 * `commitlore` entry point.
 *
 * Every command other than `parse` lives in its own module under
 * `commands/` and exposes `register(program)`. This file only wires them up:
 * commands are built in parallel and a shared entry point that each one edits
 * is a merge conflict by construction.
 *
 * Every ticketed command has landed.
 */
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { register as registerBackfill } from './commands/backfill.js';
import { packageVersion } from './core/paths.js';
import { register as registerDoctor } from './commands/doctor.js';
import { register as registerHarvest } from './commands/harvest.js';
import { register as registerGuard } from './commands/guard.js';
import { register as registerHarvestVerify } from './commands/harvest-verify.js';
import { register as registerHooks } from './commands/hooks.js';
import { register as registerIndex } from './commands/index-cmd.js';
import { register as registerInject } from './commands/inject.js';
import { register as registerMcp } from './commands/mcp.js';
import { register as registerQuery } from './commands/query.js';
import { register as registerSquashPreserve } from './commands/squash-preserve.js';
import { register as registerStale } from './commands/stale.js';
import { register as registerValidate } from './commands/validate.js';
import { parseCommitMessage, serializeTrailers } from './core/trailers.js';
const pkg = { version: packageVersion() };
const STDIN_FD = 0;
const readMessage = (messageFile) => {
    if (messageFile !== undefined)
        return readFileSync(messageFile, 'utf8');
    if (process.stdin.isTTY) {
        throw new Error('no commit message on stdin — pipe one in or pass --message-file <path>');
    }
    return readFileSync(STDIN_FD, 'utf8');
};
const runParse = (options) => {
    const trailers = parseCommitMessage(readMessage(options.messageFile));
    // A message with no trailers prints nothing and exits 0 (SPEC §2.1 B7).
    process.stdout.write(options.json === true
        ? `${JSON.stringify({ trailers }, null, 2)}\n`
        : serializeTrailers(trailers));
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
    .action((options) => {
    runParse(options);
});
registerValidate(program);
registerHooks(program);
registerIndex(program);
registerQuery(program);
registerStale(program);
registerDoctor(program);
registerHarvest(program);
registerHarvestVerify(program);
registerSquashPreserve(program);
registerGuard(program);
registerInject(program);
registerBackfill(program);
registerMcp(program);
/**
 * Exit codes are a contract here: 0 clean, 1 the check found something, 2 the
 * invocation was wrong. Hooks and CI branch on them, and every command already
 * follows it -- `validate` returns 2 for mutually exclusive input flags, for
 * one. Commander's own parse failures default to 1, which would make an
 * unknown flag indistinguishable from a real finding, so they are mapped here.
 *
 * `--help` and `--version` also arrive as exceptions; those are a successful
 * invocation and exit 0.
 *
 * One overload is deliberate and worth knowing about: `guard` uses 2 for "a
 * ruled-out alternative matched", so a usage error there is indistinguishable
 * from a warning. That resolves toward warning rather than toward silence,
 * which is the safe direction for a command whose job is to interrupt.
 */
const USAGE_ERRORS = new Set([
    'commander.unknownOption',
    'commander.unknownCommand',
    'commander.missingArgument',
    'commander.missingMandatoryOptionValue',
    'commander.optionMissingArgument',
    'commander.invalidArgument',
    'commander.excessArguments',
    'commander.help',
]);
// exitOverride has to be set on every subcommand as well: commander applies it
// to the command that fails, and a bad flag fails on the subcommand, not here.
program.exitOverride();
for (const command of program.commands)
    command.exitOverride();
try {
    program.parse(process.argv);
}
catch (error) {
    const code = error.code ?? '';
    if (code === 'commander.helpDisplayed' || code === 'commander.version' || code === 'commander.help') {
        process.exit(0);
    }
    if (USAGE_ERRORS.has(code)) {
        // Commander has already written its own diagnostic and the usage line.
        process.exit(2);
    }
    process.stderr.write(`commitlore: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
}
//# sourceMappingURL=cli.js.map