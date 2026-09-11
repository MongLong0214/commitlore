/**
 * The deciding artifact for reading a message's own trailer block from
 * `git log --format=%(trailers:...)` instead of one `git interpret-trailers`
 * process per message.
 *
 * SPEC §2.1 B3 and r-5a8c04 give git the last word on what a trailer block is;
 * nothing here loosens that. The question is narrower: are the two doors into
 * git's parser the same parser? `core/index-db.ts` has answered yes since the
 * index existed and reads every record through the atom. This file holds the
 * answer to evidence on two fronts:
 *
 * 1. Hazard cases built in a scratch repository — a `---` divider before and
 *    after the block, a last paragraph that is prose (B3), folded
 *    continuations (B4), a value carrying the atom's own separator bytes, an
 *    empty message, a subject-only message, CRLF, an empty value, and the
 *    multi-block shape of §2.4.
 * 2. This repository's whole history, every commit, exactly as
 *    `test/dogfood.test.ts` walks it. Any disagreement is reported with its
 *    sha and both outputs.
 *
 * The oracle on every case is `parseCommitMessage` — `interpret-trailers
 * --parse --no-divider` under the pinned separator — never a fixture written
 * by hand.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  SEPARATOR_PIN,
  TRAILERS_ATOM,
  atomIsAmbiguous,
  parseCommitMessage,
  parseRecordBlocks,
  parseRecordBlocksWithAtom,
  parseTrailersAtom,
  readTrailersAtom,
} from '../src/core/trailers.js';
import type { Trailer } from '../src/core/types.js';
import { createTestRepo } from './git-fixtures.js';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const UNIT = '';

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** sha -> message, and sha -> atom field, over one revision expression. */
const readBoth = (cwd: string, revision: string): Map<string, { message: string; atom: string }> => {
  const messages = git(cwd, ['log', '-z', `--format=%H${UNIT}%B`, '--end-of-options', revision]);
  const atoms = git(cwd, [
    ...SEPARATOR_PIN,
    'log',
    '-z',
    `--format=%H${UNIT}${TRAILERS_ATOM}`,
    '--end-of-options',
    revision,
  ]);
  const firstField = (chunk: string): [string, string] => {
    const at = chunk.indexOf(UNIT);
    return at === -1 ? [chunk, ''] : [chunk.slice(0, at), chunk.slice(at + 1)];
  };
  const byLog = new Map<string, { message: string; atom: string }>();
  for (const chunk of messages.split('\0')) {
    if (chunk === '') continue;
    const [sha, message] = firstField(chunk);
    byLog.set(sha, { message, atom: '' });
  }
  for (const chunk of atoms.split('\0')) {
    if (chunk === '') continue;
    const [sha, atom] = firstField(chunk);
    const entry = byLog.get(sha);
    if (entry === undefined) throw new Error(`atom walk saw ${sha} and the message walk did not`);
    entry.atom = atom;
  }
  return byLog;
};

/** What a reader built on the atom answers for the message's own block. */
const lastBlockViaAtom = (message: string, atom: string): Trailer[] =>
  atomIsAmbiguous(message) ? parseCommitMessage(message) : parseTrailersAtom(atom);

interface Disagreement {
  sha: string;
  message: string;
  viaProcess: unknown;
  viaAtom: unknown;
}

const disagreementsOver = (
  entries: Map<string, { message: string; atom: string }>,
): { raw: Disagreement[]; blocks: Disagreement[]; commits: number; ambiguous: number } => {
  const raw: Disagreement[] = [];
  const blocks: Disagreement[] = [];
  let ambiguous = 0;
  for (const [sha, { message, atom }] of entries) {
    if (atomIsAmbiguous(message)) ambiguous += 1;
    const viaProcess = parseCommitMessage(message);
    const viaAtom = lastBlockViaAtom(message, atom);
    if (JSON.stringify(viaProcess) !== JSON.stringify(viaAtom)) {
      raw.push({ sha, message, viaProcess, viaAtom });
    }
    // The block grammar only does work beyond the last paragraph when the
    // message names Record-Id more than once or outside its last paragraph;
    // everywhere else both readers are the single block just compared.
    if ((message.match(/record-id/gi) ?? []).length > 1 || !/record-id/i.test(message.split(/\n\n+/).at(-1) ?? '') && /record-id/i.test(message)) {
      const today = parseRecordBlocks(message);
      const withAtom = parseRecordBlocks(message, { last: viaAtom });
      if (JSON.stringify(today) !== JSON.stringify(withAtom)) {
        blocks.push({ sha, message, viaProcess: today, viaAtom: withAtom });
      }
    }
  }
  return { raw, blocks, commits: entries.size, ambiguous };
};

const render = (found: Disagreement[]): string =>
  found
    .map(
      (d) =>
        `${d.sha}\n  message: ${JSON.stringify(d.message)}\n  process: ${JSON.stringify(d.viaProcess)}\n  atom:    ${JSON.stringify(d.viaAtom)}`,
    )
    .join('\n');

// ---------------------------------------------------------------------------
// 1. Hazard cases
// ---------------------------------------------------------------------------

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Every message committed byte-for-byte (`--cleanup=verbatim`, stdin), no hook, no signing. */
const commitVerbatim = (dir: string, message: string): string => {
  const result = spawnSync(
    'git',
    [
      '-c', 'user.name=CommitLore Test',
      '-c', 'user.email=test@example.invalid',
      '-c', 'commit.gpgsign=false',
      'commit', '--allow-empty', '--allow-empty-message', '--no-verify', '--cleanup=verbatim', '-F', '-',
    ],
    { cwd: dir, shell: false, encoding: 'utf8', input: message },
  );
  if (result.status !== 0) throw new Error(`git commit failed: ${result.stderr}`);
  return git(dir, ['rev-parse', 'HEAD']).trim();
};

/** The cases the equivalence was doubted on. Each is the exact text committed. */
const HAZARDS: Record<string, string> = {
  'divider before the block': 'Subject\n\nBody prose.\n---\nnot: after a divider\n\nLimit: after the divider line\nRecord-Id: r-divider0001\n',
  'divider after the block': 'Subject\n\nLimit: before the divider line\nRecord-Id: r-divider0002\n---\nprose after the divider\n',
  'last paragraph is prose (B3), earlier block present (2.4)':
    'Subject\n\nLimit: the early decision\nRecord-Id: r-earlyblock1\n\nRecord-Id: r-notatrailer\nand this sentence continues the paragraph\n',
  'folded continuation lines (B4)':
    'Subject\n\nRuled-out: alpha | a reason that\n  continues on a second line\n\tand a tab-indented third\nRecord-Id: r-folded0001\n',
  'value carrying the atom separator bytes':
    'Subject\n\nLimit: has  record separator and  field separator inside\nRecord-Id: r-bytes00001\n',
  'value carrying other control bytes': 'Subject\n\nLimit: has  and  inside\nRecord-Id: r-bytes00002\n',
  'empty message': '',
  'subject only': 'Limit: a subject that looks like a trailer\n',
  'CRLF line endings': 'Subject\r\n\r\nLimit: crlf value\r\nRecord-Id: r-crlf000001\r\n',
  'empty value': 'Subject\n\nLimit:\nRecord-Id: r-emptyval01\n',
  'no space after the separator': 'Subject\n\nLimit:tight\nRecord-Id: r-tight00001\n',
  'space before the separator': 'Subject\n\nLimit : spaced\nRecord-Id: r-spaced0001\n',
  'trailer-shaped line followed by prose (B3)': 'Subject\n\nLimit: looks like one\nbut this line is prose\n',
  'body paragraph without identity (B2)': 'Subject\n\nContext: some\nSource: thing\n\nLimit: real\nRecord-Id: r-b2example1\n',
  'two record blocks (2.4)':
    'feat: squash\n\nLimit: the earlier decision\nRecord-Id: r-multi000001\n\nLimit: the later refinement\nRecord-Id: r-multi000002\nFollows: r-multi000001\n',
  'earlier block, unrelated subject between (bug-issue-60)':
    'Merge\n\nLimit: first\nRecord-Id: r-interleave1\n\nsecond commit subject\n\nLimit: second\nRecord-Id: r-interleave2\n',
  'unicode value': 'Subject\n\nLimit: 한국어 값 — ünïcode ✓\nRecord-Id: r-unicode001\n',
  'trailing blank lines': 'Subject\n\nLimit: trailing\nRecord-Id: r-trailing01\n\n\n',
  'conventional trailers only': 'Subject\n\nCo-authored-by: Someone <s@example.invalid>\nSigned-off-by: Someone <s@example.invalid>\n',
  'long value': `Subject\n\nLimit: ${'x'.repeat(4000)}\nRecord-Id: r-longvalue1\n`,
  'colon-space inside the value': 'Subject\n\nLimit: ratio is 3: 1 at peak\nRecord-Id: r-colonspace1\n',
  'continuation as the first line of the last paragraph': 'Subject\n\n  indented first line\nLimit: x\n',
  'comment-looking lines kept verbatim': 'Subject\n\n# not a comment after cleanup=verbatim\nLimit: x\nRecord-Id: r-hashline01\n',
};

describe('the trailers atom answers exactly as interpret-trailers on the hazard cases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-atom-'));
  scratch.push(dir);
  createTestRepo({ path: dir });
  const shaByCase = new Map<string, string>();
  for (const [name, message] of Object.entries(HAZARDS)) shaByCase.set(name, commitVerbatim(dir, message));
  const entries = readBoth(dir, 'HEAD');

  it.each([...shaByCase.entries()])('%s', (name, sha) => {
    const entry = entries.get(sha);
    expect(entry, `the walk did not return ${name}`).toBeDefined();
    if (entry === undefined) return;
    const viaProcess = parseCommitMessage(entry.message);
    const viaAtom = lastBlockViaAtom(entry.message, entry.atom);
    expect(viaAtom, `own block — process vs atom for ${JSON.stringify(entry.message)}`).toEqual(viaProcess);
    expect(parseRecordBlocks(entry.message, { last: viaAtom })).toEqual(parseRecordBlocks(entry.message));
  });

  it('routes a value carrying the separator bytes to the process, not the atom', () => {
    const sha = shaByCase.get('value carrying the atom separator bytes') ?? '';
    const entry = entries.get(sha);
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(atomIsAmbiguous(entry.message)).toBe(true);
    // The raw atom output really is unframeable here — which is the reason the
    // guard exists, not a fault in the parser.
    expect(parseTrailersAtom(entry.atom)).not.toEqual(parseCommitMessage(entry.message));
  });

  it('readTrailersAtom returns the same field for every commit of the walk', () => {
    // The production walk, not this file's own: a walk that failed would hand
    // every reader an empty map and every reader would quietly fall back to
    // the process, which no other assertion here could tell from success.
    const viaReader = readTrailersAtom(['--end-of-options', 'HEAD'], { cwd: dir });
    expect(viaReader.size).toBe(entries.size);
    for (const [sha, entry] of entries) expect(viaReader.get(sha), sha).toBe(entry.atom);
  });

  it('parseRecordBlocksWithAtom answers as parseRecordBlocks on every case', () => {
    for (const [sha, entry] of entries) {
      expect(parseRecordBlocksWithAtom(entry.message, entry.atom), sha).toEqual(parseRecordBlocks(entry.message));
    }
    // And with no atom at all it is parseRecordBlocks, byte for byte.
    const [first] = entries.values();
    expect(first && parseRecordBlocksWithAtom(first.message, undefined)).toEqual(first && parseRecordBlocks(first.message));
  });

  it('reads the divider cases with --no-divider semantics on both doors', () => {
    const before = entries.get(shaByCase.get('divider before the block') ?? '');
    const after = entries.get(shaByCase.get('divider after the block') ?? '');
    expect(before && parseTrailersAtom(before.atom)).toEqual([
      { key: 'Limit', value: 'after the divider line' },
      { key: 'Record-Id', value: 'r-divider0001' },
    ]);
    expect(after && parseTrailersAtom(after.atom)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. This repository, every commit
// ---------------------------------------------------------------------------

const isShallow = (): boolean => {
  try {
    return git(REPO_ROOT, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  } catch {
    return true;
  }
};

describe('the trailers atom answers exactly as interpret-trailers over this repository', () => {
  it.skipIf(isShallow())('disagrees on no commit reachable from HEAD', () => {
    const entries = readBoth(REPO_ROOT, 'HEAD');
    const result = disagreementsOver(entries);
    expect(result.commits).toBeGreaterThan(0);
    // A history in which every message carried a separator byte would route
    // every commit to the process and prove nothing about the atom.
    expect(result.commits - result.ambiguous, 'commits the atom was consulted for').toBeGreaterThan(0);
    expect(result.raw, `own block disagreements over ${result.commits} commits:\n${render(result.raw)}`).toEqual([]);
    expect(result.blocks, `record block disagreements over ${result.commits} commits:\n${render(result.blocks)}`).toEqual([]);
    // The oracle side is one process per commit — the cost this file exists to
    // retire — so the walk takes ~20s on a laptop at 1500 commits and sat on
    // the default limit; a loaded machine took three times that.
  }, 180_000);
});
