/**
 * #1020: a divergent mirror withholds the axes that diverged, not the record.
 *
 * A `Record-Id` declared in both a commit message and its note, where the two
 * differ at all, made every axis of the record `[blocked]`. The reporter lost
 * every `Limit:`, `Ruled-out:` and `Warn:` on the **only** record covering the
 * file they were about to edit — and what had actually diverged was two
 * metadata lines: the note had dropped `Undo: easy` and folded a repeated
 * `Certainty: firm`. The content axes were byte-identical in both declarations.
 *
 * They read the record with `git log` instead, and found a `Ruled-out:` for the
 * alternative they were about to try again. Trusting the tool alone would have
 * meant redoing a rejected approach — which is the one failure this project
 * exists to prevent, arriving through the safety mechanism.
 *
 * ## Why narrowing is safe
 *
 * The rule the whole-record block exists for is `r-refint74`: notes are
 * remote-reachable, so divergent note content must not inherit an identity a
 * human approved. That holds per key. Where every declaration carries the same
 * values under a key, the commit message a human approved says exactly that, and
 * withholding it protects nothing.
 *
 * ## What is deliberately still withheld whole
 *
 * An ambiguity that is not a mirror divergence — two records sharing one commit,
 * or two declared in the same second — is ambiguous about *which record this
 * identity names*. There is no per-key answer to give, so those keep the old
 * behaviour, and `divergentIdKeys` returns an empty set for them.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runQuery } from '../src/core/query.js';

const temporaries: string[] = [];
afterAll(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = [
  '-c',
  'user.name=CommitLore Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
];

const git = (dir: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });

const LIMIT = 'the harness accepts one named test per mutation row';
const RULED_OUT = 'taking a real tool census here | it needs a probe child';
const WARN = 'keep the slot under the receiving identity';

/**
 * A commit whose note mirrors it, with `note` deciding what the mirror says.
 *
 * The note is written by hand rather than through `squash-preserve`, because
 * what is under test is how a *divergence* is reported and this build's writer
 * does not produce one — `serializeTrailers` round-trips a repeated key and an
 * `Undo:` without loss. How the reporter's note came to drop them is not
 * reproducible here and is not what this pins.
 */
const repoWithMirror = (note: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-collide-'));
  temporaries.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main']);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'realm.ts'), 'export const a = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, [
    ...IDENTITY,
    'commit',
    '-q',
    '--no-verify',
    '-m',
    `feat: realm\n\nprose\n\nLimit: ${LIMIT}\nRuled-out: ${RULED_OUT}\nWarn: ${WARN}\n` +
      'Blast: local\nUndo: easy\nCertainty: firm\nRecord-Id: r-collide00001\n',
  ]);
  git(dir, [
    ...IDENTITY,
    'notes',
    '--ref=refs/notes/commitlore',
    'add',
    '-f',
    '-m',
    note,
    git(dir, ['rev-parse', 'HEAD']).trim(),
  ]);
  return dir;
};

const valuesFor = (dir: string, key: string): string[] =>
  runQuery({ cwd: dir, paths: ['src/realm.ts'] })
    .records.flatMap((record) => record.trailers)
    .filter((trailer) => trailer.key === key)
    .map((trailer) => trailer.value);

/**
 * A squash merge as a forge composes one: two records folded into a single
 * trailer paragraph in the message, and one blank-line-separated block per
 * record on the notes ref.
 *
 * The framing difference is not hypothetical and is not commitlore's doing. On
 * the reported commit the committer is `GitHub <noreply@github.com>`: the forge
 * wrote the message, `writeRecordBlocks` wrote the note, and only one of them
 * frames blocks. `renderMessage` frames them correctly when it is the writer,
 * which was checked before blaming it.
 */
const repoWithFoldedMessage = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'commitlore-folded-'));
  temporaries.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main']);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'realm.ts'), 'export const a = 1;\n');
  git(dir, ['add', '-A']);
  // One paragraph, two records -- what git hands back as a single block.
  git(dir, [
    ...IDENTITY,
    'commit',
    '-q',
    '--no-verify',
    '-m',
    `feat: realm\n\nprose\n\nLimit: ${LIMIT}\nBlast: local\nRecord-Id: r-folded00001\n` +
      `Warn: ${WARN}\nUndo: easy\nRecord-Id: r-folded00002\n`,
  ]);
  // Two paragraphs, one record each -- what writeRecordBlocks puts on the ref.
  git(dir, [
    ...IDENTITY,
    'notes',
    '--ref=refs/notes/commitlore',
    'add',
    '-f',
    '-m',
    `Limit: ${LIMIT}\nBlast: local\nRecord-Id: r-folded00001\n\n` +
      `Warn: ${WARN}\nUndo: easy\nRecord-Id: r-folded00002\n`,
    git(dir, ['rev-parse', 'HEAD']).trim(),
  ]);
  return dir;
};

describe('#1116 a note block that is one record of a folded message is not a rival', () => {
  it('serves every axis when neither declaration contradicts the other', () => {
    // The reported symptom: both note blocks are exact subsets of the folded
    // message block, nothing disagrees, and the axes a reader needs before
    // editing were withheld anyway.
    const dir = repoWithFoldedMessage();

    // `toContain` rather than `toEqual`: the second record is served from both
    // channels and so arrives twice. That duplication has the same root as the
    // withholding -- `groupsByRecordId` keys a block on the one `Record-Id`
    // `trailerValue` picks, so the folded message groups under the first and
    // the note block declaring the second has no sibling to merge with. It is
    // a separate defect, it predates this fix, and it is recorded rather than
    // quietly absorbed into an assertion.
    expect(valuesFor(dir, 'Limit')).toContain(LIMIT);
    expect(valuesFor(dir, 'Warn')).toContain(WARN);
    expect(valuesFor(dir, 'Undo')).toContain('easy');
  }, 300_000);

  it('says nothing about a withheld key, because nothing is withheld', () => {
    const dir = repoWithFoldedMessage();

    expect(runQuery({ cwd: dir, paths: ['src/realm.ts'] }).diagnostics.join('\n')).not.toContain(
      'withheld',
    );
  }, 300_000);

  it('still withholds when a folded message and its note actually disagree', () => {
    // The control. Forgiving a component must not become forgiving a
    // contradiction -- r-peraxiscollision1020 rules out serving both values,
    // and this keeps that: the divergent key is withheld, not offered twice.
    const dir = mkdtempSync(join(tmpdir(), 'commitlore-folded-bad-'));
    temporaries.push(dir);
    git(dir, ['init', '-q', '--initial-branch=main']);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'realm.ts'), 'export const a = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, [
      ...IDENTITY,
      'commit',
      '-q',
      '--no-verify',
      '-m',
      `feat: realm\n\nprose\n\nLimit: ${LIMIT}\nUndo: easy\nRecord-Id: r-folded00001\n` +
        `Warn: ${WARN}\nRecord-Id: r-folded00002\n`,
    ]);
    git(dir, [
      ...IDENTITY,
      'notes',
      '--ref=refs/notes/commitlore',
      'add',
      '-f',
      '-m',
      `Limit: ${LIMIT}\nUndo: costly\nRecord-Id: r-folded00001\n`,
      git(dir, ['rev-parse', 'HEAD']).trim(),
    ]);

    expect(valuesFor(dir, 'Undo')).toEqual([]);
    expect(runQuery({ cwd: dir, paths: ['src/realm.ts'] }).diagnostics.join('\n')).toContain(
      'withheld',
    );
  }, 300_000);
});

describe('#1020 a divergent mirror blocks only the keys that diverged', () => {
  /** The reported shape: the content axes agree, `Undo:` is missing from the note. */
  const DROPPED_UNDO =
    `Limit: ${LIMIT}\nRuled-out: ${RULED_OUT}\nWarn: ${WARN}\n` +
    'Blast: local\nCertainty: firm\nRecord-Id: r-collide00001\n';

  it('serves the axes both declarations agree on', () => {
    const dir = repoWithMirror(DROPPED_UNDO);

    // The three that matter, and the ones the reporter lost entirely.
    expect(valuesFor(dir, 'Limit')).toEqual([LIMIT]);
    expect(valuesFor(dir, 'Ruled-out')).toEqual([RULED_OUT]);
    expect(valuesFor(dir, 'Warn')).toEqual([WARN]);
  }, 300_000);

  it('withholds the key that actually diverged', () => {
    // The control on the other side: a narrowing that served everything would
    // pass the case above and give back the divergent value too.
    const dir = repoWithMirror(DROPPED_UNDO);
    expect(valuesFor(dir, 'Undo')).toEqual([]);
  }, 300_000);

  it('says which side to read, rather than leaving the reader to find out', () => {
    const dir = repoWithMirror(DROPPED_UNDO);
    const said = runQuery({ cwd: dir, paths: ['src/realm.ts'] }).diagnostics.join('\n');

    expect(said).toContain('refs/notes/commitlore');
    expect(said).toContain('git log');
    expect(said).toContain('git notes');
  }, 300_000);

  it('withholds a content axis when that is what diverged', () => {
    // The security property, unchanged: a note that changes what a record says
    // does not get to say it. Only the axis it changed is withheld — the rest
    // of the record is still the one a human approved.
    const changedLimit =
      'Limit: a different constraint the commit never carried\n' +
      `Ruled-out: ${RULED_OUT}\nWarn: ${WARN}\n` +
      'Blast: local\nUndo: easy\nCertainty: firm\nRecord-Id: r-collide00001\n';
    const dir = repoWithMirror(changedLimit);

    expect(valuesFor(dir, 'Limit'), 'a divergent Limit was served').toEqual([]);
    expect(valuesFor(dir, 'Ruled-out')).toEqual([RULED_OUT]);
    expect(valuesFor(dir, 'Warn')).toEqual([WARN]);
  }, 300_000);

  it('leaves an undivergent mirror completely alone', () => {
    // The premise. Without it, "the axes are served" above could describe a
    // build that had stopped detecting collisions at all.
    const identical =
      `Limit: ${LIMIT}\nRuled-out: ${RULED_OUT}\nWarn: ${WARN}\n` +
      'Blast: local\nUndo: easy\nCertainty: firm\nRecord-Id: r-collide00001\n';
    const dir = repoWithMirror(identical);

    expect(valuesFor(dir, 'Limit')).toEqual([LIMIT]);
    expect(valuesFor(dir, 'Undo')).toEqual(['easy']);
    expect(runQuery({ cwd: dir, paths: ['src/realm.ts'] }).diagnostics.join('\n')).not.toContain(
      'withheld',
    );
  }, 300_000);
});
