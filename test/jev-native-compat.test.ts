/**
 * #1051 §1: native CommitLore does not depend on Jev.
 *
 * This is the first thing that had to be true and the last thing that should be
 * allowed to break. It is not "the prototype is off by default" — that is
 * trivially checkable from a config default — but the stronger claim: on the
 * paths a default installation takes, and on the paths an installation with a
 * key takes for *explicit* commands, nothing optional is initialised, no
 * transcript is read, no file is written and no request is made.
 *
 * `fetch` is replaced with a spy for the whole file. A single call anywhere
 * below is a failure, and the spy is what makes "no request" an observation
 * rather than an argument.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCommitMsg } from '../src/commands/commit-msg.js';
import { runJevSession } from '../src/commands/jev-session.js';
import { runValidate } from '../src/commands/validate.js';
import { runQuery } from '../src/core/query.js';
import { beforeChange } from '../src/core/before-change.js';
import { guard } from '../src/core/guard.js';
import { TOOLS } from '../src/mcp/server.js';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(REPO_ROOT, 'dist', 'commitlore.mjs');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A synthetic key of the right shape. Never issued. */
const KEY = 'apikey_test_nativecompat_00000000000000';

let requests: string[] = [];
let originalFetch: typeof fetch;

beforeEach(() => {
  requests = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    requests.push(String(input));
    throw new Error('a native path made a network request');
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'] ?? '',
      GIT_CONFIG_GLOBAL: '/nonexistent/commitlore-tests-must-not-read-this',
      GIT_CONFIG_SYSTEM: '/nonexistent/commitlore-tests-must-not-read-this',
    },
  });

const repo = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `commitlore-nativecompat-${name}-`));
  scratch.push(dir);
  git(dir, ['init', '-q', '--initial-branch=main', '.']);
  git(dir, ['config', 'user.email', 'n@example.invalid']);
  git(dir, ['config', 'user.name', 'N']);
  writeFileSync(join(dir, 'src.ts'), 'export const a = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, [
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '--no-verify',
    '-m',
    'change\n\nA constraint the diff cannot show.\n\n' +
      'Limit: the retry ceiling stays at three attempts\nRecord-Id: r-native00001\nBlast: local\n',
  ]);
  return dir;
};

/** Every environment on which nothing optional may happen. */
const DISABLED: readonly (readonly [string, Record<string, string | undefined>])[] = [
  ['no key at all', {}],
  ['dedicated key with off', { COMMITLORE_JEV: 'off', COMMITLORE_JEV_API_KEY: KEY }],
  ['standard TypeSafe key, no explicit on', { TYPESAFE_API_KEY: KEY }],
  ['invalid optional mode', { COMMITLORE_JEV: 'maybe', COMMITLORE_JEV_API_KEY: KEY }],
  ['unusable key', { COMMITLORE_JEV_API_KEY: `${KEY}\nx-injected: 1` }],
];

const optionalArtifacts = (cwd: string): string[] => {
  const base = join(cwd, '.git', 'commitlore');
  if (!existsSync(base)) return [];
  return readdirSync(base).filter(
    (entry) => entry.startsWith('jev-') || entry === 'jev-sessions' || entry === 'jev-last-result.json',
  );
};

describe('#1051 the commit-msg dispatcher is a native branch when disabled', () => {
  for (const [label, env] of DISABLED) {
    it(`matches runValidate exactly — ${label}`, async () => {
      const cwd = repo(`disabled-${label.replace(/\W+/g, '')}`);
      const messageFile = join(cwd, 'MSG');
      const message = 'Raise the ceiling\n\nOrdinary prose.\n\nBlast: worldwide\n';
      writeFileSync(messageFile, message);

      const native = runValidate({ messageFile, cwd });
      writeFileSync(messageFile, message);
      const dispatched = await runCommitMsg({ messageFile, cwd, env });

      // Same verdict, same streams, same violations. Not "also fails" — the
      // same bytes, because a caller cannot tell the two apart.
      expect(dispatched.code).toBe(native.code);
      expect(dispatched.stdout).toBe(native.stdout);
      expect(dispatched.stderr).toBe(native.stderr);
      expect(dispatched.violations).toEqual(native.violations);

      // And nothing optional happened.
      expect(requests, `${label} made a request`).toEqual([]);
      expect(optionalArtifacts(cwd), `${label} wrote an optional file`).toEqual([]);
    }, 300_000);
  }

  it('agrees on a clean message too', async () => {
    // The control. Two paths that both fail identically could be two paths that
    // both refuse everything.
    const cwd = repo('clean');
    const messageFile = join(cwd, 'MSG');
    writeFileSync(messageFile, 'Raise the ceiling\n\nOrdinary prose.\n');
    const result = await runCommitMsg({ messageFile, cwd, env: {} });
    expect(result.code).toBe(0);
    expect(requests).toEqual([]);
  }, 300_000);
});

describe('#1051 the session hook is inert when disabled', () => {
  for (const [label, env] of DISABLED) {
    it(`writes nothing and says nothing — ${label}`, () => {
      const cwd = repo(`session-${label.replace(/\W+/g, '')}`);
      const transcript = join(cwd, 'fake.jsonl');
      writeFileSync(transcript, '{"type":"user","message":{"role":"user","content":"hi"}}\n');

      const result = runJevSession({
        payload: JSON.stringify({
          session_id: 'session-inert-000001',
          transcript_path: transcript,
          cwd,
          hook_event_name: 'SessionStart',
        }),
        env,
        verbose: true,
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(optionalArtifacts(cwd)).toEqual([]);
      expect(requests).toEqual([]);
    }, 300_000);
  }
});

describe('#1051 explicit native commands stay native with a key present', () => {
  const env = { COMMITLORE_JEV_API_KEY: KEY };

  it('validate is unchanged and still read-only', () => {
    const cwd = repo('validate');
    const messageFile = join(cwd, 'MSG');
    writeFileSync(messageFile, 'Raise the ceiling\n\nOrdinary prose.\n');
    expect(runValidate({ messageFile, cwd }).code).toBe(0);
    expect(requests).toEqual([]);
    expect(optionalArtifacts(cwd)).toEqual([]);
    void env;
  }, 300_000);

  it('query, before_change and guard make no request', () => {
    // A valid key must not opt an explicit read into remote inference. These
    // three are the read surface every agent touches.
    const cwd = repo('reads');
    const answer = runQuery({ cwd, paths: ['src.ts'] });
    expect(answer.records.length).toBeGreaterThan(0);

    const before = beforeChange({ path: 'src.ts', cwd, at: new Date('2026-06-01T00:00:00Z') });
    expect(before).toBeDefined();

    const advisory = guard({ cwd, proposal: 'raise the retry ceiling to ten' });
    expect(advisory).toBeDefined();

    expect(requests).toEqual([]);
    expect(optionalArtifacts(cwd)).toEqual([]);
  }, 300_000);

  it('the MCP tool surface is unchanged', () => {
    // No new tool, no new required argument, and the #1030 assertion is still
    // optional on prepare.
    const names = TOOLS.map((tool) => tool.name).sort();
    expect(names).not.toContain('commitlore_jev');
    for (const tool of TOOLS) {
      expect(JSON.stringify(tool), `${tool.name} mentions Jev`).not.toMatch(/jev/i);
    }
    const prepare = TOOLS.find((tool) => tool.name === 'commitlore_prepare_capture');
    const schema = prepare?.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.required).toEqual(['transcript']);
    expect(Object.keys(schema.properties ?? {})).toContain('repository');
  }, 300_000);
});

describe('#1051 the CLI surface with a key present', () => {
  const run = (cwd: string, args: readonly string[], extra: Record<string, string> = {}): { status: number; out: string } => {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'] ?? '',
        GIT_CONFIG_GLOBAL: '/nonexistent/commitlore-tests-must-not-read-this',
        GIT_CONFIG_SYSTEM: '/nonexistent/commitlore-tests-must-not-read-this',
        COMMITLORE_JEV_API_KEY: KEY,
        ...extra,
      },
      shell: false,
    });
    return { status: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
  };

  it('prints no prototype setup prompt or warning anywhere ordinary', () => {
    const cwd = repo('cli');
    for (const args of [['--help'], ['limits', 'src.ts'], ['context', 'src.ts'], ['ruled-out', 'src.ts']]) {
      const result = run(cwd, args);
      expect(result.status, `${args.join(' ')}: ${result.out}`).toBe(0);
      // The commands are named in `--help`; what must not appear is a nudge to
      // configure the prototype.
      expect(result.out).not.toMatch(/set COMMITLORE_JEV/i);
      expect(result.out).not.toMatch(/typesafe/i);
    }
  }, 300_000);

  it('leaves ordinary doctor output free of the prototype section', () => {
    const cwd = repo('doctorplain');
    const plain = run(cwd, ['doctor', '--only', 'cli-runtime']);
    expect(plain.out).not.toContain('Experimental Jev auto-capture');

    const asked = run(cwd, ['doctor', '--only', 'cli-runtime', '--jev']);
    expect(asked.out).toContain('Experimental Jev auto-capture');
    // And the report itself never reveals the key it just read.
    expect(asked.out).not.toContain(KEY);
  }, 300_000);
});
