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
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
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
export const lifecyclePath = (cwd = process.cwd()) => {
    const result = execGit(['rev-parse', '--git-path', join('commitlore', LIFECYCLE_FILE)], { cwd });
    if (result.code !== 0)
        return null;
    const path = result.stdout.trim();
    return path === '' ? null : join(cwd, path);
};
const trim = (path) => {
    try {
        if (statSync(path).size <= MAX_BYTES)
            return;
        const lines = readFileSync(path, 'utf8').split('\n');
        // Halve rather than clear: a truncation that emptied the file would destroy
        // the start line whose absence is the thing worth noticing.
        writeFileSync(path, `${lines.slice(Math.floor(lines.length / 2)).join('\n')}`);
    }
    catch {
        // A log that cannot be trimmed is still a log.
    }
};
const write = (cwd, line) => {
    try {
        const path = lifecyclePath(cwd);
        if (path === null)
            return;
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, `${line}\n`);
        trim(path);
    }
    catch {
        // Never break the server for a breadcrumb.
    }
};
/** ISO 8601, second precision — enough to line up against a client transcript. */
const stamp = (at) => `${at.toISOString().slice(0, 19)}Z`;
/** The error text is one physical log line and safe to mirror to stderr. */
const errorMessage = (error) => {
    const message = error instanceof Error ? error.message || error.name : String(error);
    const singleLine = message.replace(/[\r\n]+/g, ' ').trim();
    return singleLine === '' ? 'unknown error' : singleLine;
};
/**
 * Records a server start and classifies the eventual exit.
 *
 * `output` is deliberately supplied by the caller alongside the stdio
 * transport. The SDK writes protocol frames there but does not watch it for
 * errors, so the listener here is what turns an output-pipe EPIPE into the
 * ordinary client hangup it represents.
 */
export const recordServerStart = (cwd = process.cwd(), at = new Date(), output = process.stdout) => {
    const entry = process.argv[1] ?? 'unknown';
    write(cwd, `started ${stamp(at)} pid ${String(process.pid)} ${packageVersion()} ${entry}`);
    // The lower number is only a fallback. A crash after stdin closes is still a
    // crash, and a signal received while the client is closing is still a signal.
    let reason;
    const note = (detail, priority) => {
        if (reason === undefined || priority >= reason.priority)
            reason = { detail, priority };
    };
    const crash = (error) => {
        const detail = `crashed: ${errorMessage(error)}`;
        note(detail, 3);
        // `process.exit()` does not wait for an asynchronous stderr pipe write.
        // A synchronous descriptor write keeps the only human diagnostic from
        // disappearing along with the process, and never touches protocol stdout.
        try {
            writeSync(2, `commitlore mcp: ${detail}\n`);
        }
        catch {
            // The lifecycle record is still attempted below; neither breadcrumb may
            // prevent process termination.
        }
    };
    process.once('exit', () => {
        write(cwd, `exited  ${stamp(new Date())} pid ${String(process.pid)} ${reason?.detail ?? 'clean'}`);
    });
    // A client that goes away closes our stdin. That is the ordinary end of an
    // MCP session and is worth telling apart from a signal.
    process.stdin.once('end', () => {
        note('stdin closed', 1);
    });
    output.once('error', (error) => {
        if (error.code === 'EPIPE') {
            note('client hung up', 2);
            process.exit(0);
        }
        crash(error);
        process.exit(1);
    });
    process.once('uncaughtException', (error) => {
        crash(error);
        process.exit(1);
    });
    process.once('unhandledRejection', (reason) => {
        crash(reason);
        process.exit(1);
    });
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.once(signal, () => {
            note(signal, 2);
            process.exit(0);
        });
    }
    return { crash };
};
/** Parses the log. Unreadable or absent reads as empty — it is a breadcrumb trail. */
export const readLifecycle = (cwd = process.cwd()) => {
    try {
        const path = lifecyclePath(cwd);
        if (path === null)
            return [];
        return readFileSync(path, 'utf8')
            .split('\n')
            .flatMap((line) => {
            const match = /^(started|exited)\s+(\S+)\s+pid\s+(\d+)\s*(.*)$/.exec(line.trim());
            if (match === null)
                return [];
            return [
                {
                    kind: match[1],
                    at: match[2] ?? '',
                    pid: Number(match[3]),
                    detail: (match[4] ?? '').trim(),
                },
            ];
        });
    }
    catch {
        return [];
    }
};
/** A completed server process whose final record says why it crashed. */
export const crashedRuns = (cwd = process.cwd()) => readLifecycle(cwd).filter((entry) => entry.kind === 'exited' && entry.detail.startsWith('crashed: '));
/**
 * Servers that started and never recorded an exit.
 *
 * The signal #424 needs: a start with no exit beside it did not close its
 * session, it was killed. A pid still running is excluded — that one is simply
 * the server currently serving.
 */
export const unfinishedRuns = (cwd = process.cwd()) => {
    const entries = readLifecycle(cwd);
    const exited = new Set(entries.filter((e) => e.kind === 'exited').map((e) => e.pid));
    return entries.filter((entry) => {
        if (entry.kind !== 'started' || exited.has(entry.pid))
            return false;
        try {
            process.kill(entry.pid, 0);
            return false; // still alive: this is the running server
        }
        catch {
            return true;
        }
    });
};
//# sourceMappingURL=lifecycle.js.map