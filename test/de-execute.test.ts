/**
 * The execution loop, driven end to end with a fake actor — #1036 and #1035,
 * revision `native-efficacy-r6.1`.
 *
 * "Synthetic fake-actor smoke proves actual Git/native wiring, not spontaneous
 * live capture or semantic accuracy."
 *
 * That is exactly what this is, and it is why the loop can be verified before a
 * token is spent: the actor is a command, so a node script exercises the same
 * code path a host CLI will. Real git repositories, real child processes, real
 * checkpoints, real envelopes, real scoring — and no model.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { executePlan, type ExecutableCase } from '../bench/de/execute.ts';
import { planSchedule } from '../bench/de/schedule.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const REVISION = 'checker@r6.1';

/**
 * A fake actor. One command for all three phases, told which it is by the
 * environment, the way a real host is told by its prompt.
 */
const ACTOR = `
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  const repo = process.env.DE_REPO;
  const arm = process.env.DE_ARM;
  const phase = process.env.DE_PHASE;
  const run = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (phase === 'capture') {
    run(['commit', '-m', 'finalize: the staged change']);
    if (arm === 'native') {
      const head = run(['rev-parse', 'HEAD']).trim();
      run(['notes', '--ref', 'commitlore', 'add', '-m', 'Limit: keep fetchUser for legacy clients', head]);
    }
  } else if (phase === 'solve') {
    // The off arm loses the scoped rule; the native arm keeps it. Scripted, so
    // this measures wiring rather than behaviour.
    const next = arm === 'native'
      ? 'export const fetchUser = (id) => id;\\nexport const fetchUserPage = (p) => p;\\n'
      : 'export const getUser = (id) => id;\\n';
    writeFileSync(repo + '/api.ts', next);
    run(['add', 'api.ts']);
    run(['commit', '-m', 'solve: apply the later request']);
  } else {
    writeFileSync(repo + '/api.ts', 'export const fetchUser = (id) => id;\\n');
    run(['add', 'api.ts']);
    run(['commit', '-m', 'repair: restore the public name']);
  }
  process.stdout.write(JSON.stringify({ type: 'result', arm, phase, prompt_bytes: Buffer.byteLength(prompt) }) + '\\n');
});
`;

const CHECKER = `
const { readFileSync, writeFileSync } = require('node:fs');
const kept = readFileSync(process.env.CHECK_REPO + '/api.ts', 'utf8').includes('fetchUser');
const purpose = process.env.CHECK_PURPOSE;
writeFileSync(process.env.CHECK_OUT, JSON.stringify({
  purpose,
  artifact_id: process.env.CHECK_ARTIFACT,
  checker_revision: process.env.CHECK_REVISION,
  environment_error: null,
  exit_code: kept ? 0 : 1,
  checks: [{
    id: 'keeps-public-name',
    category: 'decision',
    pass: kept,
    evidence: kept ? 'fetchUser is exported' : 'fetchUser was renamed away',
    public_feedback: purpose === 'feedback' ? (kept ? null : 'the public name fetchUser must stay') : null,
  }],
}));
`;

const setup = (name: string) => {
  const root = mkdtempSync(join(tmpdir(), `de-exec-${name}-`));
  roots.push(root);
  const actor = join(root, 'actor.cjs');
  const checker = join(root, 'checker.cjs');
  writeFileSync(actor, ACTOR);
  writeFileSync(checker, CHECKER);

  const entry: ExecutableCase = {
    id: 'keep-public-name',
    cluster_id: 'api-repo',
    source_group: 'g1',
    discussion: 'We keep the public name `fetchUser` for legacy clients; v2 may rename it.\n',
    staged: { 'api.ts': 'export const fetchUser = (id) => id;\n' },
    next_request: 'Add pagination to the user listing endpoint.',
    checker,
    described: [
      { id: 'keeps-public-name', category: 'decision', purpose: 'feedback', requirement_ids: ['r1'] },
      { id: 'keeps-public-name', category: 'decision', purpose: 'audit', requirement_ids: ['r1'] },
    ],
    secrets: [{ kind: 'next_request', value: 'Add pagination to the user listing endpoint.' }],
  };

  return { root, actor, entry };
};

const options = (root: string, actor: string, over: Record<string, unknown> = {}) => ({
  runDir: join(root, 'run'),
  actor: { command: process.execPath, args: [actor] },
  limits: { capture: 1_000, solve: 10_000, repair: 5_000 },
  timeoutMs: 30_000,
  budget: 10_000_000,
  checkerRevision: REVISION,
  ...over,
});

describe('#1036 the execution loop runs both arms with no model', () => {
  it('walks one pair end to end and writes its episode', async () => {
    const { root, actor, entry } = setup('happy');
    const plan = planSchedule({ cases: [entry], repeat: 1, seed: 'exec' });

    const executed = await executePlan(plan, new Map([[entry.id, entry]]), options(root, actor));

    expect(executed).toHaveLength(1);
    const { episode, reservation } = executed[0]!;
    expect(reservation.outcome).toBe('reserved');
    expect(episode).not.toBeNull();
    expect(episode!.arms).toHaveLength(2);

    for (const arm of episode!.arms) {
      expect(arm.capture.handoff).toBe('valid');
      expect(arm.solve).not.toBeNull();
      expect(arm.audit).not.toBeNull();
    }

    // The episode is on disk, which is what a report will read.
    const written = JSON.parse(
      readFileSync(join(root, 'run', 'keep-public-name-rep1', 'episode.json'), 'utf8'),
    ) as { arms: unknown[] };
    expect(written.arms).toHaveLength(2);
  }, 120_000);

  it('repairs the arm whose first result failed, and not the one that passed', async () => {
    // Scripted: the off arm renames the public name away and the native arm
    // keeps it. What this asserts is that the selector's decision reached the
    // loop, not that CommitLore caused anything.
    const { root, actor, entry } = setup('repair');
    const plan = planSchedule({ cases: [entry], repeat: 1, seed: 'exec' });

    const executed = await executePlan(plan, new Map([[entry.id, entry]]), options(root, actor));
    const arms = new Map(executed[0]!.episode!.arms.map((arm) => [arm.arm, arm]));

    expect(arms.get('off')!.repairChoice?.decision).toBe('repair');
    expect(arms.get('off')!.repair).not.toBeNull();
    expect(arms.get('native')!.repairChoice?.decision).toBe('not_triggered');
    expect(arms.get('native')!.repair).toBeNull();
  }, 120_000);

  it('gives the native arm its own record and leaves the off arm without one', async () => {
    const { root, actor, entry } = setup('notes');
    const plan = planSchedule({ cases: [entry], repeat: 1, seed: 'exec' });

    await executePlan(plan, new Map([[entry.id, entry]]), options(root, actor));
    const notesOf = (arm: string): string =>
      execFileSync('git', ['notes', '--ref', 'commitlore', 'list'], {
        cwd: join(root, 'run', 'keep-public-name-rep1', `arm-${arm}`),
        encoding: 'utf8',
      });

    expect(notesOf('native').trim()).not.toBe('');
    // A commit with no record is a valid handoff, not a failure.
    expect(notesOf('off').trim()).toBe('');
  }, 120_000);
});

describe('#1036 the budget stops the run rather than half-funding a pair', () => {
  it('records the refusal and runs nothing further', async () => {
    const { root, actor, entry } = setup('budget');
    const plan = planSchedule({ cases: [entry, { ...entry, id: 'second' }], repeat: 1, seed: 'exec' });
    const cases = new Map([
      [entry.id, entry],
      ['second', { ...entry, id: 'second' }],
    ]);

    // Enough for one pair's worst case and not two.
    const executed = await executePlan(plan, cases, options(root, actor, { budget: 32_000 }));

    expect(executed).toHaveLength(2);
    expect(executed[0]!.episode).not.toBeNull();
    expect(executed[1]!.episode).toBeNull();
    expect(executed[1]!.reservation.outcome).toBe('insufficient');
  }, 180_000);

  it('refuses to start when the remaining budget is unknown', async () => {
    const { root, actor, entry } = setup('unknown-budget');
    const plan = planSchedule({ cases: [entry], repeat: 1, seed: 'exec' });

    const executed = await executePlan(plan, new Map([[entry.id, entry]]), options(root, actor, { budget: null }));

    expect(executed[0]!.reservation.outcome).toBe('unknown-consumption');
    expect(executed[0]!.episode).toBeNull();
  }, 60_000);
});

describe('#1036 a run directory is new, always', () => {
  it('refuses an existing directory rather than appending to it', async () => {
    // Two protocol revisions, case sets or budgets sharing a file is a file
    // whose reader cannot tell them apart.
    const { root, actor, entry } = setup('existing');
    const plan = planSchedule({ cases: [entry], repeat: 1, seed: 'exec' });
    const opts = options(root, actor);
    writeFileSync(join(root, 'marker'), 'x');

    await expect(
      executePlan(plan, new Map([[entry.id, entry]]), { ...opts, runDir: root }),
    ).rejects.toThrow(/already exists/);
    expect(existsSync(join(root, 'marker'))).toBe(true);
  });
});
