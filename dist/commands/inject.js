/**
 * `commitlore inject` (T-402): the push side of consumption (ADR-0006).
 *
 *   commitlore inject --path <p>            the projection, as text
 *   commitlore inject --path <p> --json     the projection, with its cache key
 *   commitlore inject --hook-input          read a PreToolUse payload on stdin
 *   commitlore inject install-claude-hook   wire it into a Claude settings.json
 *
 * The engine is `core/inject.ts` and every decision lives there; this file is
 * the impure shell — argument parsing, stdin, and the two output shapes.
 *
 * Exit status is 0 when a path has nothing to say, and the output is empty. A
 * hook that fired on a file with no records must cost the agent nothing, and a
 * non-zero exit would turn "nothing to know here" into a failed tool call on
 * most of a repository (SPEC §4: a commit that recorded nothing is not an
 * error). Exit 2 is reserved for the other thing an empty answer could mean —
 * a usage error, where the command never managed to ask the question at all
 * (SPEC §10).
 */
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execGit } from '../core/git.js';
import { buildInjection } from '../core/inject.js';
import { CONSUMER_SCAN_BUDGET_MS } from '../core/query.js';
import { configuredSignedDirectivesRequired, configuredTrustedSignerFingerprints, configuredTrustedAuthors, } from '../core/trusted-authors.js';
import { CLAUDE_HOOK_COMMAND, CLAUDE_HOOK_EVENT, claudeHookStatus, claudeSettingsPath, installClaudeHook, uninstallClaudeHook, } from '../hooks/claude-settings.js';
// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------
/**
 * Resolves `--at` at the command edge. The automatic route uses the final
 * millisecond of the current UTC day: a date-form `Expires:` is day-granular,
 * and this representative keeps two otherwise identical injections on that
 * day byte-identical (including their cache key) without hiding commits made
 * later that day. An explicit `--at` remains exact, so callers such as the
 * benchmark can pin a historical instant.
 */
const evaluationInstant = (raw) => {
    const parsed = raw === undefined ? new Date() : new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`--at is not a valid ISO 8601 instant: ${raw}`);
    }
    if (raw !== undefined)
        return parsed;
    return new Date(`${parsed.toISOString().slice(0, 10)}T23:59:59.999Z`);
};
const tokenBudget = (raw) => {
    if (raw === undefined)
        return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`--budget is not a non-negative integer: ${raw}`);
    }
    return parsed;
};
const collect = (value, previous) => [...previous, value];
/** Keys a path-taking tool uses, in the order they are consulted. */
const PATH_KEYS = ['file_path', 'notebook_path', 'path'];
const PATH_TOOLS = new Set([
    'Read',
    'Edit',
    'Write',
    'MultiEdit',
    'NotebookEdit',
]);
/** Payload paths that name the repository itself rather than something in it. */
const UNSCOPED_PAYLOAD_PATHS = new Set(['', '.', './']);
const MAX_PAYLOAD_PATH_LENGTH = 4096;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const readStdin = () => {
    try {
        return readFileSync(0, 'utf8');
    }
    catch {
        // No stdin at all is an empty payload, which is a hook with nothing to do.
        return '';
    }
};
const parsePayload = (raw) => {
    if (raw.trim() === '')
        throw new Error('unparseable JSON');
    try {
        const parsed = JSON.parse(raw);
        if (!isPlainObject(parsed)) {
            throw new Error('payload is not a JSON object');
        }
        return parsed;
    }
    catch (error) {
        if (error instanceof SyntaxError)
            throw new Error('unparseable JSON');
        throw error;
    }
};
const repositoryRoot = (cwd) => {
    const result = execGit(['rev-parse', '--show-toplevel'], { cwd });
    return result.code === 0 ? result.stdout.trim() : undefined;
};
/**
 * A path with every symlink in it resolved, whether or not it exists yet.
 *
 * Both halves matter. `git rev-parse --show-toplevel` reports the real path,
 * while the hook payload carries the path the agent typed — on macOS a
 * repository under `/var/folders/...` is reported as `/private/var/folders/...`,
 * and comparing the two without this says every file is outside its own
 * repository. And the path may not exist at all: `Write` fires the hook *before*
 * the file is created, so only the longest existing ancestor can be resolved.
 */
const canonical = (target) => {
    const absolute = resolve(target);
    const tail = [];
    let current = absolute;
    for (;;) {
        try {
            const real = realpathSync(current);
            return tail.length === 0 ? real : join(real, ...tail);
        }
        catch {
            const parent = dirname(current);
            if (parent === current)
                return absolute;
            tail.unshift(basename(current));
            current = parent;
        }
    }
};
/**
 * The repository-relative path the payload is about, if any.
 *
 * The hook is handed an absolute path and the query is repository-relative, so
 * a file outside the repository — another checkout, `/etc/hosts`, a temporary
 * file — resolves to nothing rather than to a path that would silently match
 * the wrong records.
 */
const payloadPath = (payload, cwd) => {
    const input = payload.tool_input;
    if (!isPlainObject(input)) {
        throw new Error('file_path is missing or null');
    }
    const raw = PATH_KEYS.map((key) => input[key]).find((value) => typeof value === 'string' && value.trim() !== '');
    if (raw === undefined)
        throw new Error('file_path is missing or null');
    if (/[\r\n]/u.test(raw))
        throw new Error('file_path contains a line break');
    if (raw.length > MAX_PAYLOAD_PATH_LENGTH)
        throw new Error('file_path is too long');
    // A tool call on the repository root is not a path to inject for, and
    // `buildInjection` rejects it. The hook answers with silence instead.
    if (UNSCOPED_PAYLOAD_PATHS.has(raw.trim())) {
        throw new Error('file_path resolves to the repository root');
    }
    const root = repositoryRoot(cwd);
    if (root === undefined)
        throw new Error('repository root could not be resolved');
    const target = canonical(isAbsolute(raw) ? raw : resolve(cwd, raw));
    const scoped = relative(canonical(root), target);
    if (scoped === '')
        throw new Error('file_path resolves to the repository root');
    if (scoped === '..' || scoped.startsWith(`..${sep}`) || isAbsolute(scoped)) {
        throw new Error('file_path resolves outside the repository');
    }
    return scoped;
};
/**
 * The one output shape Claude Code reads back as context. Emitted only when
 * there is something to say — an empty object would still be an object the
 * runner has to parse, and a hook that fires on every Read must be free when
 * it has nothing.
 */
const hookOutput = (text) => `${JSON.stringify({
    hookSpecificOutput: {
        hookEventName: CLAUDE_HOOK_EVENT,
        additionalContext: text,
    },
})}\n`;
// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------
const injectOptions = (path, options, cwd) => {
    const at = evaluationInstant(options.at);
    const budget = tokenBudget(options.budget);
    // #415: the installed hook passes no flag, so the config value written at
    // `init` is the only route to a `[directive]` in practice.
    //
    // The nullish check that used to stand here never fired. Commander declares
    // `--trusted-author` with a default of `[]`, so `options.trustedAuthor` is an
    // empty array rather than `undefined` when the flag is absent, `?? ` passes
    // it through, and every record graded `claim` on every install — exactly the
    // defect #415 was opened about, reintroduced one layer up by the fix for it.
    //
    // Length is the test that matches what the caller meant: an explicit flag is
    // always non-empty, and an absent flag is always empty, whichever of the two
    // shapes Commander hands over.
    const flagged = options.trustedAuthor ?? [];
    const trustedAuthors = flagged.length > 0 ? flagged : configuredTrustedAuthors(cwd);
    const requireSignedDirective = configuredSignedDirectivesRequired(cwd);
    const trustedSignerFingerprints = configuredTrustedSignerFingerprints(cwd);
    return {
        path,
        cwd,
        noIndex: options.index === false,
        at,
        ...(budget === undefined ? {} : { budget }),
        ...(trustedAuthors.length === 0 ? {} : { trustedAuthors }),
        ...(requireSignedDirective ? { requireSignedDirective: true } : {}),
        ...(trustedSignerFingerprints.length === 0 ? {} : { trustedSignerFingerprints }),
    };
};
const emitInjection = (injection, options) => {
    for (const diagnostic of injection.diagnostics)
        process.stderr.write(`commitlore: ${diagnostic}\n`);
    if (options.json === true) {
        const { diagnostics: _diagnostics, ...report } = injection;
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
    }
    if (injection.text !== '')
        process.stdout.write(injection.text);
};
export const hookResult = (raw, base) => {
    try {
        const payload = parsePayload(raw);
        const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : base.cwd;
        const path = payloadPath(payload, cwd);
        if (typeof payload.tool_name !== 'string' || !PATH_TOOLS.has(payload.tool_name)) {
            const tool = typeof payload.tool_name === 'string' ? JSON.stringify(payload.tool_name) : 'missing';
            throw new Error(`unexpected tool ${tool}`);
        }
        const injection = buildInjection({ ...base, cwd, path });
        return {
            stdout: injection.text === '' ? '' : hookOutput(injection.text),
            stderr: injection.diagnostics.map((diagnostic) => `commitlore: ${diagnostic}\n`).join(''),
            exitCode: 0,
        };
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
            stdout: '',
            stderr: `commitlore: injection hook: ${detail}; no context was injected\n`,
            exitCode: 0,
        };
    }
};
export const hookResponse = (raw, base) => hookResult(raw, base).stdout;
/**
 * Hook mode never fails, and that is deliberate.
 *
 * A `PreToolUse` hook that exits non-zero **blocks the tool call** and feeds
 * its stderr back to the agent. A misconfigured injection hook must not stop
 * somebody from reading a file, so every error here is reported on stderr —
 * where `claude --debug` shows it — and the exit stays 0. The cost of the
 * quieter failure is a hook that says nothing; the cost of the louder one is a
 * session that cannot open a file.
 */
/**
 * How long the hook may spend building a missing index, or scanning when it
 * cannot write one.
 *
 * Shared with `context` and the commit-msg hook (`CONSUMER_SCAN_BUDGET_MS`):
 * a 21k-commit repository used to cost four minutes on every cold firing
 * because the scan built nothing. The budget turns that into a pause and a
 * labelled partial answer; the index it did write makes the next firing
 * cheap. Exceeding it is never silent: the payload says how many commits
 * went unread and names `commitlore init`.
 */
const runHookMode = (options) => {
    try {
        // `path` is discarded: in hook mode it comes from the payload, not the flag.
        const { path: _fromFlag, ...base } = injectOptions('.', options, process.cwd());
        const result = hookResult(readStdin(), {
            ...base,
            cwd: process.cwd(),
            scanBudgetMs: CONSUMER_SCAN_BUDGET_MS,
        });
        if (result.stdout !== '')
            process.stdout.write(result.stdout);
        if (result.stderr !== '')
            process.stderr.write(result.stderr);
    }
    catch (error) {
        process.stderr.write(`commitlore: injection hook did nothing: ${error instanceof Error ? error.message : String(error)}\n`);
    }
};
const emitResult = (result) => {
    if (result.stdout !== '')
        process.stdout.write(result.stdout);
    if (result.stderr !== '')
        process.stderr.write(result.stderr);
    if (result.code !== 0)
        process.exitCode = result.code;
};
/**
 * Exit status for a usage error: a missing `--path`, an unparseable `--at` or
 * `--budget`, an unscoped path. Distinct from 0 (answered, possibly with
 * nothing to say) so a caller can tell "this path has no records" from "this
 * command was never able to ask" — the distinction `commitlore inject` exists
 * to keep. Hook mode never returns it; see `runHookMode`.
 */
const USAGE_EXIT = 2;
const fail = (error) => {
    process.stderr.write(`commitlore: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = USAGE_EXIT;
};
const settingsFile = (options) => options.settings ?? claudeSettingsPath(process.cwd());
const hookInput = (options) => ({
    settingsPath: settingsFile(options),
    ...(options.command === undefined ? {} : { command: options.command }),
});
// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
export const register = (program) => {
    const inject = program
        .command('inject')
        .description('the deterministic, path-scoped projection an agent is given before it edits')
        .option('--path <path>', 'the path to project (required outside --hook-input)')
        .option('--budget <tokens>', 'token budget for the payload (default: 800)')
        .option('--json', 'emit the projection object, including its cache key')
        .option('--at <instant>', 'evaluate as of an ISO 8601 instant (default: current UTC day)')
        .option('--trusted-author <author>', 'an author string whose records may render as instructions (repeatable; not identity proof)', collect, [])
        .option('--no-index', 'answer from git alone, without the SQLite index')
        .option('--hook-input', `read a ${CLAUDE_HOOK_EVENT} payload on stdin and answer as hook JSON`)
        .addHelpText('after', '\nExit codes: 0 ran (empty output means the path has nothing to say, and --hook-input never fails), ' +
        '2 a usage error -- --path is missing (SPEC §10).')
        .action((options) => {
        if (options.hookInput === true) {
            runHookMode(options);
            return;
        }
        try {
            if (options.path === undefined) {
                throw new Error('--path is required (or --hook-input, to read the path from a hook payload)');
            }
            emitInjection(buildInjection(injectOptions(options.path, options, process.cwd())), options);
        }
        catch (error) {
            fail(error);
        }
    });
    inject
        .command('install-claude-hook')
        .description(`add the ${CLAUDE_HOOK_EVENT} injection hook to a Claude Code settings.json`)
        .option('--settings <path>', 'the settings file to edit (default: .claude/settings.json)')
        .option('--command <command>', `the command to install (default: ${CLAUDE_HOOK_COMMAND})`)
        .addHelpText('after', '\nExit codes: 0 installed, 2 the settings file could not be read or written (SPEC §10).')
        .action((options) => {
        emitResult(installClaudeHook(hookInput(options)));
    });
    inject
        .command('uninstall-claude-hook')
        .description('remove the injection hook, leaving every other setting untouched')
        .option('--settings <path>', 'the settings file to edit (default: .claude/settings.json)')
        .addHelpText('after', '\nExit codes: 0 removed (or nothing to remove), 2 the settings file could not be read or written (SPEC §10).')
        .action((options) => {
        emitResult(uninstallClaudeHook(hookInput(options)));
    });
    inject
        .command('claude-hook-status')
        .description('report whether the injection hook is installed')
        .option('--settings <path>', 'the settings file to read (default: .claude/settings.json)')
        .addHelpText('after', '\nExit codes: 0 reported, 2 the settings file could not be read (SPEC §10).')
        .action((options) => {
        emitResult(claudeHookStatus(hookInput(options)));
    });
};
//# sourceMappingURL=inject.js.map