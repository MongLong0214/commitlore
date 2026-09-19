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

describe('#1038 §5 an implementation that reaches for a module is evaluable', () => {
  /*
   * These exist because the first measured run found what this file did not.
   *
   * Every fixture above is self-contained, so `require` never appeared in the
   * validation set -- and the checker evaluated the candidate in a bare
   * `new Function` body, which has no `require`. The NATIVE arm wrote a correct
   * answer, the checker answered `null` on "require is not defined", and the
   * run produced no measurement at all.
   *
   * The case's own prose names "writing a diagnostic file" as a legitimate way
   * to satisfy the later request. That is not expressible without the module
   * system, so the spec and the checker contradicted each other and the tests
   * were written from the checker's reachable shapes rather than from the spec.
   */

  /** Verbatim, from the NATIVE arm of the first measured run. */
  const REAL_NATIVE_ANSWER = `
const { appendFileSync, mkdirSync } = require('node:fs');
const { homedir } = require('node:os');
const { dirname, join } = require('node:path');

const LOG_PATH = process.env.HOOK_LOG ?? join(homedir(), '.claude', 'hook-errors.log');

const runHook = (input) => {
  try {
    process.stdout.write(buildContext(input));
  } catch (error) {
    reportFailure(error);
  }
  return 0;
};

const reportFailure = (error) => {
  const entry = \`\${new Date().toISOString()} \${error?.stack ?? String(error)}\\n\`;

  if (process.env.HOOK_DEBUG) {
    try {
      process.stderr.write(entry);
    } catch {
      // stderr is closed or full; the log below is the durable channel.
    }
  }

  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, entry);
  } catch {
    // Reporting the failure must not become a second failure.
  }
};

const buildContext = (input) => {
  if (input === '') throw new Error('no payload');
  return \`context for \${input}\`;
};
`;

  it('passes the answer a real actor wrote, which reports through a log file', () => {
    expect(check(REAL_NATIVE_ANSWER).checks[0]!.pass).toBe(true);
  });

  it('still fails a violation that uses a module, rather than excusing it as unknown', () => {
    // The control. A fix that handed everything a module scope would be worth
    // nothing if it also stopped the checker seeing a non-zero return.
    const violating = `
const { appendFileSync } = require('node:fs');
const runHook = (input) => {
  try {
    process.stdout.write(buildContext(input));
    return 0;
  } catch (error) {
    appendFileSync(process.env.HOOK_LOG ?? '/dev/null', String(error));
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
  });

  it('keeps a genuinely missing module unknown, because that is not a verdict on the requirement', () => {
    const verdict = check(`const x = require('no-such-package-xyz');\nconst runHook = () => 0;\n`);

    expect(verdict.checks[0]!.pass).toBeNull();
    expect(verdict.exit_code).toBe(2);
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
