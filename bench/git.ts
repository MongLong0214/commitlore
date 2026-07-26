import { spawnSync } from "node:child_process";

export interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}

export interface Trailer {
  readonly key: string;
  readonly value: string;
}

/**
 * Seeding must not inherit the operator's git identity, hooks or templates —
 * otherwise a bench repository differs from machine to machine and the seed
 * stops being a seed.
 */
const HERMETIC_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ADVICE: "0",
};

export interface GitOptions {
  readonly input?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly maxBuffer?: number;
}

export const git = (cwd: string, args: readonly string[], options: GitOptions = {}): GitResult => {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    env: { ...process.env, ...HERMETIC_ENV, ...options.env },
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  if (result.error !== undefined) {
    throw new Error(`git ${args.join(" ")} failed to spawn: ${result.error.message}`);
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
};

export const gitOrThrow = (cwd: string, args: readonly string[], options: GitOptions = {}): string => {
  const result = git(cwd, args, options);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout;
};

/**
 * SPEC §2: trailer parsing MUST be delegated to `git interpret-trailers --parse`.
 * Line-matching would misread B3 prose as a record.
 */
export const parseTrailers = (cwd: string, message: string): readonly Trailer[] => {
  const out = gitOrThrow(cwd, ["interpret-trailers", "--parse"], { input: message });
  const trailers: Trailer[] = [];
  for (const line of out.split("\n")) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    trailers.push({ key: line.slice(0, colon), value: line.slice(colon + 1).trim() });
  }
  return trailers;
};

/**
 * Removes the trailer block, leaving subject and body prose. The block is the
 * last paragraph (SPEC §2.1 B1/B2), and git itself decides whether one exists —
 * line-matching would eat B3 prose.
 */
export const stripTrailerBlock = (cwd: string, message: string): string => {
  if (parseTrailers(cwd, message).length === 0) return message;
  const paragraphs = message.replace(/\s+$/, "").split(/\n{2,}/);
  if (paragraphs.length <= 1) return `${paragraphs[0] ?? ""}\n`;
  return `${paragraphs.slice(0, -1).join("\n\n")}\n`;
};

export interface CommitRecord {
  readonly sha: string;
  readonly subject: string;
  readonly body: string;
  readonly trailers: readonly Trailer[];
}

/** argv cannot carry a raw NUL, so the log format uses git's %x escapes. */
const FIELD_SEP = String.fromCharCode(0);
const RECORD_SEP = String.fromCharCode(30);
const LOG_FORMAT = "--format=%H%x00%s%x00%B%x1e";

/** Commits from oldest to newest, each with its parsed trailer block. */
export const readCommits = (cwd: string, range?: string): readonly CommitRecord[] => {
  const args = ["log", "--reverse", LOG_FORMAT];
  if (range !== undefined) args.push(range);
  const out = gitOrThrow(cwd, args);
  const commits: CommitRecord[] = [];
  for (const chunk of out.split(RECORD_SEP)) {
    if (chunk.trim() === "") continue;
    const [sha, subject, body] = chunk.replace(/^\n+/, "").split(FIELD_SEP);
    if (sha === undefined || subject === undefined || body === undefined) continue;
    commits.push({ sha, subject, body, trailers: parseTrailers(cwd, body) });
  }
  return commits;
};
