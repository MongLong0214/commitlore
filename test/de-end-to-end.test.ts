/**
 * The offline end-to-end — #1039 §3, revision `native-efficacy-r6.1`.
 *
 * "A real temporary Git repo has ordinary prior discussion, fixed staged code
 * and a later request. Fake actors actually invoke native APIs/commit/code edits
 * through the measured driver. Exercise both arms."
 *
 * Every module the study is made of is the real one here: the measured driver
 * spawns real child processes, the checkpoint takes and restores a real git
 * tree, the envelope validator reads what a real checker script wrote, and the
 * scorer, selector, episode order and aggregation are the shipped functions.
 * Only the *actor* is fake — a node script that edits files and commits, which
 * is what makes this runnable with no model and no spend.
 *
 * What this establishes is that the pieces compose: an episode walks capture →
 * solve → checkpoint → feedback → repair selection → audit → a paired mean,
 * and the record that comes out the far end is complete for both arms.
 *
 * What it does not establish is anything about CommitLore's effect. The actors
 * are scripted, so the outcomes are whatever the script writes; #1041 is
 * explicit that "scripted fake capture demonstrates wiring, not spontaneous
 * live accuracy".
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { joinPlan, pairedEffect, plannedRows, type ObservedOutcome } from '../bench/de/aggregate.ts';
import { takeCheckpoint, restoreCheckpoint, checkpointStatusOf } from '../bench/de/checkpoint.ts';
import { runMeasured } from '../bench/de/driver.ts';
import { runEpisode, type EpisodeEffects } from '../bench/de/episode.ts';
import { validateEnvelope, unparsableEnvelope, type CheckDefinition } from '../bench/de/envelope.ts';
import { planSchedule, type Arm } from '../bench/de/schedule.ts';
import { scoreArtifact } from '../bench/de/scoring.ts';
import { createTestRepo } from './git-fixtures.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

const ARTIFACT = 'artifact';
const REVISION = 'checker@r6.1';

const described: CheckDefinition[] = [
  { id: 'keeps-public-name', category: 'decision', purpose: 'feedback', requirement_ids: ['r1'] },
];

/**
 * The prior decision, as ordinary discussion plus a staged change.
 *
 * "Keep the public name for legacy clients" is the issue's own example of a
 * scoped rule, and it is the thing an arm either carries forward or loses.
 */
const seedRepo = (dir: string): string => {
  const repo = join(dir, 'repo');
  createTestRepo({ path: repo });
  writeFileSync(
    join(repo, 'DISCUSSION.md'),
    '# API review\n\nWe keep the public name `fetchUser` for legacy clients; v2 may rename it.\n',
  );
  writeFileSync(join(repo, 'api.ts'), 'export const fetchUser = (id: string) => id;\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'handoff: the staged application change']);
  return repo;
};

/**
 * A fake actor: reads the prompt on stdin, edits the file, commits, and in the
 * native arm also writes a record the way the product does.
 *
 * It is a real child through the real measured driver, so the prompt really
 * crosses a pipe and the commit really lands in a real repository.
 */
const ACTOR = `
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { prompt += chunk; });
process.stdin.on('end', () => {
  const { execFileSync } = require('node:child_process');
  const { writeFileSync, readFileSync } = require('node:fs');
  const repo = process.env.ACTOR_REPO;
  const arm = process.env.ACTOR_ARM;
  const run = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

  writeFileSync(repo + '/api.ts', readFileSync(repo + '/api.ts', 'utf8') + '// touched by ' + arm + '\\n');
  run(['add', 'api.ts']);
  run(['commit', '-m', 'solve: ' + arm + ' applied the later request']);
  if (arm === 'native') {
    const head = run(['rev-parse', 'HEAD']).trim();
    run(['notes', '--ref', 'commitlore', 'add', '-m', 'Limit: keep fetchUser for legacy clients; v2 may rename', head]);
  }
  process.stdout.write(JSON.stringify({ type: 'result', arm, prompt_bytes: Buffer.byteLength(prompt) }) + '\\n');
});
`;

/** A real checker script: inspects the tree and writes an envelope. */
const CHECKER = `
const { readFileSync, writeFileSync } = require('node:fs');
const repo = process.env.CHECK_REPO;
const out = process.env.CHECK_OUT;
const purpose = process.env.CHECK_PURPOSE;
const source = readFileSync(repo + '/api.ts', 'utf8');
const kept = source.includes('fetchUser');
writeFileSync(out, JSON.stringify({
  purpose,
  artifact_id: ${JSON.stringify(ARTIFACT)},
  checker_revision: ${JSON.stringify(REVISION)},
  environment_error: null,
  exit_code: kept ? 0 : 1,
  checks: [{
    id: 'keeps-public-name',
    category: 'decision',
    pass: kept,
    evidence: kept ? 'fetchUser is still exported' : 'fetchUser was renamed',
    public_feedback: purpose === 'feedback' ? (kept ? null : 'the public name fetchUser must stay for legacy clients') : null,
  }],
}));
`;

describe('#1039 §3 the offline end-to-end walks both arms with no model', () => {
  it('runs capture, solve, checkpoint, feedback, repair selection and audit through the real modules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'de-e2e-'));
    roots.push(root);
    const out = join(root, 'out');
    mkdirSync(out, { recursive: true });
    const actor = join(root, 'actor.cjs');
    const checker = join(root, 'checker.cjs');
    writeFileSync(actor, ACTOR);
    writeFileSync(checker, CHECKER);

    // One pair, from the real planner.
    const plan = planSchedule({
      cases: [{ id: 'keep-public-name', cluster_id: 'api-repo' }],
      repeat: 1,
      seed: 'e2e',
    });
    expect(plan).toHaveLength(1);

    const repos = new Map<Arm, string>();
    const checkpoints = new Map<Arm, ReturnType<typeof takeCheckpoint>>();

    const runChecker = (arm: Arm, purpose: 'feedback' | 'audit') => {
      // A separate evaluation clone, as #1038 §4 asks: each purpose runs its
      // checks against a restored copy rather than the actor's own worktree.
      const clone = join(root, `eval-${arm}-${purpose}`);
      restoreCheckpoint(checkpoints.get(arm)!, clone);
      const envelopePath = join(out, `${arm}.${purpose}.json`);
      execFileSync(process.execPath, [checker], {
        env: { ...process.env, CHECK_REPO: clone, CHECK_OUT: envelopePath, CHECK_PURPOSE: purpose },
      });
      const verdict = validateEnvelope({
        purpose,
        artifact_id: ARTIFACT,
        checker_revision: REVISION,
        described: described.map((entry) => ({ ...entry, purpose })),
        raw: JSON.parse(readFileSync(envelopePath, 'utf8')),
      });
      return verdict.valid ? verdict.envelope : unparsableEnvelope();
    };

    let tick = 0;
    const effects: EpisodeEffects = {
      instant: () => `t${String((tick += 1))}`,
      runCapture: async (arm) => {
        const dir = join(root, `arm-${arm}`);
        mkdirSync(dir, { recursive: true });
        repos.set(arm, seedRepo(dir));
        return { handoff: 'valid', committed: repos.get(arm)! };
      },
      runSolve: async (arm) => {
        const repo = repos.get(arm)!;
        // The real measured driver, a real child, the prompt over stdin.
        const result = await runMeasured({
          executable: process.execPath,
          args: [actor],
          prompt: 'Apply the later request to api.ts. 이전 논의를 참고하세요.',
          cwd: repo,
          outDir: out,
          env: { PATH: process.env['PATH'] ?? '', ACTOR_REPO: repo, ACTOR_ARM: arm },
          timeoutMs: 30_000,
          label: `solve-${arm}`,
        });
        expect(result.stdinDelivered).toBe('complete');
        expect(result.events).toHaveLength(1);

        const checkpoint = takeCheckpoint({ cwd: repo, stage: 'first_solve', outDir: out });
        checkpoints.set(arm, checkpoint);
        const feedback = runChecker(arm, 'feedback');
        const verdict = scoreArtifact(
          {
            artifact_id: ARTIFACT,
            checker_revision: REVISION,
            required_checks: { feedback: ['keeps-public-name'], audit: [] },
          },
          { feedback, audit: { presence: 'missing' } },
        );
        return {
          execution: 'completed',
          checkpoint: checkpointStatusOf(checkpoint),
          feedback: { trusted: true, verdict, public_explanation: true, environment_fault: false },
          artifact: checkpoint.head,
        };
      },
      runRepair: async (arm) => {
        const feedback = runChecker(arm, 'feedback');
        const verdict = scoreArtifact(
          {
            artifact_id: ARTIFACT,
            checker_revision: REVISION,
            required_checks: { feedback: ['keeps-public-name'], audit: [] },
          },
          { feedback, audit: { presence: 'missing' } },
        );
        return {
          execution: 'completed',
          feedback: { trusted: true, verdict, public_explanation: true, environment_fault: false },
          artifact: checkpoints.get(arm)!.head,
        };
      },
      runAudit: async (arm) => {
        const audit = runChecker(arm, 'audit');
        const verdict = scoreArtifact(
          {
            artifact_id: ARTIFACT,
            checker_revision: REVISION,
            required_checks: { feedback: [], audit: ['keeps-public-name'] },
          },
          { feedback: { presence: 'missing' }, audit },
        );
        return { trusted: true, verdict, public_explanation: false, environment_fault: false };
      },
    };

    const record = await runEpisode(plan[0]!, effects);

    // Both arms produced a complete row.
    expect(record.arms).toHaveLength(2);
    for (const arm of record.arms) {
      expect(arm.capture.handoff).toBe('valid');
      expect(arm.solve).not.toBeNull();
      expect(arm.solve!.checkpoint).toBe('complete');
      expect(arm.audit).not.toBeNull();
      expect(arm.repairChoice).not.toBeNull();
    }

    // The two read instants were shared and ordered.
    expect(record.solveInstant).toBe('t1');
    expect(record.repairInstant).toBe('t2');

    // The native arm really wrote a record, and it survives the checkpoint.
    const nativeClone = join(root, 'inspect-native');
    restoreCheckpoint(checkpoints.get('native')!, nativeClone);
    expect(git(nativeClone, ['notes', '--ref', 'commitlore', 'show', checkpoints.get('native')!.head])).toContain(
      'Limit: keep fetchUser for legacy clients',
    );

    // The off arm wrote no record, which is a valid handoff and not a failure.
    const offClone = join(root, 'inspect-off');
    restoreCheckpoint(checkpoints.get('off')!, offClone);
    expect(git(offClone, ['notes', '--ref', 'commitlore', 'list'])).toBe('');

    // And the scored rows aggregate into a paired effect.
    const planned = plannedRows(plan, () => 'api-group');
    const observed: ObservedOutcome[] = record.arms.map((arm) => ({
      case_id: plan[0]!.case_id,
      repetition: 1,
      arm: arm.arm,
      score: arm.solve!.feedback.verdict.score,
    }));
    const effect = pairedEffect(joinPlan(planned, observed));

    expect(effect.off.value).not.toBeNull();
    expect(effect.native.value).not.toBeNull();
    expect(effect.differencePoints).toBe(0);
  }, 60_000);
});
