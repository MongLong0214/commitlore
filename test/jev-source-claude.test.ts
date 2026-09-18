/**
 * #1049: one supported source, bound exactly, decoded conservatively.
 *
 * The fixtures below are sanitized from a real observed transcript of
 * claude-code — a 47 MB `.jsonl` at
 * `~/.claude/projects/<slug>/<session-id>.jsonl`. What that observation
 * established, and what these tests therefore pin:
 *
 * - `CLAUDE_CODE_SESSION_ID` is propagated to a Bash tool command, and so to a
 *   `git commit` and its hooks. It is the lookup key.
 * - `CLAUDE_CODE_CHILD_SESSION` is set in a child session. It is the host
 *   identity signal that denies root-actor status.
 * - The container mixes `user`, `assistant`, `attachment`, `system` and a dozen
 *   bookkeeping record types; `message.content` is a string for a typed user
 *   prompt and an array of `text` / `thinking` / `tool_use` / `tool_result`
 *   blocks otherwise.
 * - Command output arrives wearing `type: "user"` inside
 *   `<local-command-stdout>`, and injected context arrives inside
 *   `<system-reminder>`. Both would let a tool's output author a record.
 *
 * Live support in an installed host is proved separately and is reported as
 * such; nothing here manufactures that.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import type { ConversationSource } from '../src/jev/source.js';
import {
  CHILD_ENV,
  descriptorDir,
  forgetClaudeSession,
  readClaudeSource,
  registerClaudeSession,
  SESSION_ENV,
  sourceStillCurrent,
} from '../src/jev/source-claude.js';

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (dir: string, args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });

const temporary = (name: string): string => {
  // `realpath` through `mkdtemp`'s parent: on macOS `/tmp` is a symlink, and the
  // descriptor compares resolved paths.
  const dir = mkdtempSync(join(tmpdir(), `commitlore-jevsrc-${name}-`));
  scratch.push(dir);
  return dir;
};

const repo = (name: string): string => {
  const dir = temporary(name);
  git(dir, ['init', '-q', '--initial-branch=main', '.']);
  git(dir, ['config', 'user.email', 'src@example.invalid']);
  git(dir, ['config', 'user.name', 'Src']);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'init']);
  return git(dir, ['rev-parse', '--show-toplevel']).trim();
};

/** One container line, in the shape the real transcript uses. */
const line = (record: unknown): string => `${JSON.stringify(record)}\n`;

const userText = (text: string, extra: Record<string, unknown> = {}): string =>
  line({ type: 'user', isSidechain: false, message: { role: 'user', content: text }, ...extra });

const assistantText = (text: string, extra: Record<string, unknown> = {}): string =>
  line({
    type: 'assistant',
    isSidechain: false,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    ...extra,
  });

const CONVERSATION =
  userText('The vendor caps us at three retries per minute, so the ceiling stays at three.') +
  assistantText('Understood — I will keep the retry ceiling at three attempts.');

const transcriptIn = (dir: string, body: string, name = 'session.jsonl'): string => {
  const path = join(dir, name);
  writeFileSync(path, body, 'utf8');
  return path;
};

const SESSION = 'session-abc123-0000';

const registered = (name: string, body = CONVERSATION): { cwd: string; transcript: string } => {
  const cwd = repo(name);
  const host = temporary(`${name}-host`);
  const transcript = transcriptIn(host, body);
  const result = registerClaudeSession({ cwd, sessionId: SESSION, transcriptPath: transcript });
  expect(result.status, JSON.stringify(result)).toBe('registered');
  return { cwd, transcript };
};

const env = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  [SESSION_ENV]: SESSION,
  ...over,
});

describe('#1049 nothing happens without a registered session', () => {
  it('reports no-session with an empty environment', () => {
    const cwd = repo('nosession');
    const result = readClaudeSource({ cwd, env: {} });
    expect(result.status).toBe('unavailable');
    expect(result.status === 'unavailable' && result.reason).toBe('no-session');
  }, 300_000);

  it('reports not-registered for a session id nobody registered', () => {
    // Told apart from `no-session` on purpose: this one is fixed by restarting
    // the host, and that is what the message says.
    const cwd = repo('unregistered');
    const result = readClaudeSource({ cwd, env: env({ [SESSION_ENV]: 'session-never-seen-1' }) });
    expect(result.status === 'unavailable' && result.reason).toBe('not-registered');
  }, 300_000);

  it('denies root-actor status when the host says this is a child session', () => {
    // An inherited session id is not proof of being the registered root actor.
    // Measured: the host sets this in a child session.
    const { cwd } = registered('child');
    const result = readClaudeSource({ cwd, env: env({ [CHILD_ENV]: '1' }) });
    expect(result.status === 'unavailable' && result.reason).toBe('not-root-session');
  }, 300_000);

  it('does not guess at a source from the newest file anywhere', () => {
    // A descriptor for another session must not answer for this one. No global
    // "latest session" pointer and no newest-mtime scan: two sessions in two
    // worktrees is the ordinary case, and a wrong answer there records one
    // branch's decisions onto another's commit.
    const { cwd } = registered('otherid');
    const result = readClaudeSource({ cwd, env: env({ [SESSION_ENV]: 'session-different-99' }) });
    expect(result.status === 'unavailable' && result.reason).toBe('not-registered');
  }, 300_000);
});

describe('#1049 the binding is exact', () => {
  it('reads the transcript the descriptor names', () => {
    const { cwd } = registered('happy');
    const result = readClaudeSource({ cwd, env: env() });
    expect(result.status, JSON.stringify(result)).toBe('available');
    if (result.status !== 'available') return;
    expect(result.source.text).toContain('three retries per minute');
    expect(result.source.blocks).toHaveLength(2);
    expect(result.source.blocks[0]?.role).toBe('user');
    expect(result.source.blocks[1]?.role).toBe('assistant');
  }, 300_000);

  it('gives every block offsets that reproduce its own text', () => {
    // The invariant the whole module rests on: every quote handed to native
    // verification is `text.slice(start, end)`, so an off-by-one here would
    // surface much later as an unexplained verification rejection.
    const { cwd } = registered('offsets');
    const result = readClaudeSource({ cwd, env: env() });
    if (result.status !== 'available') throw new Error('fixture produced no source');
    for (const block of result.source.blocks) {
      const slice = result.source.text.slice(block.start, block.end);
      expect(slice.trim()).toBe(slice);
      expect(slice.length).toBeGreaterThan(0);
      // Line numbers are counted in the canonical string, not in the container.
      expect(result.source.text.slice(0, block.start).split('\n').length).toBe(block.startLine);
    }
  }, 300_000);

  it('refuses a descriptor that names another worktree', () => {
    const { cwd } = registered('mine');
    const other = repo('theirs');
    // Register the same session id in the other tree, then ask from there with
    // a descriptor that points at the first.
    const result = readClaudeSource({ cwd: other, env: env() });
    expect(result.status === 'unavailable' && result.reason).toBe('not-registered');
    expect(cwd).not.toBe(other);
  }, 300_000);

  it('keeps two linked worktrees apart', () => {
    // Two sessions in two worktrees of one repository is the ordinary case, and
    // the descriptor lives in each worktree's own git directory so neither can
    // read the other's.
    const base = temporary('twotrees');
    const main = join(base, 'main');
    mkdirSync(main, { recursive: true });
    git(main, ['init', '-q', '--initial-branch=main', '.']);
    git(main, ['config', 'user.email', 'wt@example.invalid']);
    git(main, ['config', 'user.name', 'WT']);
    writeFileSync(join(main, 'a.txt'), 'a\n');
    git(main, ['add', '-A']);
    git(main, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'init']);
    const linked = join(base, 'linked');
    git(main, ['worktree', 'add', '-q', '-b', 'feature', linked]);

    const host = temporary('twotrees-host');
    registerClaudeSession({
      cwd: main,
      sessionId: SESSION,
      transcriptPath: transcriptIn(host, CONVERSATION, 'main.jsonl'),
    });

    // The linked worktree has no descriptor of its own.
    expect(
      readClaudeSource({ cwd: linked, env: env() }).status === 'unavailable',
    ).toBe(true);
    // And the descriptor directories are genuinely different files.
    expect(descriptorDir(main)).not.toBe(descriptorDir(linked));
  }, 300_000);

  it('handles a transcript path with spaces, quotes and Unicode', () => {
    const cwd = repo('oddpath');
    const host = temporary('odd host');
    const path = transcriptIn(host, CONVERSATION, "se'ssion 한글 파일.jsonl");
    const result = registerClaudeSession({ cwd, sessionId: SESSION, transcriptPath: path });
    expect(result.status).toBe('registered');
    const read = readClaudeSource({ cwd, env: env() });
    expect(read.status).toBe('available');
  }, 300_000);

  it('never writes a key or a transcript copy into the descriptor', () => {
    const { cwd, transcript } = registered('nosecret');
    const dir = descriptorDir(cwd);
    expect(dir).not.toBeNull();
    if (dir === null) return;
    const body = execFileSync('cat', [resolve(dir, `${SESSION}.json`)], { encoding: 'utf8' });
    expect(body).toContain(transcript);
    expect(body).not.toContain('three retries per minute');
    for (const key of ['COMMITLORE_JEV_API_KEY', 'TYPESAFE_API_KEY', 'apikey_', 'Bearer']) {
      expect(body).not.toContain(key);
    }
    // 0o600: identity rather than content, and still nobody else's business.
    expect(statSync(resolve(dir, `${SESSION}.json`)).mode & 0o777).toBe(0o600);
  }, 300_000);

  it('refuses to register a transcript that is not a readable regular file', () => {
    // A descriptor pointing at nothing turns "not registered, restart the host"
    // into "registered and unreadable", which is a worse answer.
    const cwd = repo('badtranscript');
    const host = temporary('badtranscript-host');
    expect(
      registerClaudeSession({ cwd, sessionId: SESSION, transcriptPath: join(host, 'missing.jsonl') })
        .status,
    ).toBe('skipped');
    expect(
      registerClaudeSession({ cwd, sessionId: SESSION, transcriptPath: host }).status,
    ).toBe('skipped');
  }, 300_000);

  it('forgets one session without touching another', () => {
    const cwd = repo('forget');
    const host = temporary('forget-host');
    registerClaudeSession({
      cwd,
      sessionId: SESSION,
      transcriptPath: transcriptIn(host, CONVERSATION, 'one.jsonl'),
    });
    registerClaudeSession({
      cwd,
      sessionId: 'session-second-0000',
      transcriptPath: transcriptIn(host, CONVERSATION, 'two.jsonl'),
    });
    expect(forgetClaudeSession(cwd, SESSION)).toBe(true);
    expect(readClaudeSource({ cwd, env: env() }).status).toBe('unavailable');
    expect(
      readClaudeSource({ cwd, env: env({ [SESSION_ENV]: 'session-second-0000' }) }).status,
    ).toBe('available');
  }, 300_000);
});

describe('#1049 what is not authored speech', () => {
  const decoded = (body: string): string | null => {
    const { cwd } = registered(`decode-${String(Math.random()).slice(2, 8)}`, body);
    const result = readClaudeSource({ cwd, env: env() });
    return result.status === 'available' ? result.source.text : null;
  };

  it('excludes hidden reasoning, tool arguments and tool output', () => {
    const body =
      line({
        type: 'assistant',
        isSidechain: false,
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'HIDDEN REASONING must never be recorded' },
            { type: 'tool_use', name: 'Bash', input: { command: 'TOOL ARGUMENT' } },
            { type: 'text', text: 'The retry ceiling stays at three attempts for this release.' },
          ],
        },
      }) +
      line({
        type: 'user',
        isSidechain: false,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', content: 'TOOL OUTPUT from a command' }],
        },
      });

    const text = decoded(body);
    expect(text).not.toBeNull();
    expect(text).toContain('retry ceiling stays at three');
    for (const excluded of ['HIDDEN REASONING', 'TOOL ARGUMENT', 'TOOL OUTPUT']) {
      expect(text, `${excluded} reached the source`).not.toContain(excluded);
    }
  }, 300_000);

  it('excludes command output that arrives wearing a user role', () => {
    // Observed in a real transcript: `<local-command-stdout>` is literally
    // command output as `type: "user"`. A reader that took it for a user
    // statement would let a tool's output author a record — through a door that
    // is not `tool_result`.
    const body =
      userText('<local-command-stdout>Set model to `Opus 5` and saved as default</local-command-stdout>') +
      userText('<command-name>/model</command-name>') +
      userText('The vendor caps us at three retries per minute on that endpoint.');

    const text = decoded(body);
    expect(text).not.toBeNull();
    expect(text).toContain('three retries per minute');
    expect(text).not.toContain('Set model to');
    expect(text).not.toContain('/model');
  }, 300_000);

  it('excludes injected context and old memories', () => {
    const body =
      userText('<system-reminder>A MEMORY written in an earlier session</system-reminder>') +
      line({
        type: 'attachment',
        isSidechain: false,
        attachment: { type: 'memory', content: 'AN OLD INJECTED MEMORY' },
      }) +
      userText('The deploy window is thirty minutes and cannot be extended.');

    const text = decoded(body);
    expect(text).not.toBeNull();
    expect(text).toContain('deploy window is thirty minutes');
    expect(text).not.toContain('A MEMORY');
    expect(text).not.toContain('AN OLD INJECTED MEMORY');
  }, 300_000);

  it('excludes a subagent transcript', () => {
    // An inherited token does not make a nested actor the registered root, and
    // a sidechain record is not this session's speech.
    const body =
      line({
        type: 'user',
        isSidechain: true,
        message: { role: 'user', content: 'A SUBAGENT INSTRUCTION nobody in this session gave' },
      }) + userText('The vendor caps us at three retries per minute on that endpoint.');

    const text = decoded(body);
    expect(text).not.toBeNull();
    expect(text).not.toContain('SUBAGENT INSTRUCTION');
  }, 300_000);

  it('calls a transcript of recognised bookkeeping no-visible-messages', () => {
    // Records this adapter reads and correctly omits. The conversation held
    // nothing visible — which is a different fact from "I could not read it",
    // and the case below is the other side of that distinction.
    const onlyNoise = registered('noise', line({ type: 'mode', mode: 'default', sessionId: SESSION }));
    const noise = readClaudeSource({ cwd: onlyNoise.cwd, env: env() });
    expect(noise.status === 'unavailable' && noise.reason).toBe('no-visible-messages');
  }, 300_000);

  it('calls a transcript that vanished after registration unreadable', () => {
    const { cwd, transcript } = registered('gone');
    rmSync(transcript, { force: true });
    const result = readClaudeSource({ cwd, env: env() });
    expect(result.status === 'unavailable' && result.reason).toBe('transcript-unreadable');
  }, 300_000);

  it('calls an unrecognised container shape unsupported, not empty', () => {
    // "I could not read this" and "there was nothing in it" are different
    // facts, and only the second would justify reporting no decision found.
    const body = Array.from({ length: 5 }, (_, index) =>
      line({ type: 'some-future-record-type', payload: index }),
    ).join('');
    const { cwd } = registered('future', body);
    const result = readClaudeSource({ cwd, env: env() });
    expect(result.status === 'unavailable' && result.reason).toBe('unsupported-format');
  }, 300_000);

  it('does not treat a window-cut first line as a malformed transcript', () => {
    // Only the first line of a mid-file read can be a fragment, and it is
    // truncation rather than corruption. Reported by never enumerating that
    // block as a candidate.
    const filler = userText('x'.repeat(2000));
    const body = filler.repeat(120) + CONVERSATION;
    const { cwd } = registered('cut', body);
    const result = readClaudeSource({ cwd, env: env() });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.source.coverage.complete, 'the window should have been bounded').toBe(false);
    expect(result.source.coverage.bytesInspected).toBeLessThan(result.source.size);
  }, 300_000);
});

describe('#1049 against the real container shape', () => {
  /**
   * `test/fixtures/claude-transcript-shape.jsonl` is twenty records taken from
   * an actual Claude Code transcript (host 2.1.271, macOS 26.3) and sanitized
   * before being committed — see `test/fixtures/README.md` for what was kept
   * and what was removed.
   *
   * A hand-written fixture only tests the reader against what its author
   * already believed the format was. This one is the format.
   */
  const FIXTURE = join(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures',
    'claude-transcript-shape.jsonl',
  );

  const realShape = (name: string): ConversationSource => {
    const cwd = repo(`realshape-${name}`);
    const host = temporary(`realshape-${name}-host`);
    const transcript = transcriptIn(host, readFileSync(FIXTURE, 'utf8'));
    expect(
      registerClaudeSession({ cwd, sessionId: SESSION, transcriptPath: transcript }).status,
    ).toBe('registered');
    const result = readClaudeSource({ cwd, env: env() });
    expect(result.status, JSON.stringify(result)).toBe('available');
    if (result.status !== 'available') throw new Error('the fixture produced no source');
    return result.source;
  };

  it('reads it, rather than calling twenty real record types unsupported', () => {
    const source = realShape('reads');
    expect(source.blocks.length).toBeGreaterThan(0);
    // Most of the file is bookkeeping and injected context, and the reader knows
    // it is bookkeeping rather than failing to parse it.
    expect(source.coverage.recordsOmitted).toBeGreaterThan(0);
    expect(
      source.coverage.unknownForms,
      'a record type this host actually writes was unrecognised',
    ).toBe(0);
  }, 300_000);

  it('lets none of the four excluded kinds become authored speech', () => {
    // The fixture carries a marker string in each: hidden reasoning, tool
    // arguments, tool output and a host wrapper. Every one of them is a door a
    // record could have come through.
    const source = realShape('excludes');
    for (const marker of [
      'HIDDEN REASONING',
      'TOOL ARGUMENT',
      'TOOL OUTPUT',
      'HOST WRAPPER CONTENT',
    ]) {
      expect(source.text, `${marker} reached the canonical source`).not.toContain(marker);
    }
    // And the real speech did survive, so the exclusions are not just deleting
    // everything.
    expect(source.text).toContain('three retries per minute');
  }, 300_000);

  it('keeps its offsets exact against the real shape', () => {
    const source = realShape('offsets');
    for (const block of source.blocks) {
      const slice = source.text.slice(block.start, block.end);
      expect(slice.length).toBeGreaterThan(0);
      expect(slice.trim()).toBe(slice);
      expect(source.text.slice(0, block.start).split('\n').length).toBe(block.startLine);
    }
  }, 300_000);

  it('carries no trace of the session it was taken from', () => {
    // The fixture is committed, so this is the assertion that keeps it
    // committable. The sanitizer checks the same strings before writing; this
    // checks the file that is actually in the repository.
    const body = readFileSync(FIXTURE, 'utf8');
    for (const needle of ['commitlore', 'Isaac', 'apikey', 'MongLong', '8db38ace']) {
      expect(body, `the committed fixture contains ${needle}`).not.toContain(needle);
    }
  }, 300_000);
});

describe('#1049 the post-request recheck', () => {
  it('accepts a transcript that only grew', () => {
    // The transcript is appended to on every turn, including by the session that
    // is committing. Re-reading "the tail" would find different bytes on
    // essentially every commit and reject all of them; the question is whether
    // the *assessed region* still says what it said.
    const { cwd, transcript } = registered('grew');
    const result = readClaudeSource({ cwd, env: env() });
    if (result.status !== 'available') throw new Error('fixture produced no source');

    writeFileSync(transcript, CONVERSATION + userText('A later turn, after the assessment.'), 'utf8');
    expect(sourceStillCurrent(result.source)).toBe(true);
  }, 300_000);

  it('refuses a transcript that was replaced', () => {
    const { cwd, transcript } = registered('replaced');
    const result = readClaudeSource({ cwd, env: env() });
    if (result.status !== 'available') throw new Error('fixture produced no source');

    writeFileSync(transcript, userText('Entirely different content of the same length ~~~~~~'), 'utf8');
    expect(sourceStillCurrent(result.source)).toBe(false);
  }, 300_000);

  it('refuses a transcript that was truncated', () => {
    const { cwd, transcript } = registered('truncated');
    const result = readClaudeSource({ cwd, env: env() });
    if (result.status !== 'available') throw new Error('fixture produced no source');

    writeFileSync(transcript, '', 'utf8');
    expect(sourceStillCurrent(result.source)).toBe(false);
  }, 300_000);

  it('refuses a transcript that is gone', () => {
    const { cwd, transcript } = registered('removed');
    const result = readClaudeSource({ cwd, env: env() });
    if (result.status !== 'available') throw new Error('fixture produced no source');

    rmSync(transcript, { force: true });
    expect(sourceStillCurrent(result.source)).toBe(false);
  }, 300_000);
});
