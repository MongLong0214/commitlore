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

import { DECISION_UNIT, diffNameQuoting } from '../bench/de/cases/diff-name-quoting.ts';

const CHECKER = resolve('bench/de/cases/diff-name-quoting.checker.cjs');
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface Verdict {
  readonly exit_code: number;
  readonly checks: readonly { readonly pass: boolean | null; readonly public_feedback: string | null }[];
}

const check = (module: string, purpose: 'feedback' | 'audit' = 'feedback'): Verdict => {
  const repo = mkdtempSync(join(tmpdir(), 'de-quote-case-'));
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

const STAGED = diffNameQuoting(CHECKER).staged['changed.js']!;

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

    expect(verdict.checks[0]!.pass).toBe(false);
    expect(verdict.exit_code).toBe(1);
    expect(verdict.checks[0]!.public_feedback).toMatch(/C-quoted spelling/);
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

    expect(verdict.checks[0]!.pass).toBe(false);
    expect(verdict.checks[0]!.public_feedback).toMatch(/Every changed path must be reported/);
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
    expect(check(viaNameStatusZ).checks[0]!.pass).toBe(true);
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
    expect(check(viaDiffTree).checks[0]!.pass).toBe(true);
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
    expect(check(viaConfig).checks[0]!.pass).toBe(true);
  });

  it('passes the staged source it started from', () => {
    // The handoff must not already be a violation, or every arm would start
    // failing and the case would measure nothing.
    expect(check(STAGED).checks[0]!.pass).toBe(true);
  });
});

describe('#1038 §4 the envelope is honest about what it could not establish', () => {
  it('reports unknown rather than false when the source will not load', () => {
    const verdict = check('module.exports = (((;');

    expect(verdict.checks[0]!.pass).toBeNull();
    expect(verdict.exit_code).toBe(2);
  });

  it('reports unknown when the entry point is missing entirely', () => {
    expect(check('module.exports = { somethingElse: () => [] };').checks[0]!.pass).toBeNull();
  });

  it('reports unknown when what came back carries no readable paths', () => {
    // Not a false: an answer the checker cannot read is not an answer it has
    // judged.
    const verdict = check(`module.exports = { changedPaths: () => [{ nope: 1 }] };`);

    expect(verdict.checks[0]!.pass).toBeNull();
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

    expect(verdict.checks[0]!.pass).toBe(false);
    expect(verdict.checks[0]!.public_feedback).toBeNull();
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
    const entry = diffNameQuoting(CHECKER);

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
    const staged = diffNameQuoting(CHECKER).staged['changed.js']!;

    expect(staged).not.toMatch(/discussion|on purpose|deliberate|do not (change|remove)/i);
  });
});
