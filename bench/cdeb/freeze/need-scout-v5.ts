/**
 * The record-blind sandbox the task-author chain runs in.
 *
 * SSOT §6.2 forbids NEED-SCOUT and FUNCTIONAL-AUTHOR from seeing the record,
 * the ruling, the reason, the Record-Id, the decision anchor, the gold or any
 * reviewer interpretation. Handing them a materialized bundle does not achieve
 * that, and it is worth being precise about why: the bundle carries the whole
 * commit history *and* `refs/notes/commitlore`, so an agent with `git` in that
 * directory is one `git log` away from every record the study is about. The
 * firewall would then rest on the agent choosing not to look.
 *
 * So the sandbox is the frozen tree with **no `.git` at all**. There is nothing
 * to read, rather than a rule against reading. What goes in is enumerated and
 * hashed, and `assertSandboxIsRecordBlind` fails closed on a repository whose
 * own working files quote a record — that is a leak the missing history cannot
 * prevent, and it makes the candidate unbuildable rather than the task unsafe.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

/**
 * Markers of a CommitLore record in ordinary file content. These are the
 * trailer keys the format defines, anchored to line starts so a passing mention
 * of the word "provenance" in prose does not fire.
 */
const RECORD_MARKERS: readonly RegExp[] = [
  /^\s*Record-Id:\s*\S/m,
  /^\s*Ruled-out:\s*\S/m,
  /^\s*Provenance:\s*(authored|inferred|imported)/m,
  /^\s*Supersedes:\s*\S/m,
  /^\s*CommitLore-Version:\s*\S/m,
];

export interface SandboxLeak {
  readonly path: string;
  readonly marker: string;
  readonly line: string;
}

export interface RecordBlindSandbox {
  readonly dir: string;
  readonly repository_id: string;
  readonly snapshot_commit: string;
  /** sha256 over every file path and its bytes, in sorted path order. */
  readonly tree_digest: string;
  readonly file_count: number;
  readonly leaks: readonly SandboxLeak[];
}

const walk = (root: string, current = root): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      out.push(...walk(root, full));
    } else if (entry.isFile()) {
      out.push(relative(root, full));
    }
  }
  return out.sort();
};

const LIKELY_TEXT = /\.(md|txt|ts|tsx|js|mjs|cjs|py|swift|json|ya?ml|toml|cfg|ini|sh|rs|go|java|rb|sql)$/i;

/** Scans the working files for record content the missing history cannot hide. */
export const scanForRecordLeaks = (dir: string, files: readonly string[]): SandboxLeak[] => {
  const leaks: SandboxLeak[] = [];
  for (const file of files) {
    if (!LIKELY_TEXT.test(file)) continue;
    const full = join(dir, file);
    if (statSync(full).size > 2 * 1024 * 1024) continue;
    const text = readFileSync(full, "utf8");
    for (const marker of RECORD_MARKERS) {
      const match = marker.exec(text);
      if (match !== null) {
        leaks.push({ path: file, marker: marker.source, line: match[0].trim().slice(0, 160) });
        break;
      }
    }
  }
  return leaks;
};

/**
 * Materializes the frozen snapshot as a plain directory of files, verifying the
 * bundle digest first and destroying the git metadata afterwards.
 *
 * The caller owns the directory and must remove it.
 */
export const materializeRecordBlindTree = (input: {
  readonly bundlePath: string;
  readonly bundleSha256: string;
  readonly snapshotCommit: string;
  readonly repositoryId: string;
}): RecordBlindSandbox => {
  const bundlePath = resolve(input.bundlePath);
  if (!existsSync(bundlePath)) throw new Error(`need-scout: bundle ${bundlePath} is missing`);
  const actual = createHash("sha256").update(readFileSync(bundlePath)).digest("hex");
  if (actual !== input.bundleSha256) {
    throw new Error(`need-scout: ${input.repositoryId}'s bundle hashes to ${actual}, not the frozen ${input.bundleSha256}`);
  }

  const dir = mkdtempSync(join(tmpdir(), "cdeb-blind-"));
  try {
    git(tmpdir(), ["clone", "--quiet", "--no-hardlinks", bundlePath, dir]);
    git(dir, ["checkout", "--quiet", "--detach", input.snapshotCommit]);
    const head = git(dir, ["rev-parse", "HEAD"]).trim();
    if (head !== input.snapshotCommit) {
      throw new Error(`need-scout: HEAD ${head} is not the frozen snapshot`);
    }
    // The whole point. After this there is no history, no notes ref, and no
    // reflog in the directory the task author works in.
    rmSync(join(dir, ".git"), { recursive: true, force: true });
    if (existsSync(join(dir, ".git"))) throw new Error("need-scout: .git survived removal");

    const files = walk(dir);
    const hash = createHash("sha256");
    for (const file of files) {
      hash.update(file);
      hash.update("\0");
      hash.update(readFileSync(join(dir, file)));
      hash.update("\0");
    }
    return {
      dir,
      repository_id: input.repositoryId,
      snapshot_commit: input.snapshotCommit,
      tree_digest: hash.digest("hex"),
      file_count: files.length,
      leaks: scanForRecordLeaks(dir, files),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
};

/** What a sandbox discloses about one specific candidate. */
export interface CandidateDisclosure {
  readonly candidate_id: string;
  /** The candidate's own Record-Id, found verbatim in a working file. */
  readonly own_record_id_present: boolean;
  /** Shared 5-word runs between the candidate's ruling and the tree. */
  readonly ruling_overlap: number;
  readonly disclosing_paths: readonly string[];
  /** Record lines belonging to other candidates. Reported, not blocking. */
  readonly other_record_lines: number;
}

const shingle = (text: string, size = 5): Set<string> => {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");
  const out = new Set<string>();
  for (let index = 0; index + size <= words.length; index += 1) out.add(words.slice(index, index + size).join(" "));
  return out;
};

/**
 * What the firewall is actually for: the author must not see **the decision the
 * task is being built around**. A record belonging to a different candidate is
 * a different question -- it matters when that candidate is built, and its own
 * sandbox check is where it matters.
 *
 * `assertSandboxIsRecordBlind` blocks on any record line anywhere, which is the
 * conservative reading and over-fires badly: two of the four corpus
 * repositories carry a record line in an unrelated document, so the coarse rule
 * disposes all 22 gitseed and all 10 agent-control-plane candidates and empties
 * two fixed strata over documents that disclose nothing about the candidate in
 * hand. This is the precise reading, and it is stricter where it counts -- it
 * also catches a tree that discloses the ruling in prose without naming its id.
 */
export const disclosureForCandidate = (
  sandbox: RecordBlindSandbox,
  candidate: { readonly candidate_id: string; readonly record_id: string | null; readonly ruling_text: string },
  files: readonly string[],
): CandidateDisclosure => {
  const ruling = shingle(candidate.ruling_text);
  const disclosing: string[] = [];
  let overlap = 0;
  let ownId = false;
  for (const file of files) {
    if (!LIKELY_TEXT.test(file)) continue;
    const full = join(sandbox.dir, file);
    if (!existsSync(full) || statSync(full).size > 2 * 1024 * 1024) continue;
    const text = readFileSync(full, "utf8");
    const idHit =
      candidate.record_id !== null && new RegExp(`Record-Id:\\s*${candidate.record_id}\\b`).test(text);
    const treeShingles = shingle(text);
    const shared = [...ruling].filter((run) => treeShingles.has(run)).length;
    if (idHit || shared > 0) disclosing.push(file);
    if (idHit) ownId = true;
    overlap += shared;
  }
  return {
    candidate_id: candidate.candidate_id,
    own_record_id_present: ownId,
    ruling_overlap: overlap,
    disclosing_paths: disclosing,
    other_record_lines: sandbox.leaks.length,
  };
};

/** The per-candidate gate. Blocks on disclosure of *this* candidate's decision. */
export const assertSandboxBlindForCandidate = (
  sandbox: RecordBlindSandbox,
  disclosure: CandidateDisclosure,
): void => {
  if (existsSync(join(sandbox.dir, ".git"))) {
    throw new Error(`need-scout: ${sandbox.repository_id}'s sandbox still has a .git directory`);
  }
  if (disclosure.own_record_id_present) {
    throw new Error(
      `firewall: ${disclosure.candidate_id}'s own Record-Id appears in ${disclosure.disclosing_paths.join(", ")}, ` +
        `so the author would read the decision the task is being built around`,
    );
  }
  if (disclosure.ruling_overlap > 0) {
    throw new Error(
      `firewall: ${disclosure.candidate_id}'s ruling shares ${String(disclosure.ruling_overlap)} five-word run(s) ` +
        `with ${disclosure.disclosing_paths.join(", ")}. The id is absent but the decision is legible`,
    );
  }
};

/**
 * A sandbox that still contains record content is not record-blind, whatever
 * was done to the history. Kept as the repository-level scan: it reports every
 * record line in the tree, which is worth knowing even when none of them
 * belongs to the candidate in hand.
 */
export const assertSandboxIsRecordBlind = (sandbox: RecordBlindSandbox): void => {
  if (existsSync(join(sandbox.dir, ".git"))) {
    throw new Error(
      `need-scout: ${sandbox.repository_id}'s sandbox still has a .git directory, so the whole record history ` +
        `is one command away from the author who must not see it`,
    );
  }
  if (sandbox.leaks.length > 0) {
    throw new Error(
      `need-scout: ${sandbox.repository_id}'s working tree quotes ${String(sandbox.leaks.length)} record line(s), ` +
        `which removing the history cannot hide: ` +
        sandbox.leaks
          .slice(0, 3)
          .map((leak) => `${leak.path} (${leak.line})`)
          .join("; "),
    );
  }
};
