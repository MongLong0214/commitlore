/**
 * `commitlore guard` — the command shell around `core/guard.ts`.
 *
 *   commitlore guard --proposal <text|@file|@-> [paths...] [--threshold n] [--json]
 *
 * Three conventions here are load-bearing, because this command is designed to
 * run from a PreToolUse hook on every edit an agent proposes (ADR-0006 §4):
 *
 * **Exit 1 means "flagged".** 0 is a complete clean check, 1 is a warning, 2
 * is a broken invocation, and 3 means the check was incomplete (SPEC §10).
 * Distinct states keep an unavailable repository from being mistaken for
 * approval.
 *
 * **Nothing is printed when a complete check finds nothing.** Incomplete checks
 * must speak because silence is otherwise indistinguishable from approval.
 *
 * **The warning goes to stderr, the JSON to stdout.** stderr is what the hook
 * protocol routes back to the agent, and it keeps `--json` a clean pipe.
 *
 * A safe warning carries the rejection *reason*. Blocked records are the
 * exception because their content is the attack, not useful decision context.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_THRESHOLD, guard, renderGuardMatch, } from '../core/guard.js';
import { SHALLOW_HISTORY_CAVEAT } from '../core/git.js';
import { configuredSignedDirectivesRequired, configuredTrustedAuthors, } from '../core/trusted-authors.js';
/** Exit status when at least one ruled-out alternative matched (SPEC §10: a finding). */
export const FLAGGED_EXIT_CODE = 1;
/** Usage error: a broken invocation, not a finding (SPEC §10). */
export const USAGE_EXIT_CODE = 2;
export const INCOMPLETE_EXIT_CODE = 3;
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
export const toJson = (result, at, paths, threshold) => ({
    command: 'guard',
    at: at.toISOString(),
    paths: [...paths],
    threshold,
    matched: result.matches.length > 0,
    history: result.history,
    notes: result.notes,
    incomplete: result.incomplete,
    matches: result.matches.map(renderGuardMatch),
});
const shortSha = (sha) => (sha.length > 8 ? sha.slice(0, 8) : sha);
const NO_REASON = 'no reason recorded — this Ruled-out: is missing the required "|" separator';
/**
 * Issue #372. stderr is what the hook protocol routes back to the agent, so
 * this block is the whole of what the agent learns about a match. An
 * alternative cut short by a second `|` reads there exactly like a whole one,
 * and nothing tells the agent that the sentence it is being held to is half a
 * sentence. Emitted only when the value is ambiguous, so a well-formed
 * record's block keeps its three lines.
 */
const AMBIGUOUS_SEPARATOR = 'the Ruled-out: value holds more than one "|" and only the first separates, ' +
    'so this alternative may be a fragment (SPEC §3.1)';
const caveatLines = (signals) => signals.includes('malformed:ambiguous-separator')
    ? [`  caveat:    ${AMBIGUOUS_SEPARATOR}`]
    : [];
/**
 * One block per match. The `because:` line is the whole point of the route, so
 * it sits directly under the alternative rather than in a details footer.
 */
export const formatMatches = (matches) => {
    if (matches.length === 0)
        return '';
    const header = `commitlore guard: ${matches.length} possible ` +
        `${matches.length === 1 ? 'match' : 'matches'} against ruled-out alternatives ` +
        `(experimental — precision 44.8%, recall 22.0%)`;
    const blocks = matches.map((match) => {
        const rendered = renderGuardMatch(match);
        const recorded = `  recorded:  ${rendered.recordId ?? '-'} in ` +
            `${rendered.trust === 'blocked' ? rendered.sha : shortSha(rendered.sha)}`;
        switch (rendered.trust) {
            case 'blocked':
                return [`  withheld: ${rendered.withheld}`, recorded].join('\n');
            case 'claim':
            case 'directive':
                return [
                    `  ruled out: ${rendered.alternative}`,
                    `  because:   ${rendered.reason === '' ? NO_REASON : rendered.reason}`,
                    ...caveatLines(rendered.signals),
                    recorded,
                ].join('\n');
        }
    });
    return `${[header, ...blocks].join('\n\n')}\n`;
};
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
/**
 * `core/query.ts` cannot follow renames for more than one pathspec, and an
 * unflagged proposal is exactly what that limitation looks like from outside.
 * The command knows how many paths it was given, so it says so itself rather
 * than making the core matcher interpret command-line scope.
 */
const scopeCaveat = (paths) => paths.length > 1
    ? 'commitlore: renames are not followed for several paths; ' +
        'a record whose file was renamed may not be checked\n'
    : '';
const incompleteMessage = (result) => {
    const reasons = [
        ...(result.history === 'unavailable' ? ['git history is unavailable'] : []),
        ...(result.notes === 'unfetched' ? ['the notes mirror has not been fetched'] : []),
    ];
    return `commitlore guard: could not complete the check: ${reasons.join('; ')}`;
};
const shallowMessage = () => `commitlore guard: ${SHALLOW_HISTORY_CAVEAT} (fix: git fetch --unshallow)`;
const blockedIdentity = (match) => `recordId=${match.recordId ?? '-'}; sha=${match.sha}; score=${match.score.toFixed(2)}; ` +
    `signals=${match.signals.join(', ')}`;
export const formatHookContext = (result) => {
    const context = [];
    if (result.matches.length > 0) {
        const rendered = result.matches.map(renderGuardMatch);
        const lines = rendered.map((match) => {
            switch (match.trust) {
                case 'blocked':
                    return `- ${match.withheld} [${blockedIdentity(match)}]`;
                case 'claim':
                    return (`- A record claims this was ruled out: ${match.alternative} — ` +
                        `reported reason: ${match.reason} [${match.recordId ?? match.sha.slice(0, 8)}]`);
                case 'directive':
                    return (`- ${match.alternative} — ruled out: ${match.reason} ` +
                        `[${match.recordId ?? match.sha.slice(0, 8)}]`);
            }
        });
        context.push('commitlore guard: this edit resembles an alternative already ruled out.', '', ...lines);
        if (rendered.some((match) => match.trust === 'directive')) {
            context.push('', 'If the rejection no longer holds, say what changed. Not knowing is not a reason.');
        }
    }
    if (result.incomplete) {
        if (context.length > 0)
            context.push('');
        context.push(incompleteMessage(result).replace('the check', 'the check on this edit'));
    }
    if (result.shallow) {
        if (context.length > 0)
            context.push('');
        context.push(shallowMessage().replace('commitlore guard: ', ''));
    }
    return context.join('\n');
};
/**
 * PreToolUse: flag a proposal that revives a ruled-out alternative, at the
 * moment the agent proposes it.
 *
 * **The proposal is the edit, not the file.** `GUARD-CANNOT-BLOCK.md` measured
 * both: matching prose produced nine false alarms in twenty-five against five on
 * diffs, and every one of the prose failures was an agent *citing* the record it
 * was obeying. `new_string` is the closest thing a PreToolUse payload has to a
 * diff — it is what the agent is about to add, and nothing it is merely
 * discussing.
 *
 * Advisory, never blocking. The same measurement showed true and false positives
 * occupying one score band, so the only precision-safe threshold catches one in
 * five. This surfaces what it found and lets the edit through; a hook that
 * blocked one compliant edit in five would be removed within a day.
 */
const runAsHook = async (options) => {
    let raw = '';
    for await (const chunk of process.stdin)
        raw += chunk;
    let payload;
    try {
        payload = JSON.parse(raw || '{}');
    }
    catch {
        return; // malformed payload: say nothing rather than guess
    }
    const proposal = payload.tool_input?.new_string;
    const filePath = payload.tool_input?.file_path;
    if (typeof proposal !== 'string' || proposal.trim() === '')
        return;
    const result = guard({
        proposal,
        ...(typeof filePath === 'string' && filePath !== '' ? { paths: [filePath] } : {}),
        threshold: matchThreshold(options.threshold) ?? DEFAULT_THRESHOLD,
        at: evaluationInstant(options.at) ?? new Date(),
        noIndex: options.index === false,
        trustedAuthors: configuredTrustedAuthors(process.cwd()),
        ...(configuredSignedDirectivesRequired(process.cwd())
            ? { requireSignedDirective: true }
            : {}),
        // A hook fires on compliance too, so the citation signal is off here for the
        // reason it exists: naming a record is what obeying one looks like.
        requireContent: true,
    });
    const context = formatHookContext(result);
    if (context === '')
        return;
    process.stdout.write(`${JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context },
    })}\n`);
};
export const register = (program) => {
    program
        .command('guard')
        .description('[experimental advisory] flag a proposal that may revive a ruled-out alternative — a lead to inspect, not evidence the proposal is wrong (precision 44.8%, recall 22.0%)')
        .argument('[paths...]', 'limit the check to records touching these paths')
        // Not `requiredOption`: under `--hook-input` the proposal arrives on stdin
        // as part of the payload, and commander rejects the invocation before the
        // action can say so. `inject` resolves `--path` the same way.
        .option('--proposal <text>', 'the proposal to check; @<file> reads a file, @- reads stdin (required outside --hook-input)')
        .option('--threshold <n>', `match score required to flag (default: ${DEFAULT_THRESHOLD})`)
        .option('--json', 'emit the matches as JSON on stdout')
        .option('--at <instant>', 'evaluate as of an ISO 8601 instant (default: now)')
        .option("--require-content", "do not flag on a Record-Id reference alone — for blocking hooks, where citing a record is what compliance looks like")
        .option('--no-index', 'answer from git alone, without the SQLite index')
        .option('--hook-input', 'read a PreToolUse payload on stdin and answer as hook JSON, scoping the proposal to the edit')
        .addHelpText('after', '\nExit codes: 0 clean, 1 a ruled-out alternative matched, 2 usage error, 3 the check was incomplete (SPEC §10).')
        .action(async (paths, options) => {
        try {
            if (options.hookInput === true) {
                await runAsHook(options);
                return;
            }
            const threshold = matchThreshold(options.threshold) ?? DEFAULT_THRESHOLD;
            const at = evaluationInstant(options.at) ?? new Date();
            const result = guard({
                proposal: readProposal(options.proposal ??
                    (() => {
                        throw new Error("--proposal is required (or --hook-input, to read it from a hook payload)");
                    })()),
                paths,
                threshold,
                at,
                noIndex: options.index === false,
                trustedAuthors: configuredTrustedAuthors(process.cwd()),
                ...(configuredSignedDirectivesRequired(process.cwd())
                    ? { requireSignedDirective: true }
                    : {}),
                ...(options.requireContent === true ? { requireContent: true } : {}),
            });
            process.stderr.write(scopeCaveat(paths));
            if (result.incomplete)
                process.stderr.write(`${incompleteMessage(result)}\n`);
            if (result.shallow)
                process.stderr.write(`${shallowMessage()}\n`);
            if (options.json === true) {
                process.stdout.write(`${JSON.stringify(toJson(result, at, paths, threshold), null, 2)}\n`);
            }
            else {
                process.stderr.write(formatMatches(result.matches));
            }
            if (result.matches.length > 0)
                process.exitCode = FLAGGED_EXIT_CODE;
            else if (result.incomplete)
                process.exitCode = INCOMPLETE_EXIT_CODE;
        }
        catch (error) {
            process.stderr.write(`commitlore: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = USAGE_EXIT_CODE;
        }
    });
};
//# sourceMappingURL=guard.js.map