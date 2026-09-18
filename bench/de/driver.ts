/**
 * The measured actor driver — #1035, revision `native-efficacy-r6.1`.
 *
 * An opt-in path beside `bench/drivers/claude-headless.ts`, not a replacement
 * for it. #1035 lists what the legacy driver does that a measured run must not
 * inherit — "passes prompts in argv ... maps missing usage to zero ... checks
 * some limits after completion" — and also says not to change unrelated legacy
 * result interpretation, so the old driver keeps its behaviour and its callers.
 *
 * What this one guarantees, and why each is here rather than in a comment on the
 * old one:
 *
 *   - **The prompt travels on stdin, once, and never in argv.** A prompt in argv
 *     is visible to every process on the machine, is bounded by `ARG_MAX`, and
 *     makes "was the prompt identical in both arms" a question about quoting.
 *     The bytes are written to a file before the spawn, so what was sent is
 *     recoverable independently of what the child says it received.
 *   - **The child environment is built, never inherited-and-edited.** No mutation
 *     of `process.env`, so one cell cannot change another; and the Jev keys are
 *     removed rather than assumed absent, because #1044-#1051 are cancelled and
 *     a stray key in a developer's shell would be a live dependency nobody
 *     declared.
 *   - **A pre-spawn storage failure prevents the run.** #1035: it "prevents
 *     inference". Spawning first and discovering afterwards that the raw log
 *     could not be opened spends the money and keeps none of the evidence.
 *   - **A truncated stream is reported, not dropped.** The last event of a run
 *     that was cut off mid-write is exactly the one worth having, so a trailing
 *     fragment is parsed if it can be and flagged if it cannot.
 *
 * Nothing here interprets usage. `bench/de/usage.ts` owns that, and this module
 * hands it the events it observed.
 */

import { spawn } from "node:child_process";
import { createWriteStream, writeFileSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

/**
 * Removed from every measured child.
 *
 * The Jev prototype was withdrawn (#1044-#1051). Leaving its keys in the child
 * environment would let a developer's shell decide whether a measured run had a
 * dependency the study says it does not have.
 */
export const STRIPPED_ENV_KEYS = [
  "COMMITLORE_JEV_API_KEY",
  "TYPESAFE_API_KEY",
  "COMMITLORE_JEV_ACTIVATION",
] as const;

/**
 * Build the child's environment from an explicit base.
 *
 * Takes a base rather than reading `process.env` so a test — and a runner
 * driving many cells — states what the child gets instead of inheriting
 * whatever the parent happens to hold. #1035 requires the settings passed to
 * children be frozen, and a later change to `HOME` or the parent's own
 * configuration must not silently change another cell.
 */
export const childEnv = (base: Readonly<Record<string, string | undefined>>): Record<string, string> => {
  const stripped = new Set<string>(STRIPPED_ENV_KEYS);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || stripped.has(key)) continue;
    env[key] = value;
  }
  return env;
};

export type StdinDelivery = "complete" | "epipe" | "closed-early";

export interface MeasuredRequest {
  readonly executable: string;
  /** Never carries the prompt. Checked, not assumed. */
  readonly args: readonly string[];
  readonly prompt: string;
  readonly cwd: string;
  /** Raw stdout, raw stderr and the exact prompt bytes are written here. */
  readonly outDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
  /** Prefix for this phase's files, so one directory can hold several. */
  readonly label: string;
}

export interface MeasuredResult {
  /** Every JSON event the child emitted, in order. */
  readonly events: readonly unknown[];
  /**
   * A trailing fragment that did not parse. Reported rather than dropped: the
   * last event of a run cut off mid-write is the one worth having, and a silent
   * drop turns a truncated run into a shorter complete one.
   */
  readonly incompleteTrailing: string | null;
  /** Lines that were not JSON at all, kept for the report. */
  readonly unparsedLines: number;
  readonly promptPath: string;
  readonly promptBytes: number;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly stdinDelivered: StdinDelivery;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly startedAt: string;
  readonly endedAt: string;
}

/**
 * Prefix on every failure raised before a child exists.
 *
 * A plain `Error` with a recognisable message rather than a subclass, per this
 * repository's convention. The distinction the caller needs is not the class
 * but the phase: nothing was spawned, so there is no spend and no partial
 * evidence, and the run can be re-attempted once storage is fixed.
 */
export const PRE_SPAWN = "measured driver, before spawn:";

const openOrRefuse = (path: string): WriteStream => {
  try {
    const stream = createWriteStream(path, { flags: "w" });
    stream.on("error", () => {
      // A post-spawn write failure must not take the process down: #1035 keeps
      // the partial evidence and the spend, and stops further spending
      // elsewhere. Silence here is deliberate and the stream's own state is
      // what the caller inspects.
    });
    return stream;
  } catch (error) {
    throw new Error(`${PRE_SPAWN} could not open ${path}: ${(error as Error).message}`);
  }
};

/**
 * Run one measured invocation.
 *
 * Refuses rather than repairs: an argv carrying the prompt, or an output
 * directory that cannot be written, ends the call before a child exists.
 */
export const runMeasured = async (request: MeasuredRequest): Promise<MeasuredResult> => {
  const promptPath = join(request.outDir, `${request.label}.prompt.txt`);
  const stdoutPath = join(request.outDir, `${request.label}.stdout.jsonl`);
  const stderrPath = join(request.outDir, `${request.label}.stderr.log`);
  const bytes = Buffer.from(request.prompt, "utf8");

  // Never in argv. Checked rather than promised: the legacy driver passes the
  // prompt there, so a measured caller assembling args from the old shape is
  // the likely mistake, and a prompt on the command line is readable by every
  // process on the machine.
  if (request.args.some((arg) => arg.includes(request.prompt))) {
    throw new Error(`${PRE_SPAWN} the prompt appears in argv; a measured run sends it on stdin only`);
  }

  try {
    writeFileSync(promptPath, bytes);
  } catch (error) {
    throw new Error(`${PRE_SPAWN} could not write the prompt to ${promptPath}: ${(error as Error).message}`);
  }
  const out = openOrRefuse(stdoutPath);
  const err = openOrRefuse(stderrPath);

  const startedAt = new Date().toISOString();
  const events: unknown[] = [];
  let unparsedLines = 0;
  let incompleteTrailing: string | null = null;
  let stdinDelivered: StdinDelivery = "complete";

  return await new Promise<MeasuredResult>((resolve, reject) => {
    const child = spawn(request.executable, [...request.args], {
      cwd: request.cwd,
      env: childEnv(request.env),
      stdio: ["pipe", "pipe", "pipe"],
      // Explicit: a shell would reinterpret the argv and put the environment
      // through another parser.
      shell: false,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, request.timeoutMs);

    // A decoder rather than `chunk.toString()`: a multi-byte character split
    // across two chunks becomes two replacement characters otherwise, and the
    // prompts here are not all ASCII.
    const decoder = new StringDecoder("utf8");
    let pending = "";

    const consume = (line: string): void => {
      if (line.trim() === "") return;
      try {
        events.push(JSON.parse(line));
      } catch {
        unparsedLines += 1;
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      out.write(chunk);
      pending += decoder.write(chunk);
      let newline = pending.indexOf("\n");
      while (newline !== -1) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err.write(chunk);
    });

    // One write, then close. No retry with a different prompt, and no second
    // copy: #1035 says send the same buffer ONCE.
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      stdinDelivered = error.code === "EPIPE" ? "epipe" : "closed-early";
    });
    child.stdin.write(bytes, (error) => {
      if (error !== null && error !== undefined && stdinDelivered === "complete") {
        stdinDelivered = "closed-early";
      }
    });
    child.stdin.end();

    child.on("error", (error) => {
      clearTimeout(timer);
      out.end();
      err.end();
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      pending += decoder.end();
      if (pending.trim() !== "") {
        // A final complete event with no trailing newline is ordinary and must
        // be kept; anything else is a truncation and is reported as one.
        try {
          events.push(JSON.parse(pending));
        } catch {
          incompleteTrailing = pending;
        }
      }
      out.end();
      err.end();
      resolve({
        events,
        incompleteTrailing,
        unparsedLines,
        promptPath,
        promptBytes: bytes.byteLength,
        stdoutPath,
        stderrPath,
        stdinDelivered,
        exitCode: code,
        signal,
        timedOut,
        startedAt,
        endedAt: new Date().toISOString(),
      });
    });
  });
};
