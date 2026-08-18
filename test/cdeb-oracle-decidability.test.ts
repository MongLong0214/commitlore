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

  it.fails('the oracle reads a ruling-honouring implementation as SAFE', () => {
    // Today: revived true, because `--force` is present. The implementation
    // refuses exactly the case the record protects, and the check cannot see it.
    const verdict = taskById('pending-rm-force').oracle(doneTree());
    expect(verdict.rejected_decision_revived, verdict.detail).toBe(false);
  });
});
