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

import type { Command } from 'commander';

import { DEFAULT_THRESHOLD, guard, type GuardMatch } from '../core/guard.js';

/** Exit status when at least one ruled-out alternative matched. */
export const FLAGGED_EXIT_CODE = 2;

const STDIN_FD = 0;

interface GuardCommandOptions {
  proposal: string;
  threshold?: string;
  json?: boolean;
  at?: string;
  /** Commander's negatable `--no-index`: `true` unless the flag was given. */
  index?: boolean;
  requireContent?: boolean;
  hookInput?: boolean;
}

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
const readProposal = (raw: string): string => {
  if (!raw.startsWith('@')) return raw;
  const path = raw.slice(1);
  if (path === '-') return readFileSync(STDIN_FD, 'utf8');
  return readFileSync(path, 'utf8');
};

const matchThreshold = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`--threshold is not a number between 0 and 1: ${raw}`);
  }
  return parsed;
};

/** Mirrors `commands/query.ts`: the default instant is resolved here, not deeper. */
const evaluationInstant = (raw: string | undefined): Date | undefined => {
  if (raw === undefined) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`--at is not a valid ISO 8601 instant: ${raw}`);
  }
  return parsed;
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface JsonGuardMatch {
  recordId: string | null;
  sha: string;
  alternative: string;
  reason: string;
  score: number;
  signals: string[];
}

export interface JsonGuardOutput {
  command: 'guard';
  at: string;
  paths: string[];
  threshold: number;
  /** The one field a hook needs to branch on. */
  matched: boolean;
  matches: JsonGuardMatch[];
}

export const toJson = (
  matches: readonly GuardMatch[],
  at: Date,
  paths: readonly string[],
  threshold: number,
): JsonGuardOutput => ({
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

const shortSha = (sha: string): string => (sha.length > 8 ? sha.slice(0, 8) : sha);

const NO_REASON = 'no reason recorded — this Ruled-out: is missing the required "|" separator';

/**
 * One block per match. The `because:` line is the whole point of the route, so
 * it sits directly under the alternative rather than in a details footer.
 */
export const formatMatches = (matches: readonly GuardMatch[]): string => {
  if (matches.length === 0) return '';

  const header =
    `commitlore guard: ${matches.length} ruled-out ` +
    `${matches.length === 1 ? 'alternative matches' : 'alternatives match'} this proposal`;

  const blocks = matches.map((match) =>
    [
      `  ruled out: ${match.alternative}`,
      `  because:   ${match.reason === '' ? NO_REASON : match.reason}`,
      `  recorded:  ${match.recordId ?? '-'} in ${shortSha(match.sha)} ` +
        `(score ${match.score.toFixed(2)}; ${match.signals.join(', ')})`,
    ].join('\n'),
  );

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
const scopeCaveat = (paths: readonly string[]): string =>
  paths.length > 1
    ? 'commitlore: renames are not followed for several paths; ' +
      'a record whose file was renamed may not be checked\n'
    : '';


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
const runAsHook = async (options: GuardCommandOptions): Promise<void> => {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;

  let payload: { tool_input?: { new_string?: unknown; file_path?: unknown } };
  try {
    payload = JSON.parse(raw || '{}') as typeof payload;
  } catch {
    return; // malformed payload: say nothing rather than guess
  }

  const proposal = payload.tool_input?.new_string;
  const filePath = payload.tool_input?.file_path;
  if (typeof proposal !== 'string' || proposal.trim() === '') return;

  const matches = guard({
    proposal,
    ...(typeof filePath === 'string' && filePath !== '' ? { paths: [filePath] } : {}),
    threshold: matchThreshold(options.threshold) ?? DEFAULT_THRESHOLD,
    at: evaluationInstant(options.at) ?? new Date(),
    noIndex: options.index === false,
    // A hook fires on compliance too, so the citation signal is off here for the
    // reason it exists: naming a record is what obeying one looks like.
    requireContent: true,
  });

  if (matches.length === 0) return;

  const lines = matches.map(
    (match) =>
      `- ${match.alternative} — ruled out: ${match.reason} [${match.recordId ?? match.sha.slice(0, 8)}]`,
  );
  const context = [
    'commitlore guard: this edit resembles an alternative already ruled out.',
    '',
    ...lines,
    '',
    'If the rejection no longer holds, say what changed. Not knowing is not a reason.',
  ].join('\n');

  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context },
    })}\n`,
  );
};

export const register = (program: Command): void => {
  program
    .command('guard')
    .description('flag a proposal that revives an alternative already ruled out')
    .argument('[paths...]', 'limit the check to records touching these paths')
    // Not `requiredOption`: under `--hook-input` the proposal arrives on stdin
    // as part of the payload, and commander rejects the invocation before the
    // action can say so. `inject` resolves `--path` the same way.
    .option(
      '--proposal <text>',
      'the proposal to check; @<file> reads a file, @- reads stdin (required outside --hook-input)',
    )
    .option('--threshold <n>', `match score required to flag (default: ${DEFAULT_THRESHOLD})`)
    .option('--json', 'emit the matches as JSON on stdout')
    .option('--at <instant>', 'evaluate as of an ISO 8601 instant (default: now)')
    .option(
      "--require-content",
      "do not flag on a Record-Id reference alone — for blocking hooks, where citing a record is what compliance looks like",
    )
    .option('--no-index', 'answer from git alone, without the SQLite index')
    .option(
      '--hook-input',
      'read a PreToolUse payload on stdin and answer as hook JSON, scoping the proposal to the edit',
    )
    .action(async (paths: string[], options: GuardCommandOptions) => {
      try {
        if (options.hookInput === true) {
          await runAsHook(options);
          return;
        }
        const threshold = matchThreshold(options.threshold) ?? DEFAULT_THRESHOLD;
        const at = evaluationInstant(options.at) ?? new Date();
        const matches = guard({
          proposal: readProposal(
            options.proposal ??
              (() => {
                throw new Error(
                  "--proposal is required (or --hook-input, to read it from a hook payload)",
                );
              })(),
          ),
          paths,
          threshold,
          at,
          noIndex: options.index === false,
      ...(options.requireContent === true ? { requireContent: true } : {}),
        });

        process.stderr.write(scopeCaveat(paths));
        if (options.json === true) {
          process.stdout.write(`${JSON.stringify(toJson(matches, at, paths, threshold), null, 2)}\n`);
        } else {
          process.stderr.write(formatMatches(matches));
        }

        if (matches.length > 0) process.exitCode = FLAGGED_EXIT_CODE;
      } catch (error) {
        process.stderr.write(
          `commitlore: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    });
};
