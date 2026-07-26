/**
 * `commitlore guard` — the command shell around `core/guard.ts`.
 *
 *   commitlore guard --proposal <text|@file|@-> [paths...] [--threshold n] [--json]
 *
 * Three conventions here are load-bearing, because this command is designed to
 * run from a PreToolUse hook on every edit an agent proposes (ADR-0006 §4):
 *
 * **Exit 2 means "flagged".** 0 is a clean proposal, 1 is a broken invocation,
 * 2 is the warning. Three states, because a hook that cannot distinguish "this
 * proposal revives a rejected approach" from "the path you gave does not exist"
 * will eventually treat both as noise. It is also the Claude Code hook
 * convention: exit 2 is the code whose stderr is fed back to the agent.
 *
 * **Nothing is printed when nothing matches.** Not a summary, not a count. A
 * command that prints on every edit is a command that gets removed from the
 * hook list within a day.
 *
 * **The warning goes to stderr, the JSON to stdout.** stderr is what the hook
 * protocol routes back to the agent, and it keeps `--json` a clean pipe.
 *
 * The warning always carries the rejection *reason*. "This was ruled out" alone
 * sends the agent back through the same reasoning to the same conclusion; the
 * reason is the part that changes the next proposal.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_THRESHOLD, guard } from '../core/guard.js';
/** Exit status when at least one ruled-out alternative matched. */
export const FLAGGED_EXIT_CODE = 2;
const STDIN_FD = 0;
// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------
/**
 * `@<path>` reads a file, `@-` reads stdin, anything else is the text itself.
 *
 * A hook passes a whole edit — often larger than an argv limit — so a file and
 * a pipe are both needed. A literal proposal that must start with `@` can be
 * passed through `@-`.
 */
const readProposal = (raw) => {
    if (!raw.startsWith('@'))
        return raw;
    const path = raw.slice(1);
    if (path === '-')
        return readFileSync(STDIN_FD, 'utf8');
    return readFileSync(path, 'utf8');
};
const matchThreshold = (raw) => {
    if (raw === undefined)
        return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        throw new Error(`--threshold is not a number between 0 and 1: ${raw}`);
    }
    return parsed;
};
/** Mirrors `commands/query.ts`: the default instant is resolved here, not deeper. */
const evaluationInstant = (raw) => {
    if (raw === undefined)
        return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`--at is not a valid ISO 8601 instant: ${raw}`);
    }
    return parsed;
};
export const toJson = (matches, at, paths, threshold) => ({
    command: 'guard',
    at: at.toISOString(),
    paths: [...paths],
    threshold,
    matched: matches.length > 0,
    matches: matches.map((match) => ({
        recordId: match.recordId ?? null,
        sha: match.sha,
        alternative: match.alternative,
        reason: match.reason,
        score: match.score,
        signals: match.signals,
    })),
});
const shortSha = (sha) => (sha.length > 8 ? sha.slice(0, 8) : sha);
const NO_REASON = 'no reason recorded — this Ruled-out: is missing the required "|" separator';
/**
 * One block per match. The `because:` line is the whole point of the route, so
 * it sits directly under the alternative rather than in a details footer.
 */
export const formatMatches = (matches) => {
    if (matches.length === 0)
        return '';
    const header = `commitlore guard: ${matches.length} ruled-out ` +
        `${matches.length === 1 ? 'alternative matches' : 'alternatives match'} this proposal`;
    const blocks = matches.map((match) => [
        `  ruled out: ${match.alternative}`,
        `  because:   ${match.reason === '' ? NO_REASON : match.reason}`,
        `  recorded:  ${match.recordId ?? '-'} in ${shortSha(match.sha)} ` +
            `(score ${match.score.toFixed(2)}; ${match.signals.join(', ')})`,
    ].join('\n'));
    return `${[header, ...blocks].join('\n\n')}\n`;
};
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
/**
 * `core/query.ts` cannot follow renames for more than one pathspec, and an
 * unflagged proposal is exactly what that limitation looks like from outside.
 * The command knows how many paths it was given, so it says so itself rather
 * than plumbing the query's diagnostics through a `GuardMatch[]` return.
 */
const scopeCaveat = (paths) => paths.length > 1
    ? 'commitlore: renames are not followed for several paths; ' +
        'a record whose file was renamed may not be checked\n'
    : '';
export const register = (program) => {
    program
        .command('guard')
        .description('flag a proposal that revives an alternative already ruled out')
        .argument('[paths...]', 'limit the check to records touching these paths')
        .requiredOption('--proposal <text>', 'the proposal to check; @<file> reads a file, @- reads stdin')
        .option('--threshold <n>', `match score required to flag (default: ${DEFAULT_THRESHOLD})`)
        .option('--json', 'emit the matches as JSON on stdout')
        .option('--at <instant>', 'evaluate as of an ISO 8601 instant (default: now)')
        .option("--require-content", "do not flag on a Record-Id reference alone — for blocking hooks, where citing a record is what compliance looks like")
        .option('--no-index', 'answer from git alone, without the SQLite index')
        .action((paths, options) => {
        try {
            const threshold = matchThreshold(options.threshold) ?? DEFAULT_THRESHOLD;
            const at = evaluationInstant(options.at) ?? new Date();
            const matches = guard({
                proposal: readProposal(options.proposal),
                paths,
                threshold,
                at,
                noIndex: options.index === false,
                ...(options.requireContent === true ? { requireContent: true } : {}),
            });
            process.stderr.write(scopeCaveat(paths));
            if (options.json === true) {
                process.stdout.write(`${JSON.stringify(toJson(matches, at, paths, threshold), null, 2)}\n`);
            }
            else {
                process.stderr.write(formatMatches(matches));
            }
            if (matches.length > 0)
                process.exitCode = FLAGGED_EXIT_CODE;
        }
        catch (error) {
            process.stderr.write(`commitlore: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        }
    });
};
//# sourceMappingURL=guard.js.map