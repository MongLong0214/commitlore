/**
 * A record of this MCP server's own life, so a disconnect leaves evidence
 * (#424).
 *
 * A session lost all seven commitlore tools mid-conversation after four of them
 * had returned real data. From inside that session the failure was invisible:
 * `ToolSearch` answers "no matching tools" for a capability that was withdrawn
 * exactly as it does for one that never existed, so an agent cannot tell a
 * regression from a repository that simply lacks the feature. `claude mcp list`
 * reported the server connected while no process was running at all, so it
 * cannot be used to check either. And the client was not started with
 * `--debug`, so the server's stderr went to a pipe and nothing reached disk.
 *
 * **This does not fix that, and must not be described as fixing it.** The
 * registration lives in the client. What is reachable from here is the other
 * half of the problem: that nobody could say afterwards whether the server had
 * even been running. Two lines on disk answer it —
 *
 *     started 16:14:02  pid 49700  0.4.0  /…/cache/commitlore/commitlore/0.4.0
 *     exited  16:16:31  pid 49700  clean
 *
 * — and their absence is itself the answer, because a start with no exit beside
 * it is a server that was killed rather than one that closed its session.
 *
 * Three properties this file will not trade away:
 *
 * - **It never breaks the server.** Every failure is swallowed. A server that
 *   refused to start because it could not write a log would be a worse bug than
 *   the one being investigated.
 * - **It stays inside `.git/`**, which is already ignored, so nothing here can
 *   reach a commit or a diff.
 * - **It is bounded.** The file is truncated once it passes `MAX_BYTES`, oldest
 *   first, so a long-lived checkout cannot accumulate an unbounded log from a
 *   server that starts on every session.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { execGit } from '../core/git.js';
import { packageVersion } from '../core/paths.js';

/** Kept small: this is a breadcrumb trail, not telemetry. */
const MAX_BYTES = 64 * 1024;

export const LIFECYCLE_FILE = 'mcp-lifecycle.log';

/**
 * `.git/commitlore/mcp-lifecycle.log`, or `null` outside a repository.
 *
 * `rev-parse --git-path` rather than `.git/` by hand, so a linked worktree
 * writes where its own git directory is.
 */
export const lifecyclePath = (cwd: string = process.cwd()): string | null => {
  const result = execGit(['rev-parse', '--git-path', join('commitlore', LIFECYCLE_FILE)], { cwd });
  if (result.code !== 0) return null;
  const path = result.stdout.trim();
  return path === '' ? null : join(cwd, path);
};

const trim = (path: string): void => {
  try {
    if (statSync(path).size <= MAX_BYTES) return;
    const lines = readFileSync(path, 'utf8').split('\n');
    // Halve rather than clear: a truncation that emptied the file would destroy
    // the start line whose absence is the thing worth noticing.
    writeFileSync(path, `${lines.slice(Math.floor(lines.length / 2)).join('\n')}`);
  } catch {
    // A log that cannot be trimmed is still a log.
  }
};

const write = (cwd: string, line: string): void => {
  try {
    const path = lifecyclePath(cwd);
    if (path === null) return;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${line}\n`);
    trim(path);
  } catch {
    // Never break the server for a breadcrumb.
  }
};

/** ISO 8601, second precision — enough to line up against a client transcript. */
const stamp = (at: Date): string => `${at.toISOString().slice(0, 19)}Z`;

/**
 * Records that this server came up, and arranges for its exit to be recorded
 * too.
 *
 * The exit handlers are the point. A `started` line with no `exited` beside it
 * is a server that was killed — which is exactly the shape #424 describes and
 * exactly what nobody could establish afterwards.
 */
export const recordServerStart = (cwd: string = process.cwd(), at: Date = new Date()): void => {
  const entry = process.argv[1] ?? 'unknown';
  write(cwd, `started ${stamp(at)} pid ${String(process.pid)} ${packageVersion()} ${entry}`);

  let done = false;
  const exit = (how: string): void => {
    if (done) return;
    done = true;
    write(cwd, `exited  ${stamp(new Date())} pid ${String(process.pid)} ${how}`);
  };

  process.once('exit', () => {
    exit('clean');
  });
  // A client that goes away closes our stdin. That is the ordinary end of an
  // MCP session and is worth telling apart from a signal.
  process.stdin.once('end', () => {
    exit('stdin closed');
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => {
      exit(signal);
      process.exit(0);
    });
  }
};

export interface LifecycleEntry {
  readonly kind: 'started' | 'exited';
  readonly at: string;
  readonly pid: number;
  readonly detail: string;
}

/** Parses the log. Unreadable or absent reads as empty — it is a breadcrumb trail. */
export const readLifecycle = (cwd: string = process.cwd()): LifecycleEntry[] => {
  try {
    const path = lifecyclePath(cwd);
    if (path === null) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line) => {
        const match = /^(started|exited)\s+(\S+)\s+pid\s+(\d+)\s*(.*)$/.exec(line.trim());
        if (match === null) return [];
        return [
          {
            kind: match[1] as 'started' | 'exited',
            at: match[2] ?? '',
            pid: Number(match[3]),
            detail: (match[4] ?? '').trim(),
          },
        ];
      });
  } catch {
    return [];
  }
};

/**
 * Servers that started and never recorded an exit.
 *
 * The signal #424 needs: a start with no exit beside it did not close its
 * session, it was killed. A pid still running is excluded — that one is simply
 * the server currently serving.
 */
export const unfinishedRuns = (cwd: string = process.cwd()): LifecycleEntry[] => {
  const entries = readLifecycle(cwd);
  const exited = new Set(entries.filter((e) => e.kind === 'exited').map((e) => e.pid));
  return entries.filter((entry) => {
    if (entry.kind !== 'started' || exited.has(entry.pid)) return false;
    try {
      process.kill(entry.pid, 0);
      return false; // still alive: this is the running server
    } catch {
      return true;
    }
  });
};
