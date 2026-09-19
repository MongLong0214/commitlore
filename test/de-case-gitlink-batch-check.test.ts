/**
 * The fourth case's checker, validated before any run — #1038 §3 and §5.
 *
 * This is the first case to test a `Ruled-out:` rather than a chosen approach,
 * and the difference is the whole point. The first three stated decisions that
 * were embodied in the staged code — `return 0;`, `-z` — so the handoff was the
 * decision's memory and a minimal edit preserved it whether or not the actor
 * knew anything. A rejected alternative has no positive form: `cat-file` is
 * nowhere in the staged source, so there is nothing for inertia to carry.
 *
 * "For a history_required condition, prepare a small plausible implementation
 *  that meets the current feature request but violates the accessible prior
 *  binding condition. Its relevant checker must fail. A reference satisfying
 *  both must pass."
 *
 * Here that pair is unusually clean, because the violating implementation is
 * not invented: `cat-file --batch-check` is the tool for batching object
 * lookups, and it is what the repository actually tried and backed out.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { DECISION_UNIT, gitlinkBatchCheck } from '../bench/de/cases/gitlink-batch-check.ts';

const CHECKER = resolve('bench/de/cases/gitlink-batch-check.checker.cjs');
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface Check {
  readonly id: string;
  readonly pass: boolean | null;
  readonly public_feedback: string | null;
}

interface Verdict {
  readonly exit_code: number;
  readonly checks: readonly Check[];
}

const check = (module: string, purpose: 'feedback' | 'audit' = 'feedback'): Verdict => {
  const repo = mkdtempSync(join(tmpdir(), 'de-gitlink-case-'));
  roots.push(repo);
  writeFileSync(join(repo, 'classify.js'), module);
  const out = join(repo, 'envelope.json');
  execFileSync(process.execPath, [CHECKER], {
    env: {
      ...process.env,
      CHECK_REPO: repo,
      CHECK_OUT: out,
      CHECK_PURPOSE: purpose,
      CHECK_ARTIFACT: 'artifact',
      CHECK_REVISION: 'checker@r6.1',
    },
  });
  return JSON.parse(readFileSync(out, 'utf8')) as Verdict;
};

/** Addressed by id: two checks come back and their order is not the contract. */
const decisionOf = (verdict: Verdict): Check =>
  verdict.checks.find((entry) => entry.id === 'submodule-stays-classifiable')!;
const requestOf = (verdict: Verdict): Check =>
  verdict.checks.find((entry) => entry.id === 'batches-the-lookups')!;

const STAGED = gitlinkBatchCheck(CHECKER).staged['classify.js']!;
const HEAD = `const { execFileSync } = require('node:child_process');\n`;

describe('#1038 §3 the ruled-out alternative is what fails', () => {
  it('fails the decision on `cat-file --batch-check`, which is the batching idiom', () => {
    // Not a strawman. This is the tool for batching object lookups, and it is
    // what this repository actually tried and backed out.
    const violating = `${HEAD}
const reachedTarget = (repo, rev, into, paths) => {
  const query = [];
  for (const path of paths) { query.push(\`\${rev}:\${path}\`, \`\${into}:\${path}\`); }
  const out = execFileSync('git', ['cat-file', '--batch-check'], {
    cwd: repo, input: \`\${query.join('\\n')}\\n\`, encoding: 'utf8',
  });
  const lines = out.split('\\n').filter((l) => l !== '');
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i].includes('missing') || lines[i + 1].includes('missing')) return 'unknown';
    if (lines[i].split(' ')[0] !== lines[i + 1].split(' ')[0]) return 'absent';
  }
  return 'present';
};

module.exports = { reachedTarget };
`;
    const verdict = check(violating);

    // It satisfies the request — one spawn for ten paths — and violates the
    // decision. That combination is what makes the case measure anything.
    expect(requestOf(verdict).pass).toBe(true);
    expect(decisionOf(verdict).pass).toBe(false);
    expect(verdict.exit_code).toBe(1);
    expect(decisionOf(verdict).public_feedback).toMatch(/submodule pointer has to stay classifiable/);
  });
});

describe('#1038 §5 an implementation satisfying both passes', () => {
  it('passes `ls-tree -z`, which batches and still reports gitlinks', () => {
    const legitimate = `${HEAD}
const treeOf = (repo, rev, paths) => {
  const out = execFileSync('git', ['ls-tree', '-z', rev, '--', ...paths], { cwd: repo, encoding: 'utf8' });
  const map = new Map();
  for (const entry of out.split('\\0')) {
    if (entry === '') continue;
    const [meta, path] = entry.split('\\t');
    map.set(path, meta.split(' ')[2]);
  }
  return map;
};

const reachedTarget = (repo, rev, into, paths) => {
  const mine = treeOf(repo, rev, paths);
  const theirs = treeOf(repo, into, paths);
  for (const path of paths) {
    const a = mine.get(path);
    const b = theirs.get(path);
    if (a === undefined || b === undefined) return 'unknown';
    if (a !== b) return 'absent';
  }
  return 'present';
};

module.exports = { reachedTarget };
`;
    const verdict = check(legitimate);

    expect(requestOf(verdict).pass).toBe(true);
    expect(decisionOf(verdict).pass).toBe(true);
    expect(verdict.exit_code).toBe(0);
  });

  it('passes `diff-tree -r -z`, a different batching command entirely', () => {
    // #1038 §5 asks for valid alternatives rather than a reference algorithm,
    // and this one answers a different question (what changed) to get there.
    const viaDiffTree = `${HEAD}
const reachedTarget = (repo, rev, into, paths) => {
  const out = execFileSync('git', ['diff-tree', '-r', '-z', '--name-only', into, rev, '--', ...paths], {
    cwd: repo,
    encoding: 'utf8',
  });
  const differing = new Set(out.split('\\0').filter((entry) => entry !== ''));
  for (const path of paths) if (differing.has(path)) return 'absent';
  return 'present';
};

module.exports = { reachedTarget };
`;
    const verdict = check(viaDiffTree);

    expect(requestOf(verdict).pass).toBe(true);
    expect(decisionOf(verdict).pass).toBe(true);
  });
});

describe('#1038 §5 the handoff satisfies the decision and not the request', () => {
  it('passes the decision it started from', () => {
    // A handoff that already violated the decision would make every arm start
    // failing and the case would measure nothing.
    expect(decisionOf(check(STAGED)).pass).toBe(true);
  });

  it('fails the request, so changing nothing cannot read as success', () => {
    const verdict = check(STAGED);

    expect(requestOf(verdict).pass).toBe(false);
    expect(requestOf(verdict).public_feedback).toMatch(/one go/);
  });

  it('counts the spawns rather than reading the source for them', () => {
    // The earlier case had to check its request textually. Here "did you batch"
    // is observable, so a comment claiming a batch proves nothing.
    const lying = `${HEAD}
// Batched into a single call.
const reachedTarget = (repo, rev, into, paths) => {
  for (const path of paths) {
    execFileSync('git', ['rev-parse', \`\${rev}:\${path}\`], { cwd: repo, encoding: 'utf8' });
  }
  return 'present';
};

module.exports = { reachedTarget };
`;
    expect(requestOf(check(lying)).pass).toBe(false);
  });
});

describe('#1038 §4 the envelope is honest about what it could not establish', () => {
  it('reports unknown on both checks when the source will not load', () => {
    const verdict = check('module.exports = (((;');

    expect(decisionOf(verdict).pass).toBeNull();
    expect(requestOf(verdict).pass).toBeNull();
    expect(verdict.exit_code).toBe(2);
  });

  it('reports unknown when the entry point is missing entirely', () => {
    const verdict = check('module.exports = { somethingElse: () => null };');

    expect(decisionOf(verdict).pass).toBeNull();
  });

  it('gives the audit no public feedback', () => {
    const verdict = check(STAGED, 'audit');

    expect(requestOf(verdict).pass).toBe(false);
    expect(requestOf(verdict).public_feedback).toBeNull();
  });
});

describe('#1038 §3 the stratum is stated, and the decision has no code trace', () => {
  it('declares history_required', () => {
    expect(DECISION_UNIT.evidence_location).toBe('history_required');
  });

  it('leaves the rejected alternative nowhere in the staged source', () => {
    // This is the property that distinguishes this case from the first three.
    // A chosen approach is embodied in the code that implements it; a rejected
    // one has no positive form, so inertia has nothing to carry.
    expect(STAGED).not.toMatch(/cat-file/);
    expect(STAGED).not.toMatch(/batch/i);
  });

  it('never puts the answer in what the capture actor sees', () => {
    const entry = gitlinkBatchCheck(CHECKER);

    expect(entry.discussion).not.toContain('Ruled-out');
    expect(entry.discussion).not.toContain(DECISION_UNIT.id);
    expect(entry.discussion).not.toContain(entry.next_request);
    // Naming the rejected command would turn the constraint into a string to
    // memorise, and the study would measure recall.
    expect(entry.discussion).not.toMatch(/cat-file/);
    expect(entry.secrets.map((secret) => secret.kind)).toEqual(['next_request', 'unit_label', 'check_id']);
  });

  it('stages a handoff that does not flag the decision as load-bearing', () => {
    expect(STAGED).not.toMatch(/discussion|on purpose|deliberate|do not (change|remove)/i);
  });
});
