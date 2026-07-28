/**
 * `commitlore index` — build or refresh the derived SQLite index (T-203).
 *
 * The index holds nothing git does not already hold (ADR-0003), so this
 * command never reports a broken index as a failure: an unreadable file, a
 * schema version from another release, or a rewritten history all become a
 * rebuild, announced on stderr and named in `rebuildReason`.
 *
 * `--no-index` runs the same read through `scanTrailers`, writing nothing. It
 * exists so the fallback path can be exercised — and compared — on a real
 * repository rather than only in tests.
 */
import { closeIndex, ensureIndex, indexInfo, openIndex, rebuildIndex, scanTrailers, } from '../core/index-db.js';
/** Every failure here is a usage error or a missing dependency, never a finding (SPEC §10). */
const fail = (message) => {
    process.stderr.write(`commitlore: ${message}\n`);
    process.exitCode = 2;
};
const plural = (count, unit) => `${count} ${unit}${count === 1 ? '' : 's'}`;
const runScan = (options) => {
    const started = Date.now();
    const trailers = scanTrailers();
    const elapsedMs = Date.now() - started;
    const commits = new Set(trailers.map((trailer) => trailer.sha)).size;
    if (options.json ?? false) {
        process.stdout.write(`${JSON.stringify({ mode: 'no-index', commits, trailers: trailers.length, elapsedMs }, null, 2)}\n`);
        return;
    }
    process.stdout.write(`no-index scan: ${plural(trailers.length, 'trailer')} across ${plural(commits, 'commit')} ` +
        `in ${elapsedMs}ms (nothing written)\n`);
};
const reportRebuild = (stats) => {
    if (!stats.rebuilt || stats.rebuildReason === null)
        return;
    process.stderr.write(`commitlore: rebuilt the index — ${stats.rebuildReason}\n`);
};
const runIndex = (options) => {
    const rebuild = options.rebuild ?? false;
    const { handle, stats } = rebuild
        ? (() => {
            const opened = openIndex();
            return { handle: opened, stats: rebuildIndex(opened, { reason: 'rebuild requested' }) };
        })()
        : ensureIndex();
    try {
        if (!rebuild)
            reportRebuild(stats);
        if (options.json ?? false) {
            process.stdout.write(`${JSON.stringify({ ...stats, index: indexInfo(handle) }, null, 2)}\n`);
            return;
        }
        if (options.stats ?? false) {
            const info = indexInfo(handle);
            const lines = [
                `index      ${info.path}`,
                `schema     v${info.schemaVersion ?? '?'}`,
                `fts5       ${info.fts ? 'yes (trigram)' : 'no — substring search falls back to LIKE'}`,
                `head       ${info.lastIndexedSha ?? '(none)'}`,
                `notes ref  ${info.notesRefSha ?? '(none)'}`,
                `holds      ${plural(info.trailers, 'trailer')}, ${plural(info.commits, 'commit')}, ${plural(info.paths, 'path')}`,
                `last run   ${stats.rebuilt ? 'rebuild' : 'incremental'} · scanned ${plural(stats.commitsScanned, 'commit')} · ` +
                    `+${stats.trailersIndexed} trailers · +${stats.noteTrailersIndexed} from notes · ${stats.elapsedMs}ms`,
            ];
            process.stdout.write(`${lines.join('\n')}\n`);
            return;
        }
        process.stdout.write(`${stats.rebuilt ? 'rebuilt' : 'updated'}: scanned ${plural(stats.commitsScanned, 'commit')}, ` +
            `indexed ${plural(stats.trailersIndexed + stats.noteTrailersIndexed, 'trailer')} ` +
            `in ${stats.elapsedMs}ms\n`);
    }
    finally {
        closeIndex(handle);
    }
};
export const register = (program) => {
    program
        .command('index')
        .description('build or refresh the derived record index (.git/commitlore/index.db)')
        .option('--rebuild', 'discard the index and rebuild it from git')
        .option('--no-index', 'answer from git alone, writing nothing (the fallback path)')
        .option('--json', 'emit the run as JSON')
        .option('--stats', 'report what the index currently holds')
        .addHelpText('after', '\nExit codes: 0 built or refreshed, 2 could not run -- conflicting flags, or better-sqlite3 is not ' +
        'installed (SPEC §10).')
        .action((options) => {
        try {
            if (!options.index) {
                if (options.rebuild ?? false) {
                    fail('--rebuild and --no-index ask for opposite things');
                    return;
                }
                runScan(options);
                return;
            }
            runIndex(options);
        }
        catch (error) {
            fail(error instanceof Error ? error.message : String(error));
        }
    });
};
//# sourceMappingURL=index-cmd.js.map