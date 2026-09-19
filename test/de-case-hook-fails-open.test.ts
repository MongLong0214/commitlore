/**
 * The real case's checker, validated before any measured run — #1038 §3 and §5.
 *
 * "For a history_required condition, prepare a small plausible implementation
 *  that meets the current feature request but violates the accessible prior
 *  binding condition. Its relevant checker must fail. A reference satisfying
 *  both must pass."
 *
 * That pair is the whole point. A checker that passed everything would report a
 * study in which nothing was ever violated; a checker that failed everything
 * would report one in which nothing was ever satisfied. Neither is a
 * measurement, and both look like results.
 *
 * "Before measured runs validate handoff/reference and small wrong
 *  implementations; accept valid alternative solutions, not a particular
 *  reference algorithm."
 *
 * So the passing side is exercised with three *different* implementations that
 * all satisfy the later request in different ways.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { DECISION_UNIT, hookFailsOpen } from '../bench/de/cases/hook-fails-open.ts';

const CHECKER = resolve('bench/de/cases/hook-fails-open.checker.cjs');
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

interface Verdict {
  readonly exit_code: number;
  readonly checks: readonly { readonly pass: boolean | null; readonly public_feedback: string | null }[];
}

const check = (source: string, purpose: 'feedback' | 'audit' = 'feedback'): Verdict => {
  const repo = mkdtempSync(join(tmpdir(), 'de-case-'));
  roots.push(repo);
  writeFileSync(join(repo, 'hook.js'), source);
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

/** What the case stages: fails open, reports nothing. */
const STAGED = hookFailsOpen(CHECKER).staged['hook.js']!;

describe('#1038 §3 the history-violating counterexample fails', () => {
  it('fails an implementation that reports the error by exiting non-zero', () => {
    // The obvious way to satisfy "make it report internal failures", and
    // exactly what the prior decision ruled out. An arm that never saw the
    // reason has no way to know.
    const violating = `
const runHook = (input) => {
  try {
    const context = buildContext(input);
    process.stdout.write(context);
    return 0;
  } catch (error) {
    process.stderr.write(\`hook failed: \${error.message}\\n\`);
    return 1;
  }
};

const buildContext = (input) => {
  if (input === '') throw new Error('no payload');
  return \`context for \${input}\`;
};
`;
    const verdict = check(violating);

    expect(verdict.checks[0]!.pass).toBe(false);
    expect(verdict.exit_code).toBe(1);
    expect(verdict.checks[0]!.public_feedback).toMatch(/shown to the developer rather than to the agent/);
  });

  it('fails an implementation that lets the error propagate', () => {
    const throwing = `
const runHook = (input) => {
  const context = buildContext(input);
  process.stdout.write(context);
  return 0;
};

const buildContext = (input) => {
  if (input === '') throw new Error('no payload');
  return \`context for \${input}\`;
};
`;
    const verdict = check(throwing);

    expect(verdict.checks[0]!.pass).toBe(false);
    expect(verdict.checks[0]!.public_feedback).toMatch(/return rather than throw/);
  });
});

describe('#1038 §5 legitimate implementations pass, and more than one shape of them', () => {
  it('passes an implementation that reports to stderr and still returns 0', () => {
    const viaStderr = `
const runHook = (input) => {
  try {
    process.stdout.write(buildContext(input));
  } catch (error) {
    process.stderr.write(\`hook failed: \${error.message}\\n\`);
  }
  return 0;
};

const buildContext = (input) => {
  if (input === '') throw new Error('no payload');
  return \`context for \${input}\`;
};
`;
    expect(check(viaStderr).checks[0]!.pass).toBe(true);
  });

  it('passes an implementation that reports through the returned context', () => {
    // A different algorithm entirely. The check is about behaviour, not about a
    // reference solution.
    const viaContext = `
const runHook = (input) => {
  let context;
  try {
    context = buildContext(input);
  } catch (error) {
    context = \`commitlore: no context (\${error.message})\`;
  }
  process.stdout.write(context);
  return 0;
};

const buildContext = (input) => {
  if (input === '') throw new Error('no payload');
  return \`context for \${input}\`;
};
`;
    expect(check(viaContext).checks[0]!.pass).toBe(true);
  });

  it('passes the staged source it started from', () => {
    // The handoff itself must not already be a violation, or every arm would
    // start failing.
    expect(check(STAGED).checks[0]!.pass).toBe(true);
  });
});

describe('#1038 §4 the envelope is honest about what it could not establish', () => {
  it('reports unknown rather than false when the source will not evaluate', () => {
    // A registry failure or an unevaluable candidate is not a code false.
    const verdict = check('const runHook = (((;');

    expect(verdict.checks[0]!.pass).toBeNull();
    expect(verdict.exit_code).toBe(2);
  });

  it('reports unknown when the entry point is missing entirely', () => {
    expect(check('const somethingElse = () => 0;').checks[0]!.pass).toBeNull();
  });

  it('gives the audit no public feedback', () => {
    const verdict = check(
      `const runHook = (input) => { if (input === '') return 1; return 0; };`,
      'audit',
    );

    expect(verdict.checks[0]!.pass).toBe(false);
    expect(verdict.checks[0]!.public_feedback).toBeNull();
  });
});

describe('#1038 §3 the stratum is stated, and checked', () => {
  it('declares history_required because the current source does not carry the reason', () => {
    // `src/cli.ts` explains the exit-code taxonomy at length and says nothing
    // about why the hook path must still exit 0 when its own work fails. That
    // was read, not assumed from the decision feeling historical.
    expect(DECISION_UNIT.evidence_location).toBe('history_required');
    expect(readFileSync(resolve('src/cli.ts'), 'utf8')).not.toMatch(/shown to the developer rather than the agent/i);
  });

  it('keeps the unit eligible for new capture and not already recorded', () => {
    expect(DECISION_UNIT.eligible_for_new_capture).toBe(true);
    expect(DECISION_UNIT.already_recorded).toBe(false);
  });

  it('never puts the answer in what the capture actor sees', () => {
    const entry = hookFailsOpen(CHECKER);

    expect(entry.discussion).not.toContain('Ruled-out');
    expect(entry.discussion).not.toContain(DECISION_UNIT.id);
    expect(entry.discussion).not.toContain(entry.next_request);
    expect(entry.secrets.map((secret) => secret.kind)).toEqual(['next_request', 'unit_label', 'check_id']);
  });
});
