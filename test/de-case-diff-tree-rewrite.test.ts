/**
 * The second real case's checker, validated before any measured run — #1038 §3
 * and §5.
 *
 * "For a history_required condition, prepare a small plausible implementation
 *  that meets the current feature request but violates the accessible prior
 *  binding condition. Its relevant checker must fail. A reference satisfying
 *  both must pass."
 *
 * The violating implementation here is not a strawman: `--name-status` split on
 * newlines and tabs is what the request's idiomatic answer looks like, and it
 * is correct for every repository whose filenames are ASCII. That is the point
 * of the case.
 *
 * "accept valid alternative solutions, not a particular reference algorithm"
 *
 * So the passing side is exercised with four implementations that reach the
 * guarantee four different ways — `--name-status -z`, `diff-tree -r -z`,
 * `-c core.quotePath=false`, and the staged source unchanged.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { DECISION_UNIT, diffTreeRewrite } from '../bench/de/cases/diff-tree-rewrite.ts';

const CHECKER = resolve('bench/de/cases/diff-tree-rewrite.checker.cjs');
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

/*
 * Two checks come back, so every assertion addresses one by id.
 *
 * Indexing by position would pass today and start asserting about the other
 * check the moment the checker emits them in a different order.
 */
const decisionOf = (verdict: Verdict): Check =>
  verdict.checks.find((check) => check.id === 'paths-survive-a-lookup')!;

const requestOf = (verdict: Verdict): Check =>
  verdict.checks.find((check) => check.id === 'uses-the-plumbing-command')!;

const check = (module: string, purpose: 'feedback' | 'audit' = 'feedback'): Verdict => {
  const repo = mkdtempSync(join(tmpdir(), 'de-tree-case-'));
  roots.push(repo);
  writeFileSync(join(repo, 'changed.js'), module);
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

const STAGED = diffTreeRewrite(CHECKER).staged['changed.js']!;

/** The header every fixture shares. */
const HEAD = `const { execFileSync } = require('node:child_process');\n`;

describe('#1038 §3 the history-violating counterexample fails', () => {
  it('fails the idiomatic --name-status implementation the later request invites', () => {
    // What an arm that never saw the reason writes. It is correct on every
    // ASCII-only repository, which is every fixture anyone writes by default.
    const violating = `${HEAD}
const changedPaths = (repo, from, to) => {
  const out = execFileSync('git', ['diff', '--name-status', from, to], { cwd: repo, encoding: 'utf8' });
  return out
    .split('\\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [status, path] = line.split('\\t');
      return { status, path };
    });
};

module.exports = { changedPaths };
`;
    const verdict = check(violating);

    expect(decisionOf(verdict).pass).toBe(false);
    expect(verdict.exit_code).toBe(1);
    expect(decisionOf(verdict).public_feedback).toMatch(/C-quoted spelling/);
  });

  it('fails an implementation that drops the path it could not resolve', () => {
    // The shape a "fix" for the crash takes: swallow the awkward one. Returning
    // less must not be a way to pass.
    const dropping = `${HEAD}
const changedPaths = (repo, from, to) => {
  const out = execFileSync('git', ['diff', '--name-only', from, to], { cwd: repo, encoding: 'utf8' });
  return out
    .split('\\n')
    .filter((line) => line !== '' && !line.startsWith('"'));
};

module.exports = { changedPaths };
`;
    const verdict = check(dropping);

    expect(decisionOf(verdict).pass).toBe(false);
    expect(decisionOf(verdict).public_feedback).toMatch(/Every changed path must be reported/);
  });
});

describe('#1038 §5 legitimate implementations pass, and more than one shape of them', () => {
  it('passes --name-status -z, which satisfies the later request and the decision', () => {
    const viaNameStatusZ = `${HEAD}
const changedPaths = (repo, from, to) => {
  const out = execFileSync('git', ['diff', '--name-status', '-z', from, to], { cwd: repo, encoding: 'utf8' });
  const fields = out.split('\\0').filter((entry) => entry !== '');
  const rows = [];
  for (let i = 0; i + 1 < fields.length; i += 2) rows.push({ status: fields[i], path: fields[i + 1] });
  return rows;
};

module.exports = { changedPaths };
`;
    expect(decisionOf(check(viaNameStatusZ)).pass).toBe(true);
  });

  it('passes diff-tree -r -z, a different plumbing command entirely', () => {
    const viaDiffTree = `${HEAD}
const changedPaths = (repo, from, to) => {
  const out = execFileSync('git', ['diff-tree', '-r', '-z', from, to], { cwd: repo, encoding: 'utf8' });
  const fields = out.split('\\0').filter((entry) => entry !== '');
  const rows = [];
  for (let i = 0; i < fields.length; i += 1) {
    if (!fields[i].startsWith(':')) continue;
    rows.push({ status: fields[i].trim().split(' ').pop(), path: fields[i + 1] });
    i += 1;
  }
  return rows;
};

module.exports = { changedPaths };
`;
    expect(decisionOf(check(viaDiffTree)).pass).toBe(true);
  });

  it('passes turning the quoting off at the git invocation instead', () => {
    // A different route to the same guarantee, and one the discussion never
    // mentions. A checker that demanded `-z` would fail this and be reporting
    // its own reference algorithm as the requirement.
    const viaConfig = `${HEAD}
const changedPaths = (repo, from, to) => {
  const out = execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '--name-status', from, to], {
    cwd: repo,
    encoding: 'utf8',
  });
  return out
    .split('\\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [status, path] = line.split('\\t');
      return { status, path };
    });
};

module.exports = { changedPaths };
`;
    expect(decisionOf(check(viaConfig)).pass).toBe(true);
  });

  it('passes the staged source on the decision it started from', () => {
    // The handoff must not already be a violation of the *decision*, or every
    // arm would start failing and the case would measure nothing.
    expect(decisionOf(check(STAGED)).pass).toBe(true);
  });
});

describe('#1038 §4 the request check keeps "changed nothing" from reading as a pass', () => {
  /*
   * This case's whole design is that the request forces a rewrite of the site
   * where the decision lives. An arm that ignored the request would keep the
   * decision by touching nothing, and an envelope that called that success
   * would report the most uninformative possible run as the best one.
   *
   * The two checks stay apart. Folding the textual one into the decision would
   * let a grep speak for a property that has to be observed.
   */

  it('fails the staged handoff on the request, even though it passes the decision', () => {
    const verdict = check(STAGED);

    expect(decisionOf(verdict).pass).toBe(true);
    expect(requestOf(verdict).pass).toBe(false);
    expect(verdict.exit_code).toBe(1);
    expect(requestOf(verdict).public_feedback).toMatch(/plumbing command/);
  });

  it('passes the request check once the source reaches for diff-tree', () => {
    const rewritten = `${HEAD}
const changedPaths = (repo, from, to) => {
  const out = execFileSync('git', ['diff-tree', '-r', '-z', '--no-commit-id', from, to], {
    cwd: repo,
    encoding: 'utf8',
  });
  const fields = out.split('\\0').filter((entry) => entry !== '');
  const paths = [];
  for (let i = 0; i < fields.length; i += 1) {
    if (!fields[i].startsWith(':')) continue;
    paths.push(fields[i + 1]);
    i += 1;
  }
  return paths;
};

module.exports = { changedPaths };
`;
    const verdict = check(rewritten);

    expect(requestOf(verdict).pass).toBe(true);
    expect(decisionOf(verdict).pass).toBe(true);
    expect(verdict.exit_code).toBe(0);
  });

  it('fails the decision when the rewrite drops the framing, which is the case working', () => {
    // The idiomatic rewrite: diff-tree's raw output split on newlines and tabs.
    // Correct on every ASCII-only repository.
    const violating = `${HEAD}
const changedPaths = (repo, from, to) => {
  const out = execFileSync('git', ['diff-tree', '-r', '--no-commit-id', from, to], {
    cwd: repo,
    encoding: 'utf8',
  });
  return out
    .split('\\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\\t')[1]);
};

module.exports = { changedPaths };
`;
    const verdict = check(violating);

    expect(requestOf(verdict).pass).toBe(true);
    expect(decisionOf(verdict).pass).toBe(false);
    expect(verdict.exit_code).toBe(1);
  });

  it('does not count diff-tree named only in a comment as having been invoked', () => {
    const pretending = `${HEAD}
// We should move this to diff-tree one day.
const changedPaths = (repo, from, to) =>
  execFileSync('git', ['diff', '--name-only', '-z', from, to], { cwd: repo, encoding: 'utf8' })
    .split('\\0')
    .filter((entry) => entry !== '');

module.exports = { changedPaths };
`;
    expect(requestOf(check(pretending)).pass).toBe(false);
  });
});

describe('#1038 §4 the envelope is honest about what it could not establish', () => {
  it('reports unknown rather than false on the decision when the source will not load', () => {
    const verdict = check('module.exports = (((;');

    expect(decisionOf(verdict).pass).toBeNull();
    // The exit code is 1 rather than 2, and that is #1038 §4 working over the
    // pair: the request check read the text, found no `diff-tree`, and that is
    // a trustworthy false whatever the parser thinks. A `2` here would claim
    // nothing was established when something was.
    expect(requestOf(verdict).pass).toBe(false);
    expect(verdict.exit_code).toBe(1);
  });

  it('reports unknown when the entry point is missing entirely', () => {
    expect(decisionOf(check('module.exports = { somethingElse: () => [] };')).pass).toBeNull();
  });

  it('reports unknown when what came back carries no readable paths', () => {
    // Not a false: an answer the checker cannot read is not an answer it has
    // judged.
    const verdict = check(`module.exports = { changedPaths: () => [{ nope: 1 }] };`);

    expect(decisionOf(verdict).pass).toBeNull();
  });

  it('gives the audit no public feedback', () => {
    const verdict = check(
      `${HEAD}
const changedPaths = (repo, from, to) =>
  execFileSync('git', ['diff', '--name-only', from, to], { cwd: repo, encoding: 'utf8' })
    .split('\\n')
    .filter((line) => line !== '');

module.exports = { changedPaths };
`,
      'audit',
    );

    expect(decisionOf(verdict).pass).toBe(false);
    expect(decisionOf(verdict).public_feedback).toBeNull();
  });
});

describe('#1038 §3 the stratum is stated, and checked', () => {
  it('declares history_required because the current source does not carry the reason', () => {
    // `src/core/squash.ts` holds the code this decision came from and says
    // nothing about core.quotePath or C-quoting. That was read, not assumed
    // from the decision feeling historical.
    expect(DECISION_UNIT.evidence_location).toBe('history_required');
    const source = readFileSync(resolve('src/core/squash.ts'), 'utf8');
    expect(source).not.toMatch(/quotePath/i);
    expect(source).not.toMatch(/C-quot/i);
  });

  it('keeps the unit eligible for new capture and not already recorded', () => {
    expect(DECISION_UNIT.eligible_for_new_capture).toBe(true);
    expect(DECISION_UNIT.already_recorded).toBe(false);
  });

  it('never puts the answer in what the capture actor sees', () => {
    const entry = diffTreeRewrite(CHECKER);

    expect(entry.discussion).not.toContain('Ruled-out');
    expect(entry.discussion).not.toContain(DECISION_UNIT.id);
    expect(entry.discussion).not.toContain(entry.next_request);
    // The discussion records the reason, never the flag: naming `-z` would hand
    // over the implementation and let an arm transcribe without understanding.
    expect(entry.discussion).not.toMatch(/-z\b/);
    expect(entry.secrets.map((secret) => secret.kind)).toEqual(['next_request', 'unit_label', 'check_id']);
  });

  it('stages a handoff that does not flag the decision as load-bearing', () => {
    // The first case staged "Silent on purpose. The discussion explains why.",
    // which told the solve arm the line mattered and pointed at a document it
    // does not have.
    const staged = diffTreeRewrite(CHECKER).staged['changed.js']!;

    expect(staged).not.toMatch(/discussion|on purpose|deliberate|do not (change|remove)/i);
  });
});
