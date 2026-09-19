/**
 * The unaided-control screen — #1038 §3.
 *
 * Three measured runs of the first real case produced no effect, and none of
 * the reasons were the product. The last one is the reason this module exists:
 * with the leak gone, the instrument complete and the record demonstrably
 * delivered — the NATIVE arm cited the recorded reason thirteen times while
 * neither OFF repetition cited it at all — both arms still scored 100%, because
 * an unaided actor reaches the same answer from ordinary good practice.
 *
 * `evidence_location: 'history_required'` cannot catch that. It says the reason
 * is absent from the current source; it says nothing about whether the
 * conclusion is reachable without it.
 *
 * So the screen runs the control and reads what it does. Like the rest of the
 * harness, it is driven here by a fake actor through the real driver: real
 * child processes, real repositories, real envelopes, no model.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { ExecutableCase } from '../bench/de/execute.ts';
import { renderScreen, screenCases, type ScreenOptions } from '../bench/de/screen.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const REVISION = 'checker@r6.1';

/**
 * A fake control. Writes whatever DE_CONTROL_WRITES says and commits it.
 *
 * The environment decides, not the prompt, so a test can put the control on
 * either side of the decision without pretending to model how an actor reasons.
 */
const ACTOR = `
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  const mode = process.env.DE_CONTROL_WRITES;
  if (mode !== 'nothing') {
    writeFileSync(process.env.DE_REPO + '/api.js', \`module.exports = { ok: \${mode} };\\n\`);
    const run = (a) => execFileSync('git', a, { cwd: process.env.DE_REPO, encoding: 'utf8' });
    run(['add', 'api.js']);
    run(['commit', '-m', 'control did the work']);
  }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success' }) + '\\n');
});
`;

/** Passes when the committed module says ok:true. */
const CHECKER = `
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const path = process.env.CHECK_REPO + '/api.js';
const present = existsSync(path);
const pass = present ? readFileSync(path, 'utf8').includes('ok: true') : null;
writeFileSync(process.env.CHECK_OUT, JSON.stringify({
  purpose: process.env.CHECK_PURPOSE,
  artifact_id: process.env.CHECK_ARTIFACT,
  checker_revision: process.env.CHECK_REVISION,
  environment_error: null,
  exit_code: pass === null ? 2 : pass ? 0 : 1,
  checks: [{ id: 'honours-the-decision', category: 'decision', pass,
    evidence: 'read the committed module',
    public_feedback: process.env.CHECK_PURPOSE === 'feedback' && pass === false ? 'not like that' : null }],
}));
`;

interface Harness {
  readonly root: string;
  readonly entry: ExecutableCase;
  readonly options: (over?: Partial<ScreenOptions>) => ScreenOptions;
}

const setup = (name: string): Harness => {
  const root = mkdtempSync(join(tmpdir(), `de-screen-${name}-`));
  roots.push(root);
  const actor = join(root, 'actor.cjs');
  const checker = join(root, 'checker.cjs');
  writeFileSync(actor, ACTOR);
  writeFileSync(checker, CHECKER);

  return {
    root,
    entry: {
      id: 'screened',
      cluster_id: 'c1',
      source_group: 'g1',
      discussion: 'The reason, which the control must not receive.\n',
      staged: { 'seed.js': 'module.exports = {};\n' },
      next_request: 'Add the module.',
      checker,
      described: [
        { id: 'honours-the-decision', category: 'decision', purpose: 'feedback', requirement_ids: ['r1'] },
        { id: 'honours-the-decision', category: 'decision', purpose: 'audit', requirement_ids: ['r1'] },
      ],
      secrets: [],
    },
    options: (over = {}) => ({
      runDir: join(root, 'screen'),
      actor: { command: process.execPath, args: [actor] },
      trials: 1,
      timeoutMs: 30_000,
      checkerRevision: REVISION,
      ...over,
    }),
  };
};

const withControl = async (harness: Harness, writes: string, over: Partial<ScreenOptions> = {}) => {
  const previous = process.env['DE_CONTROL_WRITES'];
  process.env['DE_CONTROL_WRITES'] = writes;
  try {
    return await screenCases([harness.entry], harness.options(over));
  } finally {
    if (previous === undefined) delete process.env['DE_CONTROL_WRITES'];
    else process.env['DE_CONTROL_WRITES'] = previous;
  }
};

describe('#1038 §3 the screen reads what an unaided control does', () => {
  it('counts a control that honoured the decision without ever seeing it', async () => {
    // The finding the screen exists for. The case looks well-formed and cannot
    // attribute a pass to the record, because the control gets there too.
    const harness = setup('passes');

    const [result] = await withControl(harness, 'true');

    expect(result!.passed_unaided).toBe(1);
    expect(result!.unresolved).toBe(0);
    expect(renderScreen([result!])).toMatch(/reachable without the record/);
  }, 120_000);

  it('reports a control that violated the decision, which is the case working', async () => {
    const harness = setup('fails');

    const [result] = await withControl(harness, 'false');

    expect(result!.passed_unaided).toBe(0);
    expect(result!.trials[0]!.passed).toBe(false);
    expect(renderScreen([result!])).toMatch(/the control failed/);
  }, 120_000);

  it('separates "established nothing" from "honoured the decision"', async () => {
    // A control that committed nothing leaves no artifact to judge. Counting
    // that as a pass would quietly retire every case the actor failed to reach,
    // and counting it as a failure would pass off a broken harness as a good
    // case.
    const harness = setup('silent');

    const [result] = await withControl(harness, 'nothing');

    expect(result!.trials[0]!.passed).toBeNull();
    expect(result!.trials[0]!.committed).toBe(false);
    expect(result!.passed_unaided).toBe(0);
    expect(result!.unresolved).toBe(1);
    expect(renderScreen([result!])).toMatch(/nothing was established/);
  }, 120_000);
});

describe('#1038 §3 the control is unaided, and that is checked rather than intended', () => {
  it('never puts the discussion in the repository the control works in', async () => {
    const harness = setup('nodisc');

    await withControl(harness, 'true');

    const dir = join(harness.root, 'screen', 'screened-control-0');
    const tracked = execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8' });

    expect(tracked).not.toMatch(/DISCUSSION/);
    expect(existsSync(join(dir, 'DISCUSSION.md'))).toBe(false);
  }, 120_000);

  it('never puts the discussion in the prompt either', async () => {
    // The capture prompt carries it in the study, deliberately. The screen has
    // no capture phase, so nothing should be carrying it at all -- a control
    // handed the reason is not a control.
    const harness = setup('noprompt');

    await withControl(harness, 'true');

    const prompt = readFileSync(join(harness.root, 'screen', 'screen-screened-0.prompt.txt'), 'utf8');

    expect(prompt).not.toMatch(/The reason, which the control must not receive/);
    expect(prompt).toContain('Add the module.');
  }, 120_000);
});

describe('#1036 a screen directory is new, always', () => {
  it('refuses one that already holds evidence, before spending a session', async () => {
    const harness = setup('reuse');
    await withControl(harness, 'true');

    await expect(withControl(harness, 'true')).rejects.toThrow(/already exists/);
  }, 120_000);
});
