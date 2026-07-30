/**
 * `commitlore demo` — T-1011 (#203).
 *
 * Creates a temporary Git repository, populates it with the fixture scenario
 * from T-1010, runs init + a path query showing lifecycle filtering, prints the
 * result, and removes the temporary directory.
 *
 * Safety properties:
 * - Never writes into the user's repository (all git ops use explicit cwd)
 * - Removes its temporary directory even on failure or interrupt
 * - Needs no network and no model
 * - On unsupported platforms, prints a reason and exits non-zero
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { predecessorCommitMessage, successorCommitMessage, targetPath, expectedActiveRecordId, } from '../demo/fixture.js';
import { runInit } from './init.js';
import { runQuery } from '../core/query.js';
// ---------------------------------------------------------------------------
// Platform support
// ---------------------------------------------------------------------------
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'freebsd']);
const checkPlatform = (override) => {
    const platform = override ?? process.platform;
    if (SUPPORTED_PLATFORMS.has(platform))
        return null;
    return `commitlore demo is not supported on ${platform} — it requires a POSIX environment for temporary repository operations.`;
};
// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------
const git = (args, cwd) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'CommitLore Demo',
        GIT_AUTHOR_EMAIL: 'demo@commitlore.example',
        GIT_COMMITTER_NAME: 'CommitLore Demo',
        GIT_COMMITTER_EMAIL: 'demo@commitlore.example',
    },
}).trim();
/**
 * Runs the demo scenario in a temporary repository.
 *
 * The function is async-shaped for future flexibility but executes
 * synchronously today (no network, no model).
 */
export const runDemo = async (opts = {}) => {
    // Platform check is the very first operation — no temp dir created on failure
    const platformError = checkPlatform(opts.platformOverride);
    if (platformError !== null) {
        return { exitCode: 1, output: platformError };
    }
    let tmpDir;
    // Signal handler for cleanup on interrupt
    const cleanup = () => {
        if (tmpDir !== undefined) {
            try {
                rmSync(tmpDir, { recursive: true, force: true });
            }
            catch {
                // Best-effort cleanup
            }
            tmpDir = undefined;
        }
    };
    const onSignal = () => {
        cleanup();
        // Restore default behavior and re-raise
        process.exit(130);
    };
    // Register cleanup handlers — removed in finally block
    process.prependOnceListener('SIGINT', onSignal);
    process.prependOnceListener('SIGTERM', onSignal);
    try {
        // Create temporary directory with a recognizable prefix for testing
        tmpDir = mkdtempSync(join(tmpdir(), 'commitlore-demo-'));
        // Verify we are NOT operating on the user's repository
        const userCwd = resolve(opts.cwd ?? process.cwd());
        const tmpResolved = resolve(tmpDir);
        if (tmpResolved === userCwd || tmpResolved.startsWith(userCwd + '/') || userCwd.startsWith(tmpResolved + '/')) {
            throw new Error('demo: temporary directory overlaps with user repository — aborting');
        }
        // Initialize a fresh git repo in the temp directory
        git(['init', '--quiet', '--template=', '--initial-branch=main', tmpDir], dirname(tmpDir));
        git(['config', 'user.name', 'CommitLore Demo'], tmpDir);
        git(['config', 'user.email', 'demo@commitlore.example'], tmpDir);
        git(['config', 'commit.gpgsign', 'false'], tmpDir);
        // Create the target file so the path exists
        const targetFullPath = join(tmpDir, targetPath);
        mkdirSync(dirname(targetFullPath), { recursive: true });
        writeFileSync(targetFullPath, '// session cache module\n');
        git(['add', '.'], tmpDir);
        // Commit the predecessor decision (will become superseded)
        git(['commit', '-m', predecessorCommitMessage], tmpDir);
        // Crash test point — simulate a failure mid-execution
        if (opts.crashTest === true) {
            throw new Error('demo: simulated crash for testing cleanup');
        }
        // Modify the target file and commit the successor decision (supersedes predecessor)
        writeFileSync(targetFullPath, '// session cache module — now using SQLite\n');
        git(['add', '.'], tmpDir);
        git(['commit', '-m', successorCommitMessage], tmpDir);
        // Run init to set up the index and hooks in the temp repo
        runInit({ cwd: tmpDir });
        // Query for the target path — lifecycle filtering will show only active records
        const queryResult = runQuery({
            cwd: tmpDir,
            path: targetPath,
            at: new Date(),
        });
        // Format the output showing lifecycle filtering
        const lines = [];
        lines.push('─── commitlore demo ───');
        lines.push('');
        lines.push(`Scenario: two decisions recorded for ${targetPath}`);
        lines.push('  1. "Use Redis for session cache" (later superseded)');
        lines.push('  2. "Switch to SQLite" (supersedes the first — now active)');
        lines.push('');
        lines.push('An agent proposes reverting to Redis. CommitLore answers:');
        lines.push('');
        if (queryResult.records.length === 0) {
            lines.push('  (no active records found)');
        }
        else {
            for (const record of queryResult.records) {
                const id = record.recordId ?? 'unknown';
                const lifecycle = record.lifecycle;
                const limit = record.trailers.find((t) => t.key === 'Limit')?.value ?? '';
                const ruledOut = record.trailers.find((t) => t.key === 'Ruled-out')?.value ?? '';
                lines.push(`  Record-Id: ${id} [${lifecycle}]`);
                if (limit)
                    lines.push(`    Limit: ${limit}`);
                if (ruledOut)
                    lines.push(`    Ruled-out: ${ruledOut}`);
            }
        }
        lines.push('');
        lines.push(`Only the active decision (${expectedActiveRecordId}) is shown.`);
        lines.push('The superseded Redis decision is filtered out — the agent cannot revive it.');
        lines.push('');
        const output = lines.join('\n');
        return { exitCode: 0, output };
    }
    finally {
        cleanup();
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
    }
};
// ---------------------------------------------------------------------------
// CLI registration
// ---------------------------------------------------------------------------
export const register = (program) => {
    program
        .command('demo')
        .description('run a self-contained lifecycle demo in a temporary repository (no network, no model)')
        .action(async () => {
        const result = await runDemo();
        if (result.exitCode !== 0) {
            process.stderr.write(`${result.output}\n`);
        }
        else {
            process.stdout.write(result.output);
        }
        process.exitCode = result.exitCode;
    });
};
//# sourceMappingURL=demo.js.map