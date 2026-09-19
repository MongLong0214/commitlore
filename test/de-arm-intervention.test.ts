/**
 * The per-arm invocation is the intervention — #1040, revision
 * `native-efficacy-r6.1`.
 *
 * | Component | OFF | NATIVE |
 * |---|---|---|
 * | Owned CommitLore skill/CLI/MCP/Git integration | Absent/disabled | Current supported native integration |
 *
 * Everything else in that table is "Same". So the arms differ in exactly one
 * place, and this file checks that the difference is real and that nothing else
 * moved with it.
 *
 * The check is made by the **child**, not about the parent. #1040 says NATIVE
 * "must actually have the intended tools/skills/hooks enabled, not an empty-MCP
 * approximation. Verify this in a separate neutral smoke, not by inspecting a
 * config filename alone" — and what the parent intended and what the process
 * received are different facts. A fake actor that records its own `process.argv`
 * is the offline half of that verification; the other half needs a real host and
 * is a separate smoke.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { executePlan, type ExecutableCase } from '../bench/de/execute.ts';
import { planSchedule } from '../bench/de/schedule.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Records the argv it was started with, then does just enough to proceed. */
const RECORDER = `
const { execFileSync } = require('node:child_process');
const { writeFileSync, appendFileSync } = require('node:fs');
let p = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { p += c; });
process.stdin.on('end', () => {
  appendFileSync(process.env.DE_ARGV_LOG, JSON.stringify({
    arm: process.env.DE_ARM,
    phase: process.env.DE_PHASE,
    argv: process.argv.slice(2),
  }) + '\\n');
  const run = (a) => execFileSync('git', a, { cwd: process.env.DE_REPO, encoding: 'utf8' });
  if (process.env.DE_PHASE === 'capture') {
    run(['commit', '-m', 'finalize the staged change']);
  } else {
    writeFileSync(process.env.DE_REPO + '/api.ts', 'export const fetchUser = (id) => id;\\n');
    run(['add', 'api.ts']);
    run(['commit', '-m', 'solve']);
  }
  process.stdout.write(JSON.stringify({ type: 'result' }) + '\\n');
});
`;

const CHECKER = `
const { readFileSync, writeFileSync } = require('node:fs');
const kept = readFileSync(process.env.CHECK_REPO + '/api.ts', 'utf8').includes('fetchUser');
writeFileSync(process.env.CHECK_OUT, JSON.stringify({
  purpose: process.env.CHECK_PURPOSE,
  artifact_id: process.env.CHECK_ARTIFACT,
  checker_revision: process.env.CHECK_REVISION,
  environment_error: null,
  exit_code: kept ? 0 : 1,
  checks: [{ id: 'keeps-public-name', category: 'decision', pass: kept,
    evidence: 'observed', public_feedback: process.env.CHECK_PURPOSE === 'feedback' ? (kept ? null : 'keep it') : null }],
}));
`;

interface Recorded {
  readonly arm: string;
  readonly phase: string;
  readonly argv: readonly string[];
}

const runWith = async (
  name: string,
  common: readonly string[],
  perArm: { off: readonly string[]; native: readonly string[] },
): Promise<Recorded[]> => {
  const root = mkdtempSync(join(tmpdir(), `de-arm-${name}-`));
  roots.push(root);
  const recorder = join(root, 'recorder.cjs');
  const checker = join(root, 'checker.cjs');
  const argvLog = join(root, 'argv.jsonl');
  writeFileSync(recorder, RECORDER);
  writeFileSync(checker, CHECKER);
  mkdirSync(join(root, 'out'), { recursive: true });

  const entry: ExecutableCase = {
    id: 'keep-public-name',
    cluster_id: 'api-repo',
    source_group: 'g1',
    discussion: 'We keep the public name `fetchUser` for legacy clients.\n',
    staged: { 'api.ts': 'export const fetchUser = (id) => id;\n' },
    next_request: 'Add a paginated listing helper.',
    checker,
    described: [
      { id: 'keeps-public-name', category: 'decision', purpose: 'feedback', requirement_ids: ['r1'] },
      { id: 'keeps-public-name', category: 'decision', purpose: 'audit', requirement_ids: ['r1'] },
    ],
    secrets: [],
  };

  const previous = process.env['DE_ARGV_LOG'];
  process.env['DE_ARGV_LOG'] = argvLog;
  try {
    await executePlan(planSchedule({ cases: [entry], repeat: 1, seed: 'arm' }), new Map([[entry.id, entry]]), {
      runDir: join(root, 'run'),
      actor: { command: process.execPath, args: [recorder, ...common], perArm },
      limits: { capture: 1_000, solve: 10_000, repair: 5_000 },
      timeoutMs: 30_000,
      budget: 10_000_000,
      checkerRevision: 'checker@r6.1',
    });
  } finally {
    if (previous === undefined) delete process.env['DE_ARGV_LOG'];
    else process.env['DE_ARGV_LOG'] = previous;
  }

  return readFileSync(argvLog, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Recorded);
};

describe('#1040 the arms differ in exactly one place', () => {
  it('gives NATIVE the integration arguments and OFF none of them', async () => {
    const seen = await runWith('differs', [], {
      off: ['--no-owned-integration'],
      native: ['--mcp-config', 'commitlore.json'],
    });

    expect(seen.length).toBeGreaterThan(0);
    for (const entry of seen) {
      if (entry.arm === 'native') {
        expect(entry.argv).toContain('commitlore.json');
        expect(entry.argv).not.toContain('--no-owned-integration');
      } else {
        expect(entry.argv).toContain('--no-owned-integration');
        expect(entry.argv).not.toContain('commitlore.json');
      }
    }
  }, 120_000);

  it('reaches both arms — an intervention only one arm sees is not a comparison', async () => {
    const seen = await runWith('both', [], { off: ['--off-only'], native: ['--native-only'] });

    expect(new Set(seen.map((entry) => entry.arm))).toEqual(new Set(['off', 'native']));
  }, 120_000);

  it('applies the intervention at every phase, not only at capture', async () => {
    // A solve that lost the integration would be measuring the wrong thing at
    // the stage the study's outcome is read from.
    const seen = await runWith('phases', [], { off: ['--off-only'], native: ['--native-only'] });
    const nativePhases = seen.filter((entry) => entry.arm === 'native').map((entry) => entry.phase);

    expect(new Set(nativePhases)).toEqual(new Set(['capture', 'solve']));
    for (const entry of seen.filter((line) => line.arm === 'native')) {
      expect(entry.argv).toContain('--native-only');
    }
  }, 120_000);

  it('holds everything else equal', async () => {
    // #1040's table is "Same" in every row but one. A common flag that reached
    // only one arm would be a second, undeclared intervention.
    const seen = await runWith('equal', ['--shared-flag'], { off: [], native: ['--native-only'] });

    for (const entry of seen) expect(entry.argv).toContain('--shared-flag');
    expect(seen.filter((entry) => entry.argv.includes('--native-only')).every((entry) => entry.arm === 'native')).toBe(
      true,
    );
  }, 120_000);

  it('gives neither arm anything when no intervention is declared', async () => {
    // The shape the pilot ran in, which is why that pilot could not measure an
    // effect: identical invocations are not two arms.
    const seen = await runWith('none', ['--shared-flag'], { off: [], native: [] });
    const argvs = new Set(seen.map((entry) => entry.argv.join(' ')));

    expect(argvs.size).toBe(1);
  }, 120_000);
});
