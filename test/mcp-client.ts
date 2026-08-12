/**
 * A persistent MCP client for tests, extracted so more than one suite can drive
 * the real server.
 *
 * It has to be persistent. A synchronous driver that writes every frame and
 * closes stdin looks simpler and does not work: the server reads that EOF as
 * the client hanging up and exits before answering the queued `tools/call`
 * frames. Worse, the missing response is indistinguishable from a rejected
 * draft, so a test asserting "a fabricated quote is refused" passed while
 * nothing had been refused (#576).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/** How long one request may take before the test is told, rather than hanging. */
export const RPC_TIMEOUT_MS = 30_000;

export interface RpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export interface Stub {
  request: (method: string, params?: unknown) => Promise<RpcResponse>;
  notify: (method: string, params?: unknown) => void;
  /** Every byte the child has written to stdout, verbatim. */
  stdout: () => string;
  stderr: () => string;
  /** Lines seen on stdout that were not parseable JSON — the pollution signal. */
  malformed: () => string[];
  /**
   * Ends stdin, stops the child, and resolves only once it has actually gone.
   *
   * `child.kill()` returns as soon as the signal is delivered, not once the
   * process is done — and this server writes its exit record on the way out
   * (src/mcp/lifecycle.ts), so a caller that removed the temp directory right
   * after `close()` returned raced a live write and hit ENOTEMPTY in CI. A
   * shutdown that is not awaited is not a shutdown.
   */
  close: () => Promise<void>;
}

export const startStub = (cwd: string, entry: string, args: string[] = []): Stub => {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [entry, ...args], {
    cwd,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let out = '';
  let err = '';
  let buffer = '';
  const malformed: string[] = [];
  const pending = new Map<number, (response: RpcResponse) => void>();
  let nextId = 1;

  // A child that dies mid-session must surface as a timeout carrying its
  // stderr, not as an unhandled EPIPE that takes the test runner with it.
  child.on('error', (error) => {
    err += `spawn error: ${error.message}\n`;
  });
  child.stdin.on('error', () => {});

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    err += chunk;
  });
  child.stdout.on('data', (chunk: string) => {
    out += chunk;
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') continue;
      let message: RpcResponse;
      try {
        message = JSON.parse(line) as RpcResponse;
      } catch {
        malformed.push(line);
        continue;
      }
      if (typeof message.id !== 'number') continue;
      const resolve = pending.get(message.id);
      if (resolve === undefined) continue;
      pending.delete(message.id);
      resolve(message);
    }
  });

  const send = (payload: Record<string, unknown>): void => {
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  return {
    request: (method, params) =>
      new Promise<RpcResponse>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out after ${RPC_TIMEOUT_MS}ms; stderr:\n${err}`));
        }, RPC_TIMEOUT_MS);
        pending.set(id, (response) => {
          clearTimeout(timer);
          resolve(response);
        });
        send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
      }),
    notify: (method, params) => {
      send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
    },
    stdout: () => out,
    stderr: () => err,
    malformed: () => malformed,
    close: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once('exit', () => { resolve(); }));
      child.stdin.end();
      child.kill();
      // SIGTERM first, then escalate: a server wedged in its own exit path must
      // not hang the suite, and the escalation is itself worth seeing.
      const escalation = setTimeout(() => child.kill('SIGKILL'), 5_000);
      await exited;
      clearTimeout(escalation);
    },
  };
};
