import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Surfaces } from "./detect.ts";
import { git, gitOrThrow, readCommits, stripTrailerBlock } from "./git.ts";
import { resolveInside } from "./paths.ts";
import type { Task } from "./types.ts";

const WORKSPACE_MARKER = "commitlorebench-";
/** A diff large enough to blow past this is noise, not signal. */
const MAX_SURFACE_CHARS = 400_000;

export interface Workspace {
  readonly dir: string;
  /** HEAD after seeding — everything after this is the agent's work. */
  readonly baseSha: string;
  readonly seededRecords: number;
}

const seedDate = (seed: number, index: number): string => {
  const epoch = 1_700_000_000 + seed * 86_400 + index * 3_600;
  return `@${epoch} +0000`;
};

const writeSeedFiles = (dir: string, files: Readonly<Record<string, string>>): void => {
  for (const [relative, contents] of Object.entries(files)) {
    const target = resolveInside(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
};

const copyFixture = (repoRoot: string, fixturePath: string, dir: string): void => {
  const source = resolveInside(repoRoot, fixturePath);
  if (!fs.existsSync(source)) throw new Error(`fixture not found: ${source}`);
  fs.cpSync(source, dir, {
    recursive: true,
    dereference: false,
    filter: (from) => path.basename(from) !== ".git",
  });
};

export interface WorkspaceOptions {
  /** False strips the trailer block from every seed commit — the true control. */
  readonly seedRecords: boolean;
}

/**
 * Every (task, condition, seed) gets its own repository. The only channel that
 * may carry state between sessions is CommitLore itself — a shared workspace
 * would leak the answer through the filesystem and void the comparison.
 */
export const createWorkspace = (
  task: Task,
  seed: number,
  repoRoot: string,
  options: WorkspaceOptions = { seedRecords: true },
): Workspace => {
  const prefix = path.join(os.tmpdir(), `${WORKSPACE_MARKER}${process.pid}-${randomBytes(4).toString("hex")}-`);
  const dir = fs.mkdtempSync(prefix);

  gitOrThrow(dir, ["init", "-q", "-b", "main"]);
  gitOrThrow(dir, ["config", "user.name", "CommitLoreBench"]);
  gitOrThrow(dir, ["config", "user.email", "bench@commitlore.invalid"]);
  gitOrThrow(dir, ["config", "commit.gpgsign", "false"]);
  gitOrThrow(dir, ["config", "gc.auto", "0"]);

  if (task.repo.kind === "fixture" && task.repo.path !== undefined) {
    copyFixture(repoRoot, task.repo.path, dir);
    gitOrThrow(dir, ["add", "-A"]);
    gitOrThrow(dir, ["commit", "-q", "-m", "Import fixture"], {
      env: { GIT_AUTHOR_DATE: seedDate(seed, 0), GIT_COMMITTER_DATE: seedDate(seed, 0) },
    });
  }

  const seeds = task.repo.seed_commits ?? [];
  let seededRecords = 0;
  seeds.forEach((commit, index) => {
    writeSeedFiles(dir, commit.files);
    gitOrThrow(dir, ["add", "-A"]);
    const date = seedDate(seed, index + 1);
    const full = commit.message.endsWith("\n") ? commit.message : `${commit.message}\n`;
    gitOrThrow(dir, ["commit", "-q", "--cleanup=verbatim", "-F", "-"], {
      input: options.seedRecords ? full : stripTrailerBlock(dir, full),
      env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  });

  // A record that YAML indentation broke would silently weaken the on-condition,
  // so the seed is parsed back through git before any agent sees it.
  for (const commit of readCommits(dir)) {
    const hasRecord = commit.trailers.some((t) => t.key === "Record-Id");
    if (hasRecord) seededRecords += 1;
    if (!hasRecord && /^Record-Id:/m.test(commit.body)) {
      throw new Error(
        `${task.id}: seed commit "${commit.subject}" looks like a record but git parsed no trailers — ` +
          "check that the trailer block is the last paragraph and continuations are indented (SPEC §2.1)",
      );
    }
  }
  if (options.seedRecords && seededRecords === 0 && seeds.length > 0) {
    throw new Error(`${task.id}: no seed commit carries a Record-Id — the on-condition would have nothing to inject`);
  }
  if (!options.seedRecords && seededRecords > 0) {
    throw new Error(`${task.id}: the control arm still carries ${seededRecords} record(s) — trailer stripping failed`);
  }

  const baseSha = gitOrThrow(dir, ["rev-parse", "HEAD"]).trim();
  return { dir, baseSha, seededRecords };
};

const truncate = (text: string): string =>
  text.length <= MAX_SURFACE_CHARS ? text : `${text.slice(0, MAX_SURFACE_CHARS)}\n[truncated by bench]`;

/** What the agent left behind: its words, its diff, and any commits it made. */
export const collectSurfaces = (workspace: Workspace, transcript: string): Surfaces => {
  let diff = "";
  let commits = "";
  try {
    git(workspace.dir, ["add", "-A", "-N"]);
    diff = git(workspace.dir, ["diff", "--no-color", "--no-ext-diff", workspace.baseSha]).stdout;
  } catch {
    diff = "";
  }
  try {
    commits = readCommits(workspace.dir, `${workspace.baseSha}..HEAD`)
      .map((commit) => commit.body)
      .join("\n");
  } catch {
    commits = "";
  }
  return { transcript: truncate(transcript), diff: truncate(diff), commits: truncate(commits) };
};

export const destroyWorkspace = (dir: string): void => {
  const resolved = path.resolve(dir);
  const inTemp = resolved.startsWith(path.resolve(os.tmpdir()));
  if (!inTemp || !path.basename(resolved).startsWith(WORKSPACE_MARKER)) {
    throw new Error(`refusing to remove a directory the bench did not create: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
};
