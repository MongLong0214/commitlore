/**
 * CDEB-06: deterministic tree archives and the hygiene gate every candidate
 * archive must pass before the evaluator looks at a byte of it.
 *
 * Two directions, one format:
 *
 *   - FREEZE side (§11.1): the staged final tree becomes a byte-reproducible
 *     ustar archive — sorted entries, zeroed mtime/uid/gid, modes normalized
 *     to git semantics. The same tree yields the same bytes on any machine,
 *     so `archive_sha256` is a comparable identity rather than a recording
 *     accident of whichever tar happened to run.
 *   - INGEST side (evaluator): the candidate archive is UNTRUSTED INPUT. It
 *     is parsed by this module's own reader — never by a system tar whose
 *     flags and versions vary — and every entry passes the hygiene gate
 *     before anything touches disk: no absolute paths, no `..` components,
 *     no `.git` smuggling, no hardlinks or device nodes, no symlink whose
 *     target leaves the tree, no path through a directory symlink.
 *
 * The `.git` refusal is load-bearing: the evaluator runs git inside the
 * extraction to recompute the tree OID, and a smuggled `.git/config` can
 * carry `core.fsmonitor` / hooks configuration — code execution from a file
 * the candidate wrote. A candidate tree never legitimately contains `.git`
 * (freeze stages tracked content only), so the refusal costs nothing.
 */

import { mkdirSync, readlinkSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, posix } from "node:path";
import { constants as zstdConstants, zstdCompressSync, zstdDecompressSync } from "node:zlib";

import type { IngestLimits, IngestRefusal } from "./types.ts";
import { DEFAULT_INGEST_LIMITS } from "./types.ts";

/** zstd level pinned so compressed archive bytes are reproducible run-to-run. */
export const ARCHIVE_ZSTD_LEVEL = 3;

/** Magic bytes of a zstd frame; used to accept `.tar` and `.tar.zst` alike. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export const sha256Hex = (input: Buffer | string): string =>
  createHash("sha256").update(input).digest("hex");

/** One archive entry as the freeze side emits and the ingest side validates. */
export interface ArchiveEntry {
  /** Tree-relative path, `/`-separated, no leading slash, no `.`/`..`. */
  readonly path: string;
  readonly type: "file" | "dir" | "symlink";
  /** Regular-file contents; empty for dirs and symlinks. */
  readonly content: Buffer;
  /** Symlink target string; empty otherwise. */
  readonly linkTarget: string;
  /** True when any executable bit is set (git's only file-mode distinction). */
  readonly executable: boolean;
}

/** Split a tree-relative path into components, refusing the shapes that escape. */
const componentsOf = (path: string): string[] | null => {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return null;
  const parts = path.split("/");
  for (const part of parts) {
    if (part === "" || part === "." || part === "..") return null;
  }
  return parts;
};

/** Does this path component list stay inside the root? (lexical containment) */
const staysInside = (parts: readonly string[]): boolean => {
  let depth = 0;
  for (const part of parts) {
    if (part === "..") {
      depth -= 1;
      if (depth < 0) return false;
    } else if (part !== "." && part !== "") {
      depth += 1;
    }
  }
  return true;
};

/* -------------------------------------------------------------------------- */
/* ustar serialization — deliberately hand-rolled: same bytes on any machine  */
/* -------------------------------------------------------------------------- */

const BLOCK = 512;

const octal = (value: number, width: number): Buffer => {
  const text = value.toString(8).padStart(width - 1, "0");
  if (text.length > width - 1) throw new Error(`tar: value ${String(value)} does not fit ${String(width)} octal bytes`);
  const buffer = Buffer.alloc(width);
  buffer.write(text, "ascii");
  return buffer; // final byte stays NUL
};

const fixed = (text: string, width: number): Buffer => {
  const buffer = Buffer.alloc(width);
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > width) throw new Error(`tar: field too wide: ${text.slice(0, 32)}...`);
  bytes.copy(buffer);
  return buffer;
};

const headerFor = (entry: ArchiveEntry): Buffer => {
  const parts = componentsOf(entry.path);
  if (parts === null) throw new Error(`tar: refusing to serialize unsafe path ${entry.path}`);
  const name = parts.join("/");
  if (Buffer.byteLength(name, "utf8") > 100) {
    throw new Error(`tar: name longer than 100 bytes (pax refused by this format): ${name}`);
  }
  const header = Buffer.alloc(BLOCK);
  fixed(name, 100).copy(header, 0);
  const mode = entry.type === "dir" || entry.type === "symlink" ? 0o755 : entry.executable ? 0o755 : 0o644;
  octal(mode, 8).copy(header, 100);
  octal(0, 8).copy(header, 108); // uid
  octal(0, 8).copy(header, 116); // gid
  octal(entry.type === "file" ? entry.content.length : 0, 12).copy(header, 124);
  octal(0, 12).copy(header, 136); // mtime: zeroed — the archive carries no clocks
  const typeflag = entry.type === "file" ? "0" : entry.type === "dir" ? "5" : "2";
  header.write(typeflag, 156, "ascii");
  if (entry.type === "symlink") fixed(entry.linkTarget, 100).copy(header, 157);
  header.write("ustar", 257, "ascii"); // magic, byte 263 stays NUL
  header.write("00", 263, "ascii");
  // uname/gname/devmajor/devminor/prefix left zero — no host identity leaks
  header.fill(0x20, 148, 156); // checksum field counts as spaces while summing
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, "0"), 148, "ascii");
  header.writeUInt8(0, 154);
  header.writeUInt8(0x20, 155);
  return header;
};

/** Deterministic ustar bytes for a set of entries (order is imposed here). */
export const renderArchive = (entries: readonly ArchiveEntry[]): Buffer => {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const seen = new Set<string>();
  const chunks: Buffer[] = [];
  for (const entry of sorted) {
    if (seen.has(entry.path)) throw new Error(`tar: duplicate entry ${entry.path}`);
    seen.add(entry.path);
    chunks.push(headerFor(entry));
    if (entry.type === "file" && entry.content.length > 0) {
      chunks.push(entry.content);
      const pad = (BLOCK - (entry.content.length % BLOCK)) % BLOCK;
      if (pad > 0) chunks.push(Buffer.alloc(pad));
    }
  }
  chunks.push(Buffer.alloc(BLOCK * 2)); // end-of-archive marker
  return Buffer.concat(chunks);
};

/** Walk a real directory into archive entries (freeze side only). */
export const entriesFromDirectory = (root: string, relativePaths: readonly string[]): ArchiveEntry[] => {
  const entries: ArchiveEntry[] = [];
  const dirs = new Set<string>();
  for (const rel of relativePaths) {
    const abs = join(root, rel);
    const stat = statSync(abs);
    const parts = componentsOf(rel);
    if (parts === null) throw new Error(`tree: unsafe path in staged set: ${rel}`);
    for (let depth = 1; depth < parts.length; depth += 1) {
      dirs.add(parts.slice(0, depth).join("/"));
    }
    if (stat.isSymbolicLink()) {
      entries.push({ path: rel, type: "symlink", content: Buffer.alloc(0), linkTarget: readlinkSync(abs), executable: false });
    } else if (stat.isFile()) {
      entries.push({
        path: rel,
        type: "file",
        content: readFileSync(abs),
        linkTarget: "",
        executable: (stat.mode & 0o111) !== 0,
      });
    } else {
      throw new Error(`tree: unsupported entry in staged set: ${rel}`);
    }
  }
  for (const dir of dirs) entries.push({ path: dir, type: "dir", content: Buffer.alloc(0), linkTarget: "", executable: false });
  return entries;
};

/* -------------------------------------------------------------------------- */
/* ustar parsing + hygiene gate (ingest side)                                 */
/* -------------------------------------------------------------------------- */

interface ParsedEntry {
  readonly name: string;
  readonly mode: number;
  readonly typeflag: string;
  readonly size: number;
  readonly linkname: string;
  readonly data: Buffer;
}

const parseOctal = (buffer: Buffer, offset: number, length: number): number => {
  const text = buffer.subarray(offset, offset + length).toString("ascii").replace(/[\0 ]+$/g, "").trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error("tar: corrupt octal field");
  return Number.parseInt(text, 8);
};

const parseUstar = (bytes: Buffer): ParsedEntry[] => {
  const entries: ParsedEntry[] = [];
  let offset = 0;
  let emptyBlocks = 0;
  while (offset + BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) {
      emptyBlocks += 1;
      offset += BLOCK;
      if (emptyBlocks >= 2) break;
      continue;
    }
    emptyBlocks = 0;
    const magic = header.subarray(257, 263).toString("ascii");
    if (!magic.startsWith("ustar")) throw new Error("tar: not a ustar archive (pax/gnu variants refused)");
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0);
    const recorded = parseOctal(header, 148, 8);
    if (sum !== recorded) throw new Error("tar: header checksum mismatch");
    const name = header.subarray(0, 100).toString("utf8").replace(/\0+$/g, "");
    const mode = parseOctal(header, 100, 8);
    const size = parseOctal(header, 124, 12);
    const typeflag = header.subarray(156, 157).toString("ascii");
    const linkname = header.subarray(157, 257).toString("utf8").replace(/\0+$/g, "");
    offset += BLOCK;
    const data = bytes.subarray(offset, offset + size);
    if (data.length < size) throw new Error("tar: truncated entry data");
    offset += Math.ceil(size / BLOCK) * BLOCK;
    entries.push({ name, mode, typeflag, size, linkname, data: Buffer.from(data) });
  }
  return entries;
};

export interface ExtractionResult {
  readonly refusal: IngestRefusal | null;
  readonly fileCount: number;
}

/**
 * Extracts a candidate archive under `dest`, enforcing the hygiene gate.
 * Returns a refusal instead of throwing: a hostile archive is not an
 * infrastructure problem, it is a candidate tree that fails evaluation.
 */
export const extractTreeArchive = (
  archiveBytes: Buffer,
  dest: string,
  limits: IngestLimits = DEFAULT_INGEST_LIMITS,
): ExtractionResult => {
  const refuse = (code: IngestRefusal["code"], detail: string): ExtractionResult => ({
    refusal: { code, detail },
    fileCount: 0,
  });

  let parsed: ParsedEntry[];
  try {
    parsed = parseUstar(archiveBytes);
  } catch (error) {
    return refuse("invalid-tar", (error as Error).message);
  }
  // A truncated or garbage archive shorter than one block parses as zero
  // entries; no legitimate freeze produces an empty archive (§11.1 freezes
  // a task repository, which always has files), so fail closed.
  if (parsed.length === 0) {
    return refuse("invalid-tar", "archive contains no entries");
  }

  const symlinkDirs = new Set<string>(); // tree-relative dirs that are symlinks
  const seen = new Set<string>();
  let totalBytes = 0;
  let fileCount = 0;

  mkdirSync(dest, { recursive: true });

  for (const entry of parsed) {
    if (entry.typeflag === "x" || entry.typeflag === "g" || entry.typeflag === "L" || entry.typeflag === "K") {
      return refuse("pax-or-gnu-extension-refused", `entry ${entry.name}: extension headers are refused`);
    }
    if (entry.name.length > limits.max_path_length) {
      return refuse("path-too-long", `entry ${entry.name.slice(0, 64)}... exceeds ${String(limits.max_path_length)} bytes`);
    }
    const parts = componentsOf(entry.name);
    if (parts === null || !staysInside(parts)) {
      return refuse("path-escapes-tree", `entry ${entry.name} is not contained to the tree`);
    }
    if (parts.some((part) => part === ".git")) {
      return refuse("dot-git-smuggled", `entry ${entry.name}: .git content is refused — it can configure git code execution`);
    }
    const key = parts.join("/");
    if (seen.has(key)) return refuse("duplicate-entry", `entry ${entry.name} appears twice`);
    seen.add(key);

    // Never write through a directory symlink placed earlier in the archive.
    let ancestor = "";
    for (const part of parts.slice(0, -1)) {
      ancestor = ancestor === "" ? part : `${ancestor}/${part}`;
      if (symlinkDirs.has(ancestor)) {
        return refuse("symlink-through-symlink", `entry ${entry.name} would write through symlink ${ancestor}`);
      }
    }

    const target = join(dest, ...parts);

    if (entry.typeflag === "5") {
      mkdirSync(target, { recursive: true });
      continue;
    }

    if (entry.typeflag === "2") {
      const linkParts = componentsOf(entry.linkname);
      const resolvedLexical = posix.normalize(
        parts.slice(0, -1).concat(linkParts ?? ["\0"]).join("/"),
      );
      if (
        linkParts === null ||
        entry.linkname.startsWith("/") ||
        !staysInside(resolvedLexical.split("/")) ||
        resolvedLexical.split("/").some((part) => part === ".git")
      ) {
        return refuse("symlink-escapes-tree", `symlink ${entry.name} -> ${entry.linkname} leaves the tree`);
      }
      mkdirSync(join(dest, ...parts.slice(0, -1)), { recursive: true });
      symlinkSync(entry.linkname, target);
      // a symlink occupying a directory slot poisons any later entry under it
      symlinkDirs.add(key);
      fileCount += 1;
      continue;
    }

    if (entry.typeflag === "1") return refuse("hardlink-refused", `entry ${entry.name}: hardlinks are refused`);
    if (entry.typeflag !== "0") {
      return refuse("special-file-refused", `entry ${entry.name}: typeflag ${entry.typeflag} is refused`);
    }

    if (entry.size > limits.max_file_bytes) {
      return refuse("file-too-large", `entry ${entry.name} is ${String(entry.size)} bytes (cap ${String(limits.max_file_bytes)})`);
    }
    totalBytes += entry.size;
    if (totalBytes > limits.max_total_bytes) {
      return refuse("archive-too-large", `archive exceeds ${String(limits.max_total_bytes)} bytes unpacked`);
    }
    fileCount += 1;
    if (fileCount > limits.max_files) {
      return refuse("too-many-files", `archive exceeds ${String(limits.max_files)} files`);
    }

    mkdirSync(join(dest, ...parts.slice(0, -1)), { recursive: true });
    writeFileSync(target, entry.data);
    // Read-only from here on: nothing the evaluator runs may modify the tree
    // between checks. Executable bit preserved so probes see git semantics.
    chmodSync(target, (entry.mode & 0o111) !== 0 ? 0o555 : 0o444);
  }

  return { refusal: null, fileCount };
};

/** Accepts raw tar or a zstd frame and returns the tar bytes. */
export const maybeDecompress = (bytes: Buffer): Buffer =>
  bytes.subarray(0, 4).equals(ZSTD_MAGIC) ? zstdDecompressSync(bytes) : bytes;

export const compressZstd = (bytes: Buffer): Buffer =>
  zstdCompressSync(bytes, {
    params: { [zstdConstants.ZSTD_c_compressionLevel]: ARCHIVE_ZSTD_LEVEL },
  });
