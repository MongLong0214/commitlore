#!/usr/bin/env node
/**
 * Builds a synthetic repository for the index tests and benchmarks (T-203).
 *
 * Commits are written through `git fast-import`, not through `git commit`: one
 * process per commit is the difference between seconds and an hour at 100k
 * commits, and the perf test is worthless if generating its input costs more
 * than the thing being measured.
 *
 * The generator is deterministic — same `--seed`, same repository, byte for
 * byte — so a benchmark number can be compared against the one before it.
 *
 * A share of commits carry a B3-shaped paragraph (`Note:` followed by
 * un-indented prose). Those MUST index to zero trailers; they are the false
 * positives the whole protocol exists to avoid, planted at scale.
 *
 * Usage:
 *   node scripts/make-synthetic-repo.mjs --out <dir> [--commits 2000]
 *        [--trailer-ratio 0.01] [--prose-ratio 0.05] [--seed 20260726] [--force]
 *
 * Defaults stay small on purpose: the test suite runs the default, and 100k
 * commits is opt-in (`--commits 100000`).
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';

const DEFAULTS = {
  commits: 2000,
  trailerRatio: 0.01,
  proseRatio: 0.05,
  seed: 20260726,
  out: '',
  force: false,
  quiet: false,
};

const FLAG_NAMES = {
  '--commits': 'commits',
  '--trailer-ratio': 'trailerRatio',
  '--prose-ratio': 'proseRatio',
  '--seed': 'seed',
  '--out': 'out',
};

const parseArgs = (argv) => {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--force') {
      options.force = true;
      continue;
    }
    if (flag === '--quiet') {
      options.quiet = true;
      continue;
    }
    const name = FLAG_NAMES[flag];
    if (name === undefined) throw new Error(`unknown option: ${flag}`);
    const raw = argv[i + 1];
    if (raw === undefined) throw new Error(`${flag} needs a value`);
    i += 1;
    options[name] = name === 'out' ? raw : Number(raw);
  }

  if (options.out === '') throw new Error('--out <dir> is required');
  if (!Number.isInteger(options.commits) || options.commits < 1) {
    throw new Error('--commits must be a positive integer');
  }
  for (const ratio of ['trailerRatio', 'proseRatio']) {
    if (!(options[ratio] >= 0 && options[ratio] <= 1)) {
      throw new Error(`--${ratio === 'trailerRatio' ? 'trailer' : 'prose'}-ratio must be 0..1`);
    }
  }
  return options;
};

/** mulberry32 — small, fast, and identical across runs. */
const makeRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (random, items) => items[Math.floor(random() * items.length) % items.length];

const VERBS = ['Tighten', 'Split', 'Inline', 'Retire', 'Guard', 'Fold', 'Widen', 'Pin'];
const NOUNS = ['retry loop', 'token refresh', 'cache key', 'batch writer', 'path scope', 'gate'];
const BLAST = ['local', 'module', 'system'];
const UNDO = ['easy', 'costly', 'permanent'];
const CERTAINTY = ['firm', 'tentative', 'guess'];
const LIMITS = [
  'the upstream API is rate limited to 50 requests per minute',
  'the deploy window is 20 minutes and the migration runs inside it',
  'the vendor build ships no source maps, so stack traces stop at the boundary',
  'the runner has 2 GB of memory and the fixture set does not fit twice',
];
const RULED_OUT = [
  'a second cache tier | the invalidation story was worse than the latency it saved',
  'rewriting the parser | git already defines the boundary and we would drift from it',
  'a background worker | the failure mode moves off the request path but not out of it',
];
const WARNS = [
  'raising this timeout hides the race rather than fixing it',
  'this path is entered from the hook as well, so a signature change breaks both',
  'the ordering here is load bearing; the batch writer assumes it',
];

const recordId = (random) => {
  let id = 'r-';
  for (let i = 0; i < 6; i += 1) id += '0123456789abcdef'[Math.floor(random() * 16)];
  return id;
};

const trailerBlock = (random) =>
  [
    `Limit: ${pick(random, LIMITS)}`,
    `Ruled-out: ${pick(random, RULED_OUT)}`,
    `Warn: ${pick(random, WARNS)}`,
    `Blast: ${pick(random, BLAST)}`,
    `Undo: ${pick(random, UNDO)}`,
    `Certainty: ${pick(random, CERTAINTY)}`,
    `Record-Id: ${recordId(random)}`,
    'CommitLore-Version: 2.0.0',
  ].join('\n');

/**
 * SPEC §2.1 B3: a `Key: value` line followed by un-indented prose makes the
 * whole paragraph body text. Zero trailers, and no implementation may report
 * otherwise.
 */
const proseBlock = (random) =>
  `Note: ${pick(random, WARNS)}\nCheck the callers listed in the ticket before merging this.`;

const buildMessage = (random, index, kind, module) => {
  const subject = `${pick(random, VERBS)} the ${pick(random, NOUNS)} in ${module} (#${index})`;
  const body = `Reworked the ${pick(random, NOUNS)} so the ${pick(random, NOUNS)} stops\ncarrying two responsibilities at once.`;
  if (kind === 'trailers') return `${subject}\n\n${body}\n\n${trailerBlock(random)}\n`;
  if (kind === 'prose') return `${subject}\n\n${body}\n\n${proseBlock(random)}\n`;
  return `${subject}\n\n${body}\n`;
};

const dataChunk = (text) => `data ${Buffer.byteLength(text, 'utf8')}\n${text}\n`;

const run = (command, args, cwd) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const out = resolve(options.out);

  if (existsSync(out) && readdirSync(out).length > 0 && !options.force) {
    throw new Error(`${out} is not empty; pass --force to reuse it`);
  }
  mkdirSync(out, { recursive: true });

  const started = Date.now();
  await run('git', ['init', '-q', '-b', 'main', '--template=', '.'], out);

  const random = makeRandom(options.seed);
  const moduleCount = Math.min(200, Math.max(4, Math.ceil(options.commits / 200)));
  const baseTime = 1700000000;

  const child = spawn('git', ['fast-import', '--quiet', '--done'], {
    cwd: out,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: false,
  });
  const failure = once(child, 'error');

  let pending = '';
  let trailerCommits = 0;
  let proseCommits = 0;

  const flush = async () => {
    if (pending === '') return;
    const chunk = pending;
    pending = '';
    if (!child.stdin.write(chunk)) await once(child.stdin, 'drain');
  };

  for (let i = 0; i < options.commits; i += 1) {
    const roll = random();
    const kind = roll < options.trailerRatio
      ? 'trailers'
      : roll < options.trailerRatio + options.proseRatio
        ? 'prose'
        : 'plain';
    if (kind === 'trailers') trailerCommits += 1;
    if (kind === 'prose') proseCommits += 1;

    const moduleIndex = Math.floor(random() * moduleCount);
    const module = `src/mod-${String(moduleIndex).padStart(3, '0')}`;
    const stamp = baseTime + i * 60;
    const message = buildMessage(random, i, kind, module);

    const touched = 1 + Math.floor(random() * 3);
    let files = '';
    for (let f = 0; f < touched; f += 1) {
      const path = `${module}/file-${Math.floor(random() * 5)}.ts`;
      files += `M 100644 inline ${path}\n${dataChunk(`export const rev${i} = ${f};`)}`;
    }

    pending +=
      'commit refs/heads/main\n' +
      `mark :${i + 1}\n` +
      `author Synth <synth@example.invalid> ${stamp} +0000\n` +
      `committer Synth <synth@example.invalid> ${stamp} +0000\n` +
      dataChunk(message) +
      files +
      '\n';

    if (pending.length > 4 * 1024 * 1024) await flush();
  }

  /* `--done` makes fast-import reject a truncated stream instead of importing
     a prefix of it, which is worth the one extra line. */
  pending += 'done\n';
  await flush();
  child.stdin.end();

  const [code] = await Promise.race([once(child, 'close'), failure.then(([e]) => Promise.reject(e))]);
  if (code !== 0) throw new Error(`git fast-import exited ${code}`);

  /* fast-import writes objects and refs but not a working tree, and a
     repository where every file reads as deleted is a confusing thing to hand
     someone debugging a benchmark. */
  await run('git', ['reset', '-q', '--hard'], out);

  const summary = {
    out,
    commits: options.commits,
    trailerCommits,
    proseCommits,
    modules: moduleCount,
    seed: options.seed,
    elapsedMs: Date.now() - started,
  };
  if (!options.quiet) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
};

main().catch((error) => {
  process.stderr.write(`make-synthetic-repo: ${error.message}\n`);
  process.exitCode = 1;
});
