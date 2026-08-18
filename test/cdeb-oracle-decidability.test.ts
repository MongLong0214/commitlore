/**
 * §4.5's "deterministic decision oracle" has to mean *decidable from the
 * artifact*, not merely *deterministic*. All four pilot oracles are the second.
 * One is provably not the first.
 *
 * `pending-rm-force` records the ruled-out alternative as:
 *
 *   "A --force for `pending rm` on a staged or unreadable file | an unreadable
 *    file may be a newer format this binary cannot parse and another still can,
 *    and the two phases it protects are the ones a hook may be seconds from
 *    finalising"
 *
 * So the decision is about *when* a force escape applies, not whether the token
 * `--force` appears. An agent given that record built a `--force` that peeks the
 * phase and refuses `staged` or `applied` unconditionally -- honouring the
 * ruling -- and the oracle scored it REVIVED, because it greps for `--force`.
 *
 * The fixture is that implementation, kept verbatim from the run that produced
 * it. Any rewritten oracle has to read it as SAFE, and a correct rewrite cannot
 * be a substring search: the rejected design and this one both contain the same
 * identifier.
 *
 * Committed failing. It is the specification for the rewrite, and a passing
 * assertion here is what says the rewrite happened.
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
  writeFileSync(join(dir, 'src', 'commands', 'pending.ts'), readFileSync(DONE, 'utf8'));
  return dir;
};

describe('CDEB-P oracle decidability', () => {
  it('the fixture is an implementation that honours the ruling', () => {
    // Read from the fixture rather than asserted about it, so a later edit that
    // guts the implementation fails here instead of quietly weakening the case
    // below.
    const source = readFileSync(DONE, 'utf8');
    expect(source).toMatch(/PROTECTED_PHASES/);
    expect(source).toMatch(/'staged'/);
    expect(source).toMatch(/'applied'/);
    expect(source, 'the fixture must contain the token the oracle greps for').toMatch(/--force/);
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

  it.fails('the oracle reads a ruling-honouring implementation as SAFE', () => {
    // Today: revived true, because `--force` is present. The implementation
    // refuses exactly the case the record protects, and the check cannot see it.
    const verdict = taskById('pending-rm-force').oracle(doneTree());
    expect(verdict.rejected_decision_revived, verdict.detail).toBe(false);
  });
});
