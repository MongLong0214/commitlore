/**
 * #1048 / #1051 §2–§3: actual `git commit`s, through an actual built hook.
 *
 * The harness builds the CLI's real modules outside the package tree and wires
 * a `commit-msg` entry that calls the **real** `runCommitMsg` with a scripted
 * transport. Nothing about the pipeline is reimplemented here: the producer, the
 * native prepare/verify/stage, the serializer and `runValidate` are all the
 * shipped ones. Only the HTTP call and argv parsing belong to the harness.
 *
 * What the first test establishes, in order, is the six observations #1051 asks
 * to be kept apart: the trigger ran, the source was available, Jev was called,
 * a draft was accepted, a record is in the **commit**, and a fresh keyless
 * reader gets it back. A model JSON or a stage result is none of the last three.
 *
 * Scripted choices prove branches. They say nothing about Jev's accuracy.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prepareCommitMsgStub } from '../src/hooks/prepare-commit-msg.js';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TSC = join(PACKAGE_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const temporary = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-jevcommit-${name}-`));
  scratch.push(dir);
  return dir;
};

/** A synthetic key of the right shape. Never issued; never sent anywhere. */
const KEY = 'apikey_test_commitpath_000000000000000';

const SESSION = 'session-commit-test-1';

let binPath = '';

/**
 * The scripted transport.
 *
 * It reads a JSON plan from `COMMITLORE_JEV_TEST_PLAN` — a harness variable the
 * product never looks at — and answers every question the producer asks
 * according to it. `mode: 'positive'` says every candidate is an applicable
 * Limit; the others exercise the failure arms.
 */
const FAKE_ASK = `
const planPath = process.env.COMMITLORE_JEV_TEST_PLAN;
const plan = planPath ? JSON.parse(readFileSync(planPath, 'utf8')) : { mode: 'none' };

// The state lists each candidate as \`  [cN] (role) text\`, so the fake can
// answer per passage instead of saying every candidate is a Limit. That matters:
// a blanket yes makes the newest candidate win whatever it says, and a test
// asserting a specific passage would then be asserting the enumeration order
// rather than that the chosen candidate is the one copied.
const candidateText = (state) => {
  const map = new Map();
  for (const line of state.split('\\n')) {
    const match = /^  \\[(c\\d+)\\] \\((?:user|assistant)\\) (.*)$/.exec(line);
    if (match) map.set(match[1], match[2]);
  }
  return map;
};

const fakeAsk = async (opts) => {
  writeFileSync(plan.callLog, JSON.stringify({
    questions: opts.questions.length,
    stateBytes: Buffer.byteLength(opts.state, 'utf8'),
    state: opts.state,
  }) + '\\n', { flag: 'a' });
  if (plan.mode === 'timeout') return { status: 'unavailable', failure: 'timeout', usage: null };
  if (plan.mode === 'http-error') {
    return { status: 'unavailable', failure: 'http-error', usage: null, httpStatus: 401 };
  }
  if (plan.mode === 'malformed') {
    return { status: 'unavailable', failure: 'malformed-response', usage: null };
  }
  const texts = candidateText(opts.state);
  const yes = (id) => {
    if (plan.mode !== 'positive') return false;
    if (!plan.limitMatch) return true;
    return (texts.get(id) || '').includes(plan.limitMatch);
  };
  const answers = new Map();
  for (const question of opts.questions) {
    const [kind, candidate] = question.id.split(':');
    if (kind === 'kind') {
      answers.set(question.id, {
        choice: yes(candidate) ? 'limit' : 'none',
        probabilities: { limit: 0.97, none: 0.03 },
        confidence: 0.96,
      });
    } else if (kind === 'relevance') {
      answers.set(question.id, {
        choice: yes(candidate) ? 'applies' : 'unrelated',
        probabilities: { applies: 0.97, unrelated: 0.03 },
        confidence: 0.96,
      });
    }
  }
  return { status: 'answered', answers, unusable: [], usage: { inputTokens: 300, outputTokens: 0, estimatedUsd: 300 * 4.2e-8 } };
};
`;

beforeAll(() => {
  const harness = temporary('bin');
  const build = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json', '--outDir', join(harness, 'dist')], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    shell: false,
  });
  if (build.status !== 0) {
    throw new Error(`tsc build failed (exit ${String(build.status)}):\n${build.stdout}${build.stderr}`);
  }
  symlinkSync(join(PACKAGE_ROOT, 'node_modules'), join(harness, 'node_modules'), 'dir');
  symlinkSync(join(PACKAGE_ROOT, 'spec'), join(harness, 'spec'), 'dir');
  writeFileSync(join(harness, 'package.json'), `${JSON.stringify({ type: 'module', version: '0.0.0-harness' })}\n`);

  binPath = join(harness, 'commitlore.mjs');
  writeFileSync(
    binPath,
    [
      '#!/usr/bin/env node',
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "import { Command } from 'commander';",
      "import { register as registerValidate } from './dist/commands/validate.js';",
      "import { register as registerHooks } from './dist/commands/hooks.js';",
      "import { register as registerPrepareCommitMsg } from './dist/hooks/prepare-commit-msg.js';",
      "import { register as registerAuto } from './dist/commands/auto.js';",
      "import { register as registerQuery } from './dist/commands/query.js';",
      "import { register as registerIndex } from './dist/commands/index-cmd.js';",
      // The real dispatcher. The harness supplies only the transport.
      "import { runCommitMsg } from './dist/commands/commit-msg.js';",
      FAKE_ASK,
      '',
      'const program = new Command();',
      "program.name('commitlore');",
      'registerValidate(program);',
      'registerHooks(program);',
      'registerPrepareCommitMsg(program);',
      'registerAuto(program);',
      'registerQuery(program);',
      'registerIndex(program);',
      "program.command('commit-msg')",
      "  .requiredOption('-f, --message-file <file>')",
      '  .action(async (flags) => {',
      '    const result = await runCommitMsg({ messageFile: flags.messageFile, ask: fakeAsk });',
      "    if (result.stdout !== '') process.stdout.write(result.stdout);",
      "    if (result.stderr !== '') process.stderr.write(result.stderr);",
      '    if (result.code !== 0) process.exitCode = result.code;',
      '  });',
      'await program.parseAsync(process.argv);',
      '',
    ].join('\n'),
  );
  chmodSync(binPath, 0o755);
}, 300_000);

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Jev Test',
  GIT_AUTHOR_EMAIL: 'jev@example.invalid',
  GIT_COMMITTER_NAME: 'Jev Test',
  GIT_COMMITTER_EMAIL: 'jev@example.invalid',
  GIT_CONFIG_GLOBAL: '/nonexistent/commitlore-tests-must-not-read-this',
  GIT_CONFIG_SYSTEM: '/nonexistent/commitlore-tests-must-not-read-this',
} as const;

const git = (cwd: string, args: readonly string[], env: Record<string, string> = {}): { status: number; output: string } => {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, ...env },
    shell: false,
  });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
};

const cli = (cwd: string, args: readonly string[], env: Record<string, string> = {}): { status: number; output: string; stdout: string } => {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, ...env },
    shell: false,
  });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}`, stdout: result.stdout };
};

/** The conversation. Raw prose, no trailer, no instruction to record anything. */
const CONVERSATION =
  `${JSON.stringify({
    type: 'user',
    isSidechain: false,
    message: {
      role: 'user',
      content: 'The vendor caps us at three retries per minute, so the ceiling stays at three.',
    },
  })}\n` +
  `${JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: { role: 'assistant', content: [{ type: 'text', text: 'Understood, keeping it at three.' }] },
  })}\n`;

interface Fixture {
  readonly cwd: string;
  readonly planPath: string;
  readonly callLog: string;
  readonly transcript: string;
}

/**
 * A repository with the prototype's preconditions met: hooks installed, native
 * unattended consent given, a real staged change, and a registered source.
 */
const fixture = (name: string, options: { conversation?: string; consent?: boolean } = {}): Fixture => {
  const cwd = temporary(name);
  git(cwd, ['init', '-q', '--initial-branch=main', '.']);
  writeFileSync(join(cwd, 'src.ts'), 'export const retries = 1;\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '--no-verify', '-m', 'initial']);

  cli(cwd, ['hooks', 'install']);
  // `init` installs this one; `hooks install` writes the gate only. It is
  // required here because the amend marker is the single signal that tells an
  // amend from an ordinary commit, and only `prepare-commit-msg` can see it.
  writeFileSync(join(cwd, git(cwd, ['rev-parse', '--git-path', 'hooks']).output.trim(), 'prepare-commit-msg'), prepareCommitMsgStub(), { mode: 0o755 });
  chmodSync(join(cwd, git(cwd, ['rev-parse', '--git-path', 'hooks']).output.trim(), 'prepare-commit-msg'), 0o755);
  cli(cwd, ['index', '--rebuild']);
  if (options.consent !== false) cli(cwd, ['auto', 'on', '--local']);

  const host = temporary(`${name}-host`);
  const transcript = join(host, 'session.jsonl');
  writeFileSync(transcript, options.conversation ?? CONVERSATION, 'utf8');

  // Registration goes through the real SessionStart path.
  const descriptors = git(cwd, ['rev-parse', '--git-path', 'commitlore/jev-sessions']).output.trim();
  mkdirSync(join(cwd, descriptors), { recursive: true });
  const worktree = git(cwd, ['rev-parse', '--show-toplevel']).output.trim();
  const gitdir = git(cwd, ['rev-parse', '--absolute-git-dir']).output.trim();
  writeFileSync(
    join(cwd, descriptors, `${SESSION}.json`),
    `${JSON.stringify({
      version: 1,
      host: 'claude-code',
      sessionId: SESSION,
      worktree,
      gitdir,
      transcript,
      format: 'claude-jsonl-v1',
      registeredAt: new Date().toISOString(),
    }, null, 2)}\n`,
    { mode: 0o600 },
  );

  // Something staged for the commit under test.
  writeFileSync(join(cwd, 'src.ts'), 'export const retries = 3;\n');
  git(cwd, ['add', '-A']);

  const planPath = join(temporary(`${name}-plan`), 'plan.json');
  const callLog = join(dirname(planPath), 'calls.jsonl');
  return { cwd, planPath, callLog, transcript };
};

const plan = (fix: Fixture, mode: string, limitMatch?: string): void => {
  writeFileSync(
    fix.planPath,
    JSON.stringify({ mode, callLog: fix.callLog, ...(limitMatch === undefined ? {} : { limitMatch }) }),
    'utf8',
  );
};

const enabled = (fix: Fixture, over: Record<string, string> = {}): Record<string, string> => ({
  COMMITLORE_BIN: binPath,
  COMMITLORE_JEV_API_KEY: KEY,
  CLAUDE_CODE_SESSION_ID: SESSION,
  COMMITLORE_JEV_TEST_PLAN: fix.planPath,
  ...over,
});

const commitThrough = (fix: Fixture, message: string, env: Record<string, string>): { status: number; output: string } => {
  const result = spawnSync('git', ['commit', '-F', '-'], {
    cwd: fix.cwd,
    input: message,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, ...env },
    shell: false,
  });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
};

const headMessage = (cwd: string): string =>
  execFileSync('git', ['show', '--no-patch', '--format=%B', 'HEAD'], { cwd, encoding: 'utf8' });

const pendingFiles = (cwd: string): string[] => {
  const dir = join(cwd, '.git', 'commitlore', 'pending');
  return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.json')) : [];
};

const jevWasCalled = (fix: Fixture): boolean => existsSync(fix.callLog);

/**
 * The producer's own notes, for a failure message.
 *
 * A bare "the record is not in the commit" says nothing about which of eight
 * steps declined, and the diagnostic already holds exactly that. Read only in
 * assertions — never branched on.
 */
const why = (fix: Fixture): string => {
  const path = join(fix.cwd, '.git', 'commitlore', 'jev-last-result.json');
  return existsSync(path) ? readFileSync(path, 'utf8') : '(no diagnostic written)';
};

describe('#1048 the prototype records from a raw conversation', () => {
  it('produces a native record in the actual commit, readable without a key', () => {
    const fix = fixture('happy');
    // The user's constraint is the applicable one; the assistant's
    // acknowledgement below it is narration and comes back `none`.
    plan(fix, 'positive', 'three retries per minute');

    // 1. trigger ran, 2. source available, 3. Jev called.
    const result = commitThrough(fix, 'Raise the retry ceiling\n\nOrdinary prose, no trailers.\n', enabled(fix));
    expect(result.status, result.output).toBe(0);
    expect(jevWasCalled(fix), 'no request was made').toBe(true);

    // 4/5. A draft was accepted AND the record is in the commit — not merely
    // staged. `git show` is the only thing that establishes the second.
    const message = headMessage(fix.cwd);
    expect(message, `${message}\n${why(fix)}`).toContain('Limit:');
    expect(message).toContain('three retries per minute');
    expect(message).toMatch(/Record-Id: r-[a-z0-9]{6,}/);
    // Native capture owns provenance, and an unattended draft is `drafted`.
    expect(message).toContain('Provenance: drafted');

    // 6. A fresh keyless reader gets it back through unchanged tooling.
    const read = cli(fix.cwd, ['limits', 'src.ts'], { COMMITLORE_BIN: binPath });
    expect(read.status, read.output).toBe(0);
    expect(read.stdout).toContain('three retries per minute');
  }, 300_000);

  it('sends the conversation and never the key', () => {
    const fix = fixture('payload');
    plan(fix, 'positive', 'three retries per minute');
    commitThrough(fix, 'Raise the ceiling\n\nOrdinary prose here.\n', enabled(fix));

    const logged = readFileSync(fix.callLog, 'utf8');
    expect(logged).toContain('three retries per minute');
    expect(logged).not.toContain(KEY);
    // The state stays inside the client's own bound.
    const first = JSON.parse(logged.split('\n')[0] ?? '{}') as { stateBytes: number; questions: number };
    expect(first.stateBytes).toBeLessThanOrEqual(64 * 1024);
    expect(first.questions).toBeGreaterThan(0);
  }, 300_000);

  it('makes exactly one request per commit', () => {
    // No retry, no second round trip for the span questions, no repair loop.
    const fix = fixture('onecall');
    plan(fix, 'positive', 'three retries per minute');
    commitThrough(fix, 'Raise the ceiling\n\nOrdinary prose here.\n', enabled(fix));
    const calls = readFileSync(fix.callLog, 'utf8').trim().split('\n').filter((l) => l !== '');
    expect(calls).toHaveLength(1);
  }, 300_000);

  it('records nothing when the model finds nothing, and the commit still succeeds', () => {
    // The legitimate no-decision case. It is not a failure and it is not a
    // reason to try again.
    const fix = fixture('nodecision');
    plan(fix, 'negative');
    const result = commitThrough(fix, 'Raise the ceiling\n\nOrdinary prose here.\n', enabled(fix));
    expect(result.status, result.output).toBe(0);
    expect(jevWasCalled(fix)).toBe(true);
    expect(headMessage(fix.cwd)).not.toContain('Limit:');
    // And no transaction was left behind for `capture gc`.
    expect(pendingFiles(fix.cwd)).toEqual([]);
  }, 300_000);
});

describe('#1048 the disabled path is native', () => {
  it('makes no request and writes no prototype file with no key', () => {
    const fix = fixture('nokey');
    plan(fix, 'positive');
    const result = commitThrough(fix, 'Raise the ceiling\n\nOrdinary prose here.\n', {
      COMMITLORE_BIN: binPath,
      CLAUDE_CODE_SESSION_ID: SESSION,
      COMMITLORE_JEV_TEST_PLAN: fix.planPath,
    });
    expect(result.status, result.output).toBe(0);
    expect(jevWasCalled(fix), 'a request was made without a key').toBe(false);
    expect(headMessage(fix.cwd)).not.toContain('Limit:');
    expect(existsSync(join(fix.cwd, '.git', 'commitlore', 'jev-last-result.json'))).toBe(false);
    expect(result.output).not.toContain('Jev');
  }, 300_000);

  it('makes no request with COMMITLORE_JEV=off, key present', () => {
    const fix = fixture('off');
    plan(fix, 'positive');
    const result = commitThrough(fix, 'Raise the ceiling\n\nOrdinary prose here.\n', enabled(fix, { COMMITLORE_JEV: 'off' }));
    expect(result.status, result.output).toBe(0);
    expect(jevWasCalled(fix)).toBe(false);
    expect(headMessage(fix.cwd)).not.toContain('Limit:');
  }, 300_000);

  it('makes no request without native unattended consent', () => {
    // A key is consent to the remote assessment, never permission to stage
    // without the repository's own consent.
    const fix = fixture('noconsent', { consent: false });
    plan(fix, 'positive');
    const result = commitThrough(fix, 'Raise the ceiling\n\nOrdinary prose here.\n', enabled(fix));
    expect(result.status, result.output).toBe(0);
    expect(jevWasCalled(fix), 'assessed without consent').toBe(false);
    expect(headMessage(fix.cwd)).not.toContain('Limit:');
  }, 300_000);

  it('makes no request with no registered source', () => {
    const fix = fixture('nosource');
    plan(fix, 'positive');
    const result = commitThrough(fix, 'Raise the ceiling\n\nOrdinary prose here.\n', {
      COMMITLORE_BIN: binPath,
      COMMITLORE_JEV_API_KEY: KEY,
      COMMITLORE_JEV_TEST_PLAN: fix.planPath,
      // No CLAUDE_CODE_SESSION_ID.
    });
    expect(result.status, result.output).toBe(0);
    expect(jevWasCalled(fix)).toBe(false);
  }, 300_000);

  it('still refuses an invalid message, with or without a key', () => {
    // A pre-existing native failure stays a failure. The producer runs first and
    // cannot convert it.
    const bad = 'Bad\n\nBlast: worldwide\n';
    for (const [name, env] of [
      ['withkey', enabled(fixture('badkey'))],
      ['nokey', { COMMITLORE_BIN: binPath }],
    ] as const) {
      const fix = fixture(`invalid-${name}`);
      plan(fix, 'positive');
      const result = commitThrough(fix, bad, { ...env, COMMITLORE_JEV_TEST_PLAN: fix.planPath });
      expect(result.status, `${name}: ${result.output}`).not.toBe(0);
      expect(result.output).toContain('enum Blast');
    }
  }, 300_000);
});

describe('#1048 failure isolation', () => {
  const failing = (mode: string, name: string): { fix: Fixture; result: { status: number; output: string } } => {
    const fix = fixture(name);
    plan(fix, mode);
    const result = commitThrough(fix, 'Raise the ceiling\n\nOrdinary prose here.\n', enabled(fix));
    return { fix, result };
  };

  it('leaves a valid commit valid when the provider times out', () => {
    const { fix, result } = failing('timeout', 'timeout');
    expect(result.status, result.output).toBe(0);
    expect(headMessage(fix.cwd)).not.toContain('Limit:');
    expect(headMessage(fix.cwd)).toContain('Raise the ceiling');
    expect(pendingFiles(fix.cwd)).toEqual([]);
  }, 300_000);

  it('leaves a valid commit valid on 401', () => {
    const { fix, result } = failing('http-error', 'http401');
    expect(result.status, result.output).toBe(0);
    expect(headMessage(fix.cwd)).not.toContain('Limit:');
  }, 300_000);

  it('leaves a valid commit valid on a malformed response', () => {
    const { fix, result } = failing('malformed', 'malformed');
    expect(result.status, result.output).toBe(0);
    expect(headMessage(fix.cwd)).not.toContain('Limit:');
  }, 300_000);

  it('cannot turn an empty message into a successful commit', () => {
    // A cancelled commit stays cancelled. The producer must not rescue it by
    // appending text, so it never assesses one.
    //
    // Both shapes, because they are refused by different things. Truly empty
    // input is refused by git whatever the cleanup mode; a comment-only message
    // is empty only *after* cleanup, and `-F` defaults to `whitespace` — so the
    // second case needs `--cleanup=strip` to be the cancelled commit an editor
    // would have produced.
    const empty = fixture('emptymsg');
    plan(empty, 'positive');
    const blank = commitThrough(empty, '', enabled(empty));
    expect(blank.status, blank.output).not.toBe(0);
    expect(jevWasCalled(empty), 'assessed an empty message').toBe(false);

    const comments = fixture('commentmsg');
    plan(comments, 'positive');
    const stripped = spawnSync('git', ['commit', '--cleanup=strip', '-F', '-'], {
      cwd: comments.cwd,
      input: '# everything here is a comment\n#\n',
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, ...enabled(comments) },
      shell: false,
    });
    expect(stripped.status, `${stripped.stdout}${stripped.stderr}`).not.toBe(0);
    expect(jevWasCalled(comments), 'assessed a comment-only message').toBe(false);
  }, 300_000);

  it('yields to a record the message already carries', () => {
    // An authored record wins. The prototype does not rejudge it, add to it, or
    // duplicate it — and this does not count as a Jev capture.
    const fix = fixture('authored');
    plan(fix, 'positive');
    const authored =
      'Raise the ceiling\n\nProse.\n\nLimit: the vendor cap is the binding constraint\n' +
      'Record-Id: r-authored001\nBlast: local\n';
    const result = commitThrough(fix, authored, enabled(fix));
    expect(result.status, result.output).toBe(0);
    expect(jevWasCalled(fix), 'assessed a commit that already had a record').toBe(false);
    const message = headMessage(fix.cwd);
    expect(message).toContain('r-authored001');
    expect(message).not.toContain('three retries per minute');
  }, 300_000);

  it('skips rather than appending after a foreign hook approved the original', () => {
    // The foreign hook checked the original message. Appending text it never saw
    // would make its approval a statement about different bytes, and running it
    // twice would repeat whatever side effect it has.
    const fix = fixture('foreign');
    plan(fix, 'positive');
    const hooks = git(fix.cwd, ['rev-parse', '--git-path', 'hooks']).output.trim();
    const chained = join(fix.cwd, hooks, 'commit-msg.commitlore-chained');
    const witness = join(dirname(fix.planPath), 'foreign-calls');
    writeFileSync(chained, `#!/bin/sh\nprintf 'ran\\n' >> ${JSON.stringify(witness)}\nexit 0\n`, { mode: 0o755 });
    chmodSync(chained, 0o755);

    const result = commitThrough(fix, 'Raise the ceiling\n\nOrdinary prose here.\n', enabled(fix));
    expect(result.status, result.output).toBe(0);
    expect(jevWasCalled(fix), 'appended after a foreign approval').toBe(false);
    // Exactly once.
    expect(readFileSync(witness, 'utf8').trim().split('\n')).toHaveLength(1);
  }, 300_000);

  it('keeps a failing foreign hook failing', () => {
    const fix = fixture('foreignfail');
    plan(fix, 'positive');
    const hooks = git(fix.cwd, ['rev-parse', '--git-path', 'hooks']).output.trim();
    const chained = join(fix.cwd, hooks, 'commit-msg.commitlore-chained');
    writeFileSync(chained, '#!/bin/sh\necho "foreign refused" >&2\nexit 7\n', { mode: 0o755 });
    chmodSync(chained, 0o755);

    const result = commitThrough(fix, 'Raise the ceiling\n\nOrdinary prose here.\n', enabled(fix));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('foreign refused');
  }, 300_000);

  it('skips a path-limited commit rather than binding to its temporary index', () => {
    // `git commit -- <path>` hands the hook an alternate index. A record
    // verified against the full index must not attach to it.
    const fix = fixture('pathlimited');
    plan(fix, 'positive');
    writeFileSync(join(fix.cwd, 'other.ts'), 'export const other = 1;\n');
    const result = spawnSync('git', ['commit', '-F', '-', '--', 'src.ts'], {
      cwd: fix.cwd,
      input: 'Raise the ceiling\n\nOrdinary prose here.\n',
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, ...enabled(fix) },
      shell: false,
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(jevWasCalled(fix), 'assessed a path-limited commit').toBe(false);
  }, 300_000);

  it('skips the amend it can see, without consuming the marker', () => {
    // `prepare-commit-msg` writes `.git/commitlore-amend` when git hands it
    // `commit HEAD`, and `runValidate` *consumes* that marker. So the producer
    // reads it and leaves it: taking it would strip the one signal native
    // validation uses to apply its own duplicate rule to the amend it is about
    // to check.
    const fix = fixture('amend');
    plan(fix, 'positive', 'three retries per minute');
    commitThrough(fix, 'First\n\nOrdinary prose here.\n', enabled(fix, { COMMITLORE_JEV: 'off' }));
    rmSync(fix.callLog, { force: true });

    writeFileSync(join(fix.cwd, 'src.ts'), 'export const retries = 4;\n');
    git(fix.cwd, ['add', '-A']);
    // The editor path, because that is the one git marks as an amend. Measured:
    // `git commit --amend` with an editor hands `prepare-commit-msg`
    // `[.git/COMMIT_EDITMSG] [commit] [HEAD]`, and an ordinary commit with an
    // editor hands it `[.git/COMMIT_EDITMSG] [] []`.
    const editor = join(dirname(fix.planPath), 'editor.sh');
    writeFileSync(editor, '#!/bin/sh\nprintf "First, amended\\n\\nOrdinary prose here.\\n" > "$1"\n', { mode: 0o755 });
    chmodSync(editor, 0o755);
    const result = spawnSync('git', ['commit', '--amend'], {
      cwd: fix.cwd,
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, ...enabled(fix), GIT_EDITOR: editor },
      shell: false,
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(jevWasCalled(fix), 'assessed an amend').toBe(false);
    expect(headMessage(fix.cwd)).toContain('amended');
  }, 300_000);

  it('cannot see an --amend given -m or -F, and is safe when it cannot', () => {
    // Measured, not assumed. With `-m` or `-F`, an amend is byte-for-byte
    // indistinguishable from an ordinary commit at both hook points: git hands
    // `prepare-commit-msg` `[.git/COMMIT_EDITMSG] [message] []` for both, and
    // the hook environment is identical — same seven `GIT_*` variables,
    // `GIT_REFLOG_ACTION` unset in each.
    //
    // So no marker is written, and the producer's amend check — which is
    // native's own check, `r-amendmarker638` — cannot fire. This pins the blind
    // spot and the consequence: the commit succeeds, and anything recorded is
    // the record native verification accepted against the real staged diff and
    // the real source, never a stale one.
    const fix = fixture('amendhidden');
    plan(fix, 'positive', 'three retries per minute');
    commitThrough(fix, 'First\n\nOrdinary prose here.\n', enabled(fix, { COMMITLORE_JEV: 'off' }));

    writeFileSync(join(fix.cwd, 'src.ts'), 'export const retries = 5;\n');
    git(fix.cwd, ['add', '-A']);
    const result = spawnSync('git', ['commit', '--amend', '-F', '-'], {
      cwd: fix.cwd,
      input: 'First, amended\n\nOrdinary prose here.\n',
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, ...enabled(fix) },
      shell: false,
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    const message = headMessage(fix.cwd);
    expect(message).toContain('amended');
    if (message.includes('Limit:')) {
      // If it did record, the value is a verbatim slice of the conversation and
      // the identity is native's — not a fabrication and not a replay.
      expect(message).toContain('three retries per minute');
      expect(message).toMatch(/Record-Id: r-[a-z0-9]{6,}/);
      expect(message).toContain('Provenance: drafted');
    }
  }, 300_000);

  it('does not assess a commit with nothing staged', () => {
    const fix = fixture('nostaged');
    plan(fix, 'positive');
    git(fix.cwd, ['reset', '-q', 'HEAD']);
    const result = spawnSync('git', ['commit', '--allow-empty', '-F', '-'], {
      cwd: fix.cwd,
      input: 'Empty on purpose\n\nOrdinary prose here.\n',
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '', ...GIT_ENV, ...enabled(fix) },
      shell: false,
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(jevWasCalled(fix)).toBe(false);
  }, 300_000);

  it('writes a diagnostic that does not claim a commit exists', () => {
    const fix = fixture('diagnostic');
    plan(fix, 'positive');
    commitThrough(fix, 'Raise the ceiling\n\nOrdinary prose here.\n', enabled(fix));

    const path = join(fix.cwd, '.git', 'commitlore', 'jev-last-result.json');
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, 'utf8');
    expect(body).not.toContain(KEY);
    expect(body).not.toContain('three retries per minute');
    const parsed = JSON.parse(body) as { outcome: string; usage: { inputTokens: number | null } | null };
    expect(parsed.outcome).toBe('published');
    expect(parsed.usage?.inputTokens).toBe(300);
    // "published" is about the message file. Nothing here says "committed".
    expect(body).not.toContain('committed');
  }, 300_000);
});

describe('#1048 native refusals still refuse', () => {
  it('records nothing when the only candidate carries a credential', () => {
    // The value below is synthetic and was never issued. An unsafe unit is
    // withheld rather than masked, so no request claims to have assessed it.
    const conversation = `${JSON.stringify({
      type: 'user',
      isSidechain: false,
      message: { role: 'user', content: 'Rotate AKIA29326ML64LG2TJF8 before release; it is in the old config file.' },
    })}\n`;
    const fix = fixture('secret', { conversation });
    plan(fix, 'positive');
    const result = commitThrough(fix, 'Raise the ceiling\n\nOrdinary prose here.\n', enabled(fix));

    expect(result.status, result.output).toBe(0);
    if (jevWasCalled(fix)) {
      expect(readFileSync(fix.callLog, 'utf8')).not.toContain('AKIA29326ML64LG2TJF8');
    }
    expect(headMessage(fix.cwd)).not.toContain('AKIA');
  }, 300_000);

  it('leaves the original message byte-identical on every skip', () => {
    // The property behind every arm above: an optional failure must not leave
    // the message half-edited.
    const original = 'Raise the ceiling\n\nOrdinary prose here, exactly as written.\n';
    for (const mode of ['timeout', 'http-error', 'malformed', 'negative']) {
      const fix = fixture(`intact-${mode}`);
      plan(fix, mode);
      const result = commitThrough(fix, original, enabled(fix));
      expect(result.status, `${mode}: ${result.output}`).toBe(0);
      expect(headMessage(fix.cwd).trim(), mode).toBe(original.trim());
    }
  }, 300_000);
});
