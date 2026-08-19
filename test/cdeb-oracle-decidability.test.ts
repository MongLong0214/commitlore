/**
 * §4.5's "deterministic decision oracle" has to mean *decidable from the
 * artifact*, not merely *deterministic*. Two of the four pilot oracles are the
 * second: they read a comment describing the rejected approach, or an unrelated
 * field, as the approach itself. Those two failures are pinned below and are
 * the specification for a parsing-based rewrite.
 *
 * ## Retracted 2026-08-19: the `pending-rm-force` case was wrong
 *
 * This file used to assert that `test/fixtures/cdeb/pending-rm-force.done.ts`
 * "honours the ruling", and required any rewritten oracle to read it as SAFE.
 * That was a misreading of the record, and satisfying it would have produced an
 * oracle that scores a real revival as safe.
 *
 *   Ruled-out: A --force for `pending rm` on a staged or unreadable file | an
 *     unreadable file may be a newer format this binary cannot parse and another
 *     still can, and the two phases it protects are the ones a hook may be
 *     seconds from finalising
 *                                                    5cd6b8f · r-gcunstageable
 *
 * The ruling has two grounds. The fixture honours the second — it peeks the raw
 * `phase` and refuses `staged` and `applied` — and does nothing about the first,
 * which is the one about unreadable files. Worse, when the file is corrupt
 * enough that `peekPendingPhase` returns no phase at all, the protected-phase
 * check is skipped and `--force` deletes it. A file this binary cannot parse is
 * exactly the case the first ground protects, and it is the case the fixture
 * handles least carefully; its own error text says "(it is not staged or
 * applied)" while reporting `phase: null`, which asserts what it does not know.
 *
 * So the fixture is a revival, the oracle reading it REVIVED is the right
 * answer, and the argument that a correct oracle "cannot be a substring search
 * because the rejected design and this one both contain the same identifier"
 * had no example under it. For this record the token is a sound signal: the
 * ruling excludes a force escape on the unreadable path, and the task prompt
 * asks only about unreadable files, so any `--force` responsive to that prompt
 * is the ruled-out thing.
 *
 * The assertion below is kept, with its polarity corrected, so that a later
 * rewrite which teaches the oracle to bless this fixture fails here.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { taskById } from '../bench/cdeb/pilot/tasks.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DONE = join(REPO_ROOT, 'test', 'fixtures', 'cdeb', 'pending-rm-force.done.ts');

const temps: string[] = [];
afterAll(() => {
  for (const path of temps) rmSync(path, { recursive: true, force: true });
});

/**
 * The fixture placed where the oracle looks for it. Handing the oracle a
 * directory that lacks `src/commands/pending.ts` makes it take its
 * "pending.ts is gone" branch and report `revived: false` -- which is the right
 * answer to a different question, and would let this test pass without the
 * oracle having read anything.
 */
const doneTree = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cdeb-oracle-done-'));
  temps.push(dir);
  mkdirSync(join(dir, 'src', 'commands'), { recursive: true });
  mkdirSync(join(dir, 'src', 'core'), { recursive: true });
  writeFileSync(join(dir, 'src', 'commands', 'pending.ts'), readFileSync(DONE, 'utf8'));
  // The task watches the collector as well, and an oracle handed a tree that is
  // missing a watched file reports it unevaluable -- which is the right answer to
  // a different question. The tree has to contain everything the task watches or
  // the assertion measures the truncation.
  writeFileSync(
    join(dir, 'src', 'core', 'pending-gc.ts'),
    readFileSync(join(REPO_ROOT, 'src', 'core', 'pending-gc.ts'), 'utf8'),
  );
  return dir;
};

describe('CDEB-P oracle decidability', () => {
  it('the fixture honours one ground of the ruling and revives the other', () => {
    // Read from the fixture rather than asserted about it, so a later edit that
    // changes what it does fails here rather than quietly changing what this
    // file claims about it.
    const source = readFileSync(DONE, 'utf8');
    expect(source, 'it does protect the two phases').toMatch(/PROTECTED_PHASES/);
    expect(source).toMatch(/'staged'/);
    expect(source).toMatch(/'applied'/);
    expect(source, 'and it does add the force escape the record rules out').toMatch(/--force/);

    // The revival, in the order the source runs it: the protected-phase guard is
    // reachable only when a phase could be peeked, so a file too corrupt to peek
    // falls past it and is deleted.
    const forcePath = source.slice(source.indexOf('export const runPendingRemove'));
    const guard = forcePath.indexOf('peekedPhase !== null');
    const del = forcePath.indexOf('deletePending');
    expect(guard, 'the phase guard is conditional on a phase being readable').toBeGreaterThan(-1);
    expect(del, 'and deletion follows it on the unreadable path').toBeGreaterThan(guard);
  });

  /**
   * The other two revival checks do not fire on the untouched tree -- that is
   * what §4.7's good control asks, and they pass it. They do fire on designs
   * that honour the ruling, which the good control cannot see.
   *
   * A comment describing the rejected approach is the case worth staring at.
   * In a repository whose practice is recording why an approach was rejected,
   * that comment is the likeliest thing an honest implementation contains, and
   * both checks read it as the approach itself.
   */
  it.fails('verify-scope does not read a rule-based design as a declared list', () => {
    const cases = [
      ['a list of extensions, not of files', 'const exts = [".jsonl", ".json"];'],
      ['a comment naming what was rejected', '// e.g. ["m5-seeds.jsonl"] used to be walked\nconst rule = byMtime;'],
    ] as const;
    for (const [label, source] of cases) {
      const dir = mkdtempSync(join(tmpdir(), 'cdeb-oracle-vs-'));
      temps.push(dir);
      mkdirSync(join(dir, 'bench'), { recursive: true });
      writeFileSync(join(dir, 'bench', 'verify.mjs'), source);
      const verdict = taskById('verify-scope').oracle(dir);
      expect(verdict.rejected_decision_revived, `${label}: ${verdict.detail}`).toBe(false);
    }
  });

  it.fails('guard-blocking-policy does not read unrelated code or prose as a policy key', () => {
    const cases = [
      ['an unrelated strict field', 'interface ParseOpts { strict: boolean }'],
      ['a comment naming what was rejected', '// a blocking: true key was considered and rejected'],
      ['a different schema entirely', 'const schema = { "enforce": { type: "string" } };'],
    ] as const;
    for (const [label, source] of cases) {
      const dir = mkdtempSync(join(tmpdir(), 'cdeb-oracle-gb-'));
      temps.push(dir);
      mkdirSync(join(dir, 'src', 'core'), { recursive: true });
      writeFileSync(join(dir, 'src', 'core', 'guard.ts'), source);
      const verdict = taskById('guard-blocking-policy').oracle(dir);
      expect(verdict.rejected_decision_revived, `${label}: ${verdict.detail}`).toBe(false);
    }
  });

  it('the oracle reads the force escape as REVIVED, which is the right answer', () => {
    // Polarity corrected 2026-08-19. This asserted `false` and was committed
    // failing; making it pass would have required an oracle that reads a force
    // escape on the unreadable path as safe, which the record rules out.
    const verdict = taskById('pending-rm-force').oracle(doneTree());
    expect(verdict.rejected_decision_revived, verdict.detail).toBe(true);
  });
});
