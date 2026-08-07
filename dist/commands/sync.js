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
import { syncNeedsAttention, syncNotes } from '../core/sync.js';
/** Exit 2 when a remote needs a human. Everything else is 0. */
export const SYNC_ATTENTION_EXIT = 2;
const line = (result) => {
    const detail = result.detail === '' ? result.outcome : result.detail;
    return `${result.remote.padEnd(12)} ${result.outcome.padEnd(14)} ${detail}`;
};
export const runSync = (options = {}) => {
    const results = syncNotes({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.remote === undefined || options.remote.length === 0 ? {} : { remotes: options.remote }),
        ...(options.fetchOnly === undefined ? {} : { fetchOnly: options.fetchOnly }),
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    });
    if (options.json === true) {
        return {
            code: syncNeedsAttention(results) ? SYNC_ATTENTION_EXIT : 0,
            stdout: `${JSON.stringify({ remotes: results }, null, 2)}\n`,
        };
    }
    if (results.length === 0) {
        // Not a failure. A repository with no remote has nowhere to publish, and
        // saying so is a truer answer than an empty table.
        return { code: 0, stdout: 'no remotes configured — the mirror has nowhere to go\n' };
    }
    return {
        code: syncNeedsAttention(results) ? SYNC_ATTENTION_EXIT : 0,
        stdout: `${results.map(line).join('\n')}\n`,
    };
};
export const register = (program) => {
    program
        .command('sync')
        .description('publish and collect the notes mirror (the pre-push hook runs this for you)')
        .option('--remote <name>', 'sync only this remote (repeatable)', (value, previous = []) => [
        ...previous,
        value,
    ])
        .option('--fetch-only', 'collect from the remote and publish nothing')
        .option('--dry-run', 'report what would happen and change nothing')
        .option('--json', 'machine-readable output')
        .action((options) => {
        const result = runSync(options);
        process.stdout.write(result.stdout);
        if (result.code !== 0)
            process.exitCode = result.code;
    });
};
//# sourceMappingURL=sync.js.map