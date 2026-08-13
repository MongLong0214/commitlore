/**
 * CDEB-06: the candidate archive is UNTRUSTED INPUT. These tests feed the
 * ingest hygiene gate real archive bytes — not mocks of attacks, the attacks
 * themselves — and assert the refusal code that stops each one.
 *
 * Two byte sources, deliberately:
 *
 *   - entries the freeze-side writer can express (`.git` paths, escaping
 *     symlinks, writes through symlinks) are built with `renderArchive`,
 *     the same writer the freeze uses;
 *   - shapes the writer itself refuses to serialize (path traversal,
 *     hardlinks, device nodes, pax headers, duplicates) are built here as
 *     hand-made ustar headers with valid checksums, because an attacker's
 *     tar is not produced by our writer. The writer's refusal is the first
 *     control; the ingest gate must hold against bytes it did not make.
 *
 * Every refusal is also a verdict: the engine turns it into functional FAIL
 * (§13 intention-to-treat), asserted end-to-end for two representative
 * attacks below.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, expect, it } from 'vitest';

import { describeZstd as describe } from './cdeb-zstd.ts';

import { extractTreeArchive, renderArchive, type ArchiveEntry } from '../bench/cdeb/evaluator/tree.ts';
import { ingestFinalTree } from '../bench/cdeb/evaluator/ingest.ts';
import { evaluateLocal, type LocalEvaluationResult } from '../bench/cdeb/evaluator/runner-local.ts';
import { DEFAULT_INGEST_LIMITS, type IngestRefusalCode } from '../bench/cdeb/evaluator/types.ts';
import {
  SEALED_DIR,
  TASK_ID,
  TEST_IMAGE_DIGEST,
  cleanupScratch,
  expectVerdict,
  prepareRun,
  buildTree,
  fixtureFile,
  tempDir,
} from './cdeb-evaluator-helpers.ts';

afterAll(() => {
  cleanupScratch();
});

/* ------------------------- hand-made ustar bytes ------------------------- */

const BLOCK = 512;

const ustarHeader = (fields: {
  name: string;
  size?: number;
  mode?: number;
  typeflag?: string;
  linkname?: string;
}): Buffer => {
  const header = Buffer.alloc(BLOCK);
  header.write(fields.name, 0, 'utf8');
  const writeOctal = (value: number, offset: number, width: number): void => {
    header.write(value.toString(8).padStart(width - 1, '0'), offset, 'ascii');
  };
  writeOctal(fields.mode ?? 0o644, 100, 8);
  writeOctal(0, 108, 8); // uid — zeroed, like the freeze side
  writeOctal(0, 116, 8); // gid
  writeOctal(fields.size ?? 0, 124, 12);
  writeOctal(0, 136, 12); // mtime — zeroed
  header.write(fields.typeflag ?? '0', 156, 'ascii');
  if (fields.linkname !== undefined) header.write(fields.linkname, 157, 'utf8');
  header.write('ustar', 257, 'ascii');
  header.write('00', 263, 'ascii');
  header.fill(0x20, 148, 156); // checksum field counts as spaces while summing
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0'), 148, 'ascii');
  header.writeUInt8(0, 154);
  header.writeUInt8(0x20, 155);
  return header;
};

const rawFileEntry = (name: string, content: string, extra?: Partial<{ mode: number }>): Buffer => {
  const data = Buffer.from(content, 'utf8');
  const header = ustarHeader({ name, size: data.length, mode: extra?.mode ?? 0o644 });
  const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
  return Buffer.concat([header, data, Buffer.alloc(pad)]);
};

const rawSpecialEntry = (name: string, typeflag: string, linkname?: string): Buffer =>
  ustarHeader({ name, typeflag, linkname });

const archiveOf = (...entries: readonly Buffer[]): Buffer =>
  Buffer.concat([...entries, Buffer.alloc(BLOCK * 2)]);

const file = (path: string, content = ''): ArchiveEntry => ({
  path,
  type: 'file',
  content: Buffer.from(content, 'utf8'),
  linkTarget: '',
  executable: false,
});

/* ------------------------------ the gate -------------------------------- */

const expectRefusal = (archive: Buffer, code: IngestRefusalCode, limits = DEFAULT_INGEST_LIMITS): void => {
  const result = extractTreeArchive(archive, tempDir(`ingest-${code}`), limits);
  expect(result.refusal, `expected refusal ${code}`).not.toBeNull();
  expect(result.refusal?.code).toBe(code);
};

describe('CDEB-06 ingest gate: hostile archive shapes are refused', () => {
  it('path traversal is refused', () => {
    expectRefusal(archiveOf(rawFileEntry('../evil.txt', 'escaped')), 'path-escapes-tree');
    expectRefusal(archiveOf(rawFileEntry('a/../../evil.txt', 'escaped')), 'path-escapes-tree');
  });

  it('absolute paths are refused', () => {
    expectRefusal(archiveOf(rawFileEntry('/etc/passwd', 'x')), 'path-escapes-tree');
  });

  it('.git smuggling is refused — git config is a code-execution surface', () => {
    expectRefusal(renderArchive([file('.git/config', '[core]\n\tfsmonitor = true\n')]), 'dot-git-smuggled');
    expectRefusal(renderArchive([file('nested/.git/hooks/pre-commit', '#!/bin/sh\n')]), 'dot-git-smuggled');
  });

  it('symlinks that leave the tree are refused', () => {
    const absolute: ArchiveEntry = { path: 'link', type: 'symlink', content: Buffer.alloc(0), linkTarget: '/etc/passwd', executable: false };
    expectRefusal(renderArchive([absolute]), 'symlink-escapes-tree');
    const relative: ArchiveEntry = { path: 'link', type: 'symlink', content: Buffer.alloc(0), linkTarget: '../../../etc/passwd', executable: false };
    expectRefusal(renderArchive([relative]), 'symlink-escapes-tree');
  });

  it('writes through a directory symlink are refused', () => {
    // `sub -> src` stays inside the tree lexically, but a later entry under
    // `sub/` lands somewhere the entry list does not name.
    const link: ArchiveEntry = { path: 'sub', type: 'symlink', content: Buffer.alloc(0), linkTarget: 'src', executable: false };
    expectRefusal(renderArchive([link, file('sub/payload.txt', 'written elsewhere')]), 'symlink-through-symlink');
  });

  it('hardlinks are refused', () => {
    expectRefusal(archiveOf(rawSpecialEntry('link', '1', 'src/calc.js')), 'hardlink-refused');
  });

  it('device nodes are refused', () => {
    expectRefusal(archiveOf(rawSpecialEntry('dev', '3')), 'special-file-refused');
  });

  it('pax/gnu extension headers are refused', () => {
    expectRefusal(archiveOf(rawSpecialEntry('PaxHeader/x', 'x')), 'pax-or-gnu-extension-refused');
  });

  it('duplicate entries are refused', () => {
    expectRefusal(archiveOf(rawFileEntry('a.txt', 'first'), rawFileEntry('a.txt', 'second')), 'duplicate-entry');
  });

  it('non-ustar bytes are refused as invalid tar', () => {
    // A full block of garbage fails the magic check; a truncated archive
    // shorter than one block parses as zero entries and is refused too.
    expectRefusal(Buffer.alloc(BLOCK, 'x'), 'invalid-tar');
    expectRefusal(Buffer.from('this is not a tar archive at all'), 'invalid-tar');
  });

  it('size and count limits are enforced', () => {
    const twoFiles = archiveOf(rawFileEntry('a.txt', 'aa'), rawFileEntry('b.txt', 'bb'));
    expectRefusal(twoFiles, 'too-many-files', { ...DEFAULT_INGEST_LIMITS, max_files: 1 });
    expectRefusal(archiveOf(rawFileEntry('big.txt', 'x'.repeat(64))), 'file-too-large', {
      ...DEFAULT_INGEST_LIMITS,
      max_file_bytes: 16,
    });
    expectRefusal(archiveOf(rawFileEntry('a.txt', 'x'.repeat(64))), 'archive-too-large', {
      ...DEFAULT_INGEST_LIMITS,
      max_total_bytes: 16,
    });
    // ustar's 100-byte name field bounds what one entry can spell, so the
    // path-length cap is exercised at a limit below that bound; the cap is
    // the defense for any format that could ever carry longer names.
    const longName = `${'d'.repeat(47)}/${'f'.repeat(47)}.txt`;
    expectRefusal(archiveOf(rawFileEntry(longName, 'x')), 'path-too-long', {
      ...DEFAULT_INGEST_LIMITS,
      max_path_length: 90,
    });
  });

  it('an oversized compressed archive is refused before decompression', () => {
    const tree = buildTree('oversized', {});
    const run = prepareRun('oversized', tree);
    const archive = readFileSync(run.archivePath);
    const ingested = ingestFinalTree(archive, tempDir('oversized-ingest'), { maxArchiveBytes: 10 });
    expect(ingested.refusal?.code).toBe('archive-too-large');
  });
});

describe('CDEB-06 ingest gate: refusals become FAIL verdicts end-to-end', () => {
  const judgeArchive = (archive: Buffer, label: string): LocalEvaluationResult => {
    const archivePath = join(tempDir(label), 'final-tree.tar.zst');
    writeFileSync(archivePath, archive);
    return evaluateLocal({
      tasksDir: SEALED_DIR,
      taskId: TASK_ID,
      archivePath,
      imageDigest: TEST_IMAGE_DIGEST,
    });
  };

  it('a .git-smuggling tree is judged FAIL by the pinned entrypoint', () => {
    const archive = renderArchive([
      file('src/calc.js', fixtureFile('patches/good/calc.js')),
      file('.git/config', '[core]\n'),
    ]);
    const result = judgeArchive(archive, 'e2e-dotgit');
    expect(result.exitCode).toBe(0);
    const verdict = expectVerdict(result);
    expect(verdict.functional_pass).toBe(false);
    expect(verdict.functional_checks.passed).toBe(0);
    expect(verdict.functional_checks.failed).toBe(1);
  });

  it('a hand-made traversal archive is judged FAIL by the pinned entrypoint', () => {
    const archive = archiveOf(
      rawFileEntry('src/calc.js', fixtureFile('patches/good/calc.js')),
      rawFileEntry('../evil.txt', 'escaped'),
    );
    const result = judgeArchive(archive, 'e2e-traversal');
    expect(result.exitCode).toBe(0);
    const verdict = expectVerdict(result);
    expect(verdict.functional_pass).toBe(false);
    expect(verdict.functional_checks.passed).toBe(0);
    expect(verdict.functional_checks.failed).toBe(1);
  });
});
