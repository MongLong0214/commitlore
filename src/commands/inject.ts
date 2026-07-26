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
 * a usage error, where the command never managed to ask the question at all.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type { Command } from 'commander';

import { execGit } from '../core/git.js';
import { buildInjection, type InjectOptions, type Injection } from '../core/inject.js';
import {
  CLAUDE_HOOK_COMMAND,
  CLAUDE_HOOK_EVENT,
  claudeHookStatus,
  claudeSettingsPath,
  installClaudeHook,
  uninstallClaudeHook,
  type ClaudeHookResult,
} from '../hooks/claude-settings.js';

interface InjectCommandOptions {
  path?: string;
  budget?: string;
  json?: boolean;
  at?: string;
  trustedAuthor?: string[];
  hookInput?: boolean;
  /** Commander's negatable `--no-index`: `true` unless the flag was given. */
  index?: boolean;
}

interface SettingsCommandOptions {
  settings?: string;
  command?: string;
}

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------

/**
 * Resolves `--at`. Unlike the query commands, an absent `--at` is *not*
 * replaced with now: the engine defaults it to HEAD's commit instant so that
 * the cache key it returns means what it says (see `core/inject.ts`).
 */
const evaluationInstant = (raw: string | undefined): Date | undefined => {
  if (raw === undefined) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`--at is not a valid ISO 8601 instant: ${raw}`);
  }
  return parsed;
};

const tokenBudget = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--budget is not a non-negative integer: ${raw}`);
  }
  return parsed;
};

const collect = (value: string, previous: string[]): string[] => [...previous, value];

// ---------------------------------------------------------------------------
// The PreToolUse payload
// ---------------------------------------------------------------------------

/** The fields of the hook payload this command reads. Everything else is ignored. */
interface HookPayload {
  cwd?: unknown;
  tool_input?: { [key: string]: unknown };
}

/** Keys a path-taking tool uses, in the order they are consulted. */
const PATH_KEYS = ['file_path', 'notebook_path', 'path'] as const;

/** Payload paths that name the repository itself rather than something in it. */
const UNSCOPED_PAYLOAD_PATHS: ReadonlySet<string> = new Set(['', '.', './']);

const readStdin = (): string => {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    // No stdin at all is an empty payload, which is a hook with nothing to do.
    return '';
  }
};

const parsePayload = (raw: string): HookPayload | undefined => {
  if (raw.trim() === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as HookPayload;
  } catch {
    // A payload this build cannot read is not a reason to fail the tool call.
    return undefined;
  }
};

const repositoryRoot = (cwd: string): string | undefined => {
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
const canonical = (target: string): string => {
  const absolute = resolve(target);
  const tail: string[] = [];
  let current = absolute;

  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const parent = dirname(current);
      if (parent === current) return absolute;
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
const payloadPath = (payload: HookPayload, cwd: string): string | undefined => {
  const input = payload.tool_input;
  if (typeof input !== 'object' || input === null) return undefined;

  const raw = PATH_KEYS.map((key) => input[key]).find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  if (raw === undefined) return undefined;

  // A tool call on the repository root is not a path to inject for, and
  // `buildInjection` rejects it. The hook answers with silence instead.
  if (UNSCOPED_PAYLOAD_PATHS.has(raw.trim())) return undefined;
  if (!isAbsolute(raw)) return raw;

  const root = repositoryRoot(cwd);
  if (root === undefined) return undefined;

  const scoped = relative(canonical(root), canonical(raw));
  if (scoped === '' || scoped.startsWith('..') || isAbsolute(scoped)) return undefined;
  return scoped;
};

/**
 * The one output shape Claude Code reads back as context. Emitted only when
 * there is something to say — an empty object would still be an object the
 * runner has to parse, and a hook that fires on every Read must be free when
 * it has nothing.
 */
const hookOutput = (text: string): string =>
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: CLAUDE_HOOK_EVENT,
      additionalContext: text,
    },
  })}\n`;

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

const injectOptions = (
  path: string,
  options: InjectCommandOptions,
  cwd: string,
): InjectOptions => {
  const at = evaluationInstant(options.at);
  const budget = tokenBudget(options.budget);
  const trustedAuthors = options.trustedAuthor ?? [];
  return {
    path,
    cwd,
    noIndex: options.index === false,
    ...(at === undefined ? {} : { at }),
    ...(budget === undefined ? {} : { budget }),
    ...(trustedAuthors.length === 0 ? {} : { trustedAuthors }),
  };
};

const emitInjection = (injection: Injection, options: InjectCommandOptions): void => {
  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(injection, null, 2)}\n`);
    return;
  }
  if (injection.text !== '') process.stdout.write(injection.text);
};

/**
 * The whole hook path except reading stdin, so it can be exercised with a
 * payload rather than with a file descriptor. Returns `''` when there is
 * nothing to say — an unreadable payload, a tool with no path, a path outside
 * the repository, or a path with no records.
 */
export const hookResponse = (
  raw: string,
  base: Omit<InjectOptions, 'path'> & { cwd: string },
): string => {
  const payload = parsePayload(raw);
  if (payload === undefined) return '';

  const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : base.cwd;
  const path = payloadPath(payload, cwd);
  if (path === undefined) return '';

  const injection = buildInjection({ ...base, cwd, path });
  return injection.text === '' ? '' : hookOutput(injection.text);
};

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
const runHookMode = (options: InjectCommandOptions): void => {
  try {
    // `path` is discarded: in hook mode it comes from the payload, not the flag.
    const { path: _fromFlag, ...base } = injectOptions('.', options, process.cwd());
    const response = hookResponse(readStdin(), { ...base, cwd: process.cwd() });
    if (response !== '') process.stdout.write(response);
  } catch (error) {
    process.stderr.write(
      `commitlore: injection hook did nothing: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
};

const emitResult = (result: ClaudeHookResult): void => {
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);
  if (result.code !== 0) process.exitCode = result.code;
};

/**
 * Exit status for a usage error: a missing `--path`, an unparseable `--at` or
 * `--budget`, an unscoped path. Distinct from 0 (answered, possibly with
 * nothing to say) so a caller can tell "this path has no records" from "this
 * command was never able to ask" — the distinction `commitlore inject` exists
 * to keep. Hook mode never returns it; see `runHookMode`.
 */
const USAGE_EXIT = 2;

const fail = (error: unknown): void => {
  process.stderr.write(`commitlore: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = USAGE_EXIT;
};

const settingsFile = (options: SettingsCommandOptions): string =>
  options.settings ?? claudeSettingsPath(process.cwd());

const hookInput = (options: SettingsCommandOptions): { settingsPath: string; command?: string } => ({
  settingsPath: settingsFile(options),
  ...(options.command === undefined ? {} : { command: options.command }),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const register = (program: Command): void => {
  const inject = program
    .command('inject')
    .description('the deterministic, path-scoped projection an agent is given before it edits')
    .option('--path <path>', 'the path to project (required outside --hook-input)')
    .option('--budget <tokens>', 'token budget for the payload (default: 800)')
    .option('--json', 'emit the projection object, including its cache key')
    .option('--at <instant>', 'evaluate as of an ISO 8601 instant (default: HEAD commit instant)')
    .option(
      '--trusted-author <author>',
      'an author whose records may render as instructions (repeatable)',
      collect,
      [],
    )
    .option('--no-index', 'answer from git alone, without the SQLite index')
    .option('--hook-input', `read a ${CLAUDE_HOOK_EVENT} payload on stdin and answer as hook JSON`)
    .action((options: InjectCommandOptions) => {
      if (options.hookInput === true) {
        runHookMode(options);
        return;
      }
      try {
        if (options.path === undefined) {
          throw new Error('--path is required (or --hook-input, to read the path from a hook payload)');
        }
        emitInjection(buildInjection(injectOptions(options.path, options, process.cwd())), options);
      } catch (error) {
        fail(error);
      }
    });

  inject
    .command('install-claude-hook')
    .description(`add the ${CLAUDE_HOOK_EVENT} injection hook to a Claude Code settings.json`)
    .option('--settings <path>', 'the settings file to edit (default: .claude/settings.json)')
    .option('--command <command>', `the command to install (default: ${CLAUDE_HOOK_COMMAND})`)
    .action((options: SettingsCommandOptions) => {
      emitResult(installClaudeHook(hookInput(options)));
    });

  inject
    .command('uninstall-claude-hook')
    .description('remove the injection hook, leaving every other setting untouched')
    .option('--settings <path>', 'the settings file to edit (default: .claude/settings.json)')
    .action((options: SettingsCommandOptions) => {
      emitResult(uninstallClaudeHook(hookInput(options)));
    });

  inject
    .command('claude-hook-status')
    .description('report whether the injection hook is installed')
    .option('--settings <path>', 'the settings file to read (default: .claude/settings.json)')
    .action((options: SettingsCommandOptions) => {
      emitResult(claudeHookStatus(hookInput(options)));
    });
};
