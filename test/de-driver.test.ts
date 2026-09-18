/**
 * The measured actor driver — #1035, revision `native-efficacy-r6.1`.
 *
 * Real child processes, not mocks: the issue asks for "real fake-child
 * processes and actual driver modules", and every property here is about what
 * a pipe actually does. The children are small node scripts, so nothing needs
 * credentials and no live call is made.
 *
 * The cases #1035 names by hand: "long Korean stdin once; EPIPE;
 * chunked/truncated JSON; complete raw logs ... Test frozen child settings
 * differ from mutable HOME, keys absent and prototype modules unnecessary."
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { childEnv, PRE_SPAWN, runMeasured, STRIPPED_ENV_KEYS } from '../bench/de/driver.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const workspace = (name: string): string => {
  const root = mkdtempSync(join(tmpdir(), `de-driver-${name}-`));
  roots.push(root);
  mkdirSync(join(root, 'out'), { recursive: true });
  return root;
};

/** A fake child. Receives the prompt on stdin like the real host does. */
const fakeChild = (root: string, body: string): string => {
  const path = join(root, 'child.mjs');
  writeFileSync(path, body);
  return path;
};

const run = (root: string, child: string, over: Partial<Parameters<typeof runMeasured>[0]> = {}) =>
  runMeasured({
    executable: process.execPath,
    args: [child],
    prompt: 'hello',
    cwd: root,
    outDir: join(root, 'out'),
    env: { PATH: process.env['PATH'] ?? '' },
    timeoutMs: 15_000,
    label: 'solve',
    ...over,
  });

/** Reads all of stdin, then reports what it got. */
const ECHO_CHILD = `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ type: 'received', bytes: Buffer.byteLength(input), text: input }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result' }) + '\\n');
});
`;

describe('#1035 the prompt travels on stdin, once, and never in argv', () => {
  it('delivers a long Korean prompt byte-for-byte', async () => {
    // Multi-byte on purpose: the decoder, not `chunk.toString()`, is what keeps
    // a character split across two chunks from becoming two replacements.
    const root = workspace('korean');
    const prompt = `${'기록은 diff 가 보여줄 수 없는 것을 적는다. '.repeat(400)}끝`;

    const result = await run(root, fakeChild(root, ECHO_CHILD), { prompt });
    const received = result.events.find((event) => (event as { type: string }).type === 'received') as {
      bytes: number;
      text: string;
    };

    expect(received.bytes).toBe(Buffer.byteLength(prompt, 'utf8'));
    expect(received.text).toBe(prompt);
    expect(result.stdinDelivered).toBe('complete');
    // And the exact bytes are on disk independently of what the child reported.
    expect(readFileSync(result.promptPath, 'utf8')).toBe(prompt);
    expect(result.promptBytes).toBe(Buffer.byteLength(prompt, 'utf8'));
  });

  it('sends it exactly once', async () => {
    const root = workspace('once');
    const prompt = 'MARKER-ONLY-ONCE';

    const result = await run(root, fakeChild(root, ECHO_CHILD), { prompt });
    const received = result.events.find((event) => (event as { type: string }).type === 'received') as {
      text: string;
    };

    expect(received.text.split(prompt)).toHaveLength(2);
  });

  it('refuses before spawning when the prompt is in argv', async () => {
    // The likely mistake: a caller assembling args from the legacy driver's
    // shape, which does pass the prompt there. A prompt on the command line is
    // readable by every process on the machine.
    const root = workspace('argv');
    const child = fakeChild(root, ECHO_CHILD);

    await expect(run(root, child, { args: [child, 'hello'] })).rejects.toThrow(
      new RegExp(`${PRE_SPAWN} the prompt appears in argv`),
    );
  });
});

describe('#1035 a child that closes stdin early does not take the run down', () => {
  it('records EPIPE rather than throwing or retrying', async () => {
    const root = workspace('epipe');
    const child = fakeChild(
      root,
      `
process.stdin.destroy();
process.stdout.write(JSON.stringify({ type: 'result', note: 'did not read stdin' }) + '\\n');
`,
    );

    const result = await run(root, child, { prompt: 'x'.repeat(2 * 1024 * 1024) });

    // Measured five times: `epipe` every time. A hedged assertion accepting
    // `complete` too would pass however the driver behaved, which is the one
    // thing this case exists to rule out.
    expect(result.stdinDelivered).toBe('epipe');
    expect(result.events).toHaveLength(1);
    expect(result.exitCode).toBe(0);
  });
});

describe('#1035 truncation is reported, not dropped', () => {
  it('keeps a final complete event that has no trailing newline', async () => {
    // Ordinary, not an error: the last write of a run often lacks the newline.
    const root = workspace('no-newline');
    const child = fakeChild(
      root,
      `
process.stdout.write(JSON.stringify({ type: 'a' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', last: true }));
`,
    );

    const result = await run(root, child);

    expect(result.events).toHaveLength(2);
    expect(result.incompleteTrailing).toBeNull();
  });

  it('flags a trailing fragment that does not parse', async () => {
    // The event this run was cut off mid-write is the one worth having, so the
    // fragment is surfaced rather than silently making a truncated run look
    // like a shorter complete one.
    const root = workspace('truncated');
    const child = fakeChild(
      root,
      `
process.stdout.write(JSON.stringify({ type: 'a' }) + '\\n');
process.stdout.write('{"type":"result","usage":{"input_tok');
`,
    );

    const result = await run(root, child);

    expect(result.events).toHaveLength(1);
    expect(result.incompleteTrailing).toBe('{"type":"result","usage":{"input_tok');
  });

  it('reassembles a multi-byte character split across two chunks', async () => {
    // The Korean prompt case above does *not* cover this: it passes against a
    // `chunk.toString("utf8")` implementation, because nothing forces a chunk
    // boundary to land inside a character. Here the child writes one JSON line
    // as two buffers cut mid-character on purpose, so the decoder is the only
    // thing that can put it back together — without it the line becomes
    // replacement characters and fails to parse.
    const root = workspace('split');
    const child = fakeChild(
      root,
      `
const line = JSON.stringify({ type: 'result', text: '결정적으로' }) + '\\n';
const buf = Buffer.from(line, 'utf8');
const cut = buf.indexOf(Buffer.from('결', 'utf8')) + 1; // one byte into a 3-byte character
process.stdout.write(buf.subarray(0, cut));
setTimeout(() => process.stdout.write(buf.subarray(cut)), 50);
`,
    );

    const result = await run(root, child);

    expect(result.unparsedLines).toBe(0);
    expect(result.events).toHaveLength(1);
    expect((result.events[0] as { text: string }).text).toBe('결정적으로');
  });

  it('counts a non-JSON line without discarding the run', async () => {
    const root = workspace('noise');
    const child = fakeChild(
      root,
      `
process.stdout.write('warning: something on stdout that is not JSON\\n');
process.stdout.write(JSON.stringify({ type: 'result' }) + '\\n');
`,
    );

    const result = await run(root, child);

    expect(result.unparsedLines).toBe(1);
    expect(result.events).toHaveLength(1);
  });
});

describe('#1035 the raw logs are complete and opened before the spawn', () => {
  it('writes every stdout byte and every stderr byte to their own files', async () => {
    const root = workspace('raw');
    const child = fakeChild(
      root,
      `
process.stderr.write('a diagnostic line\\n');
process.stdout.write(JSON.stringify({ type: 'result' }) + '\\n');
`,
    );

    const result = await run(root, child);

    expect(readFileSync(result.stdoutPath, 'utf8')).toContain('"type":"result"');
    expect(readFileSync(result.stderrPath, 'utf8')).toBe('a diagnostic line\n');
  });

  it('refuses before any child exists when the output directory is unwritable', async () => {
    // "A pre-spawn storage failure prevents inference." Spawning first and
    // finding out afterwards spends the money and keeps none of the evidence.
    const root = workspace('nostorage');
    const child = fakeChild(root, ECHO_CHILD);

    await expect(run(root, child, { outDir: join(root, 'no', 'such', 'dir') })).rejects.toThrow(
      new RegExp(PRE_SPAWN),
    );
  });
});

describe('#1035 the child environment is built, not inherited', () => {
  it('strips the withdrawn prototype keys', async () => {
    // #1044-#1051 are cancelled. A stray key in a developer's shell would make
    // a measured run depend on something the study says it does not use.
    const root = workspace('keys');
    const child = fakeChild(
      root,
      `
const seen = ${JSON.stringify(STRIPPED_ENV_KEYS)}.filter((key) => key in process.env);
process.stdout.write(JSON.stringify({ type: 'result', seen, home: process.env.HOME ?? null }) + '\\n');
`,
    );

    const result = await run(root, child, {
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: '/frozen/home',
        COMMITLORE_JEV_API_KEY: 'should-not-reach-the-child',
        TYPESAFE_API_KEY: 'should-not-reach-the-child',
      },
    });
    const event = result.events[0] as { seen: string[]; home: string | null };

    expect(event.seen).toEqual([]);
    // Frozen, and the parent's own HOME is not what the child got.
    expect(event.home).toBe('/frozen/home');
  });

  it('does not mutate the parent environment', () => {
    const before = { ...process.env };

    childEnv({ ...process.env, COMMITLORE_JEV_API_KEY: 'x' });

    expect(process.env['COMMITLORE_JEV_API_KEY']).toBeUndefined();
    expect(Object.keys(process.env).sort()).toEqual(Object.keys(before).sort());
  });

  it('drops undefined values rather than passing the string "undefined"', () => {
    // `String(undefined)` is a non-empty string, which a child then reads as a
    // real setting -- a shape this repository has been bitten by before.
    expect(childEnv({ A: 'set', B: undefined })).toEqual({ A: 'set' });
  });
});
