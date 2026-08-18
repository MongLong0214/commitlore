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
import { register as registerAuto } from './commands/auto.js';
import { register as registerCapture } from './commands/capture.js';
import { register as registerDemo } from './commands/demo.js';
import { packageVersion } from './core/paths.js';
import { probeMcp } from './core/mcp-probe.js';
import { formatRuntimeIdentity, runtimeIdentity } from './core/runtime-identity.js';
import { register as registerDoctor } from './commands/doctor.js';
import { register as registerHarvest } from './commands/harvest.js';
import { register as registerGuard } from './commands/guard.js';
import { register as registerHarvestVerify } from './commands/harvest-verify.js';
import { register as registerHermes } from './commands/hermes.js';
import { register as registerHooks } from './commands/hooks.js';
import { register as registerIndex } from './commands/index-cmd.js';
import { register as registerInit } from './commands/init.js';
import { register as registerInject } from './commands/inject.js';
import { register as registerInstallerHosts } from './commands/installer-hosts.js';
import { register as registerMcp } from './commands/mcp.js';
import { register as registerPending } from './commands/pending.js';
import { register as registerPlugin } from './commands/plugin.js';
import { register as registerQuery } from './commands/query.js';
import { register as registerSquashPreserve } from './commands/squash-preserve.js';
import { register as registerStale } from './commands/stale.js';
import { register as registerUpgrade } from './commands/update.js';
import { beginUpdateCheck, finishUpdateCheck } from './core/update-notice.js';
import { register as registerSync } from './commands/sync.js';
import { register as registerValidate } from './commands/validate.js';
import { registerUninstall } from './commands/uninstall.js';
import { register as registerPostCommit } from './hooks/post-commit.js';
import { register as registerPrepareCommitMsg } from './hooks/prepare-commit-msg.js';
import { register as registerPrePush } from './hooks/pre-push.js';
import { labelRecordBlocks, serializeTrailers } from './core/trailers.js';
const pkg = { version: packageVersion() };
const STDIN_FD = 0;
const internalMcpProbe = async (command, rawArgs) => {
    let args;
    try {
        const parsed = JSON.parse(rawArgs ?? 'null');
        if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string'))
            args = parsed;
    }
    catch {
        // The result below is a probe response, not an uncaught helper error.
    }
    const result = command === undefined || args === undefined
        ? { kind: 'failure', reason: 'probe-unavailable', detail: 'could not read MCP verification arguments' }
        : await probeMcp(command, args);
    await new Promise((resolve) => process.stdout.write(JSON.stringify(result), () => resolve()));
};
const internalArguments = process.argv.slice(2);
if (internalArguments[0] === 'internal' && internalArguments[1] === 'mcp-probe') {
    const commandIndex = internalArguments.indexOf('--command');
    const argsIndex = internalArguments.indexOf('--args-json');
    await internalMcpProbe(commandIndex === -1 ? undefined : internalArguments[commandIndex + 1], argsIndex === -1 ? undefined : internalArguments[argsIndex + 1]);
    process.exit(0);
}
const readMessage = (messageFile) => {
    if (messageFile !== undefined)
        return readFileSync(messageFile, 'utf8');
    if (process.stdin.isTTY) {
        throw new Error('no commit message on stdin — pipe one in or pass --message-file <path>');
    }
    return readFileSync(STDIN_FD, 'utf8');
};
/** `Record-Id:` when a block declared one. Mirrors every other command's own local copy of this lookup (`commands/query.ts`, `core/query.ts`). */
const recordIdOf = (block) => block.trailers.find((trailer) => trailer.key === 'Record-Id')?.value;
const recordLabel = (index, total, block) => {
    const tags = [block.own ? 'own' : 'earlier', ...(block.identityCollision ? ['Record-Id collision'] : [])];
    return `# record ${index + 1}/${total} — ${tags.join(', ')}`;
};
const runParse = (options) => {
    const message = readMessage(options.messageFile);
    const blocks = labelRecordBlocks(message);
    // A single-record message (zero or one block, SPEC §2.4) parses exactly as
    // it always has -- the multi-block form below is additive, never a
    // replacement for this shape, the same way SPEC §2.4 itself only adds to
    // §2.1-2.3 rather than overriding them (bug-issue-89).
    if (blocks.length <= 1) {
        const trailers = blocks[0]?.trailers ?? [];
        // A message with no trailers prints nothing and exits 0 (SPEC §2.1 B7).
        process.stdout.write(options.json === true
            ? `${JSON.stringify({ trailers }, null, 2)}\n`
            : serializeTrailers(trailers));
        return;
    }
    // Report every colliding Record-Id once, in the order it first appears,
    // before stdout -- a diagnostic on stderr that arrives after the answer it
    // qualifies is easy to miss (the same ordering `commands/query.ts` uses).
    const reported = new Set();
    for (const block of blocks) {
        const id = recordIdOf(block);
        if (id === undefined || !block.identityCollision || reported.has(id))
            continue;
        reported.add(id);
        process.stderr.write(`commitlore: Record-Id ${id} is declared by more than one record block in this message\n`);
    }
    if (options.json === true) {
        process.stdout.write(`${JSON.stringify(
        // `trailers` keeps meaning what it always meant -- the message's own
        // block -- so a consumer that only ever read that key never has to
        // learn about `blocks` to keep working.
        { trailers: blocks[blocks.length - 1]?.trailers ?? [], blocks }, null, 2)}\n`);
        return;
    }
    process.stdout.write(blocks
        .map((block, index) => `${recordLabel(index, blocks.length, block)}\n${serializeTrailers(block.trailers)}`)
        .join('\n'));
};
const program = new Command();
program
    .name('commitlore')
    .description('Git commit trailers as institutional memory for AI coding agents')
    .version(pkg.version ?? '0.0.0');
// Machine-readable on purpose: hooks, installers and MCP hosts need the
// entrypoint and root too; a version string was the ambiguity F-001 found.
program
    .command('runtime-identity')
    .description('print the exact CommitLore runtime this command executes')
    .option('--json', 'emit the runtime identity as JSON')
    .action((options) => {
    const identity = runtimeIdentity();
    process.stdout.write(options.json === true
        ? `${formatRuntimeIdentity(identity)}\n`
        : `version ${identity.version}\nentrypoint ${identity.entrypoint}\npackage root ${identity.packageRoot}\nindex schema v${identity.indexSchemaVersion}\n`);
});
program
    .command('parse')
    .description('Parse a commit message into its CommitLore trailers (SPEC §2)')
    .option('--message-file <path>', 'read the message from a file instead of stdin')
    .option('--json', 'emit the parsed trailers as JSON')
    .addHelpText('after', '\nA message carrying more than one record block (SPEC §2.4) prints every block, ' +
    'labeled own (the message\'s own last paragraph) or earlier (a block the grammar recovered), ' +
    'and flags any Record-Id declared by more than one block. A single-block message is unaffected.' +
    '\nExit codes: 0 parsed (including a message with no trailers), 2 the message could not be read.')
    .action((options) => {
    runParse(options);
});
/**
 * An implementation-only bridge for synchronous doctor checks. Both command
 * levels are hidden so the bundle keeps one public command surface while the
 * probe can still run the same bundled code in a child process.
 */
program
    .command('internal', { hidden: true })
    .command('mcp-probe', { hidden: true })
    .requiredOption('--command <command>', 'MCP command to verify')
    .requiredOption('--args-json <json>', 'JSON array of MCP command arguments')
    .action(async (options) => {
    await internalMcpProbe(options.command, options.argsJson);
});
registerSync(program);
registerPrePush(program);
registerValidate(program);
registerUninstall(program);
registerHooks(program);
registerIndex(program);
registerQuery(program);
registerStale(program);
registerUpgrade(program);
registerDoctor(program);
registerInit(program);
registerAuto(program);
registerHarvest(program);
registerHarvestVerify(program);
registerHermes(program);
registerSquashPreserve(program);
registerPrepareCommitMsg(program);
registerPostCommit(program);
registerGuard(program);
registerInject(program);
registerBackfill(program);
registerCapture(program);
registerDemo(program);
registerMcp(program);
registerPending(program);
registerPlugin(program);
registerInstallerHosts(program);
/**
 * Exit codes are a protocol property, not a per-command habit (SPEC §10): 0
 * clean, 1 the check found something, 2 the invocation was wrong, 3 answered
 * from an incomplete view. Hooks and CI branch on them, and every command
 * follows it -- `validate` returns 2 for mutually exclusive input flags, for
 * one. Commander's own parse failures default to 1, which would make an
 * unknown flag indistinguishable from a real finding, so they are mapped here
 * to 2: the invocation was wrong, not a finding.
 *
 * `--help` and `--version` also arrive as exceptions; those are a successful
 * invocation and exit 0.
 *
 * Anything that reaches this catch without a commander code is a thrown error
 * from an action that never got the chance to classify it itself -- `parse`
 * is the one command that does not wrap its own body in a try/catch, so an
 * unreadable `--message-file` surfaces here. That is a usage error (a missing
 * input file, SPEC §10), not a finding, so it maps to 2 as well.
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
// Started here and never awaited. The notice's whole property is that a slow
// or hanging check costs the command nothing: `gh` starts its check
// concurrently and cancels before reading, and this is the same shape. Awaiting
// this anywhere would trade away the reason it exists (T-1604).
const noticeContext = {
    argv: process.argv.slice(2),
    env: process.env,
    stdoutTty: process.stdout.isTTY === true,
    stderrTty: process.stderr.isTTY === true,
};
beginUpdateCheck(noticeContext);
const speak = (failed) => {
    try {
        finishUpdateCheck(noticeContext, packageVersion(), failed, (line) => process.stderr.write(line));
    }
    catch {
        // A broken check leaves every command's behaviour unchanged. That is
        // asserted by a test that injects a throwing one.
    }
};
try {
    await program.parseAsync(process.argv);
    speak(false);
}
catch (error) {
    speak(true);
    const code = error.code ?? '';
    if (code === 'commander.helpDisplayed' || code === 'commander.version' || code === 'commander.help') {
        process.exit(0);
    }
    if (USAGE_ERRORS.has(code)) {
        // Commander has already written its own diagnostic and the usage line.
        process.exit(2);
    }
    process.stderr.write(`commitlore: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
}
//# sourceMappingURL=cli.js.map