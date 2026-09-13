#!/usr/bin/env node
/**
 * Count what a command spends, with the inputs the count depends on pinned and
 * printed beside it.
 *
 * Four numbers were quoted in issues and commit records this project acted on,
 * and all four were wrong the same way: the measurement had inputs beyond the
 * code under test, and nothing pinned them.
 *
 *   - a batch cost read as 3.7s, measured while three other jobs ran; on a
 *     quiet machine the same work is 206ms
 *   - "zero disagreements over 131 paragraphs" read as soundness, from a corpus
 *     that contained neither shape that broke the design
 *   - 29% duplicate branches, measured over `refs/remotes` uncapped when the
 *     code reads `refs/heads` capped at 200; the real figure is 1.5%
 *   - `doctor` at 228 processes, measured against whatever index state the
 *     previous run had left; against a rebuilt index it is 71, and the
 *     "improvement" attributed to a change was the index state changing
 *
 * None of those was a reasoning error. Each was a number taken without saying
 * what it was taken against, and then read as a property of the code.
 *
 * So this refuses to produce a bare number. Every run prints the state it
 * pinned, the machine it ran on, and what it counted — and a number quoted
 * without that header is visibly unsourced.
 *
 * Counts, never durations. On this machine the same drain has measured 145ms
 * and 3.7s depending on what else was running; a process count is exact and
 * load cannot move it. `--load-ceiling` still records the load, because a
 * duration a reader infers from a count is the next version of this mistake.
 *
 * Usage:
 *   node scripts/measure.mjs --cmd "doctor --json" --index complete
 *   node scripts/measure.mjs --cmd "stale --json" --index cold --repo /path
 *   node scripts/measure.mjs --cmd "validate --range A..HEAD" --index complete --json
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, cpus, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');

const usage = (message) => {
  process.stderr.write(`${message}\n\nSee the header of scripts/measure.mjs.\n`);
  process.exit(2);
};

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};

const command = flag('--cmd', undefined);
if (command === undefined) usage('--cmd is required, e.g. --cmd "doctor --json"');

const repo = resolve(flag('--repo', process.cwd()));
/**
 * The index is an input, not a constant.
 *
 * `doctor` costs 594 processes against a complete index and 723 against a
 * partial one — a bigger difference than most changes make. A measurement that
 * does not say which it ran against is not comparable with any other.
 */
const indexState = flag('--index', undefined);
if (indexState !== 'cold' && indexState !== 'complete') {
  usage('--index must be "cold" or "complete" — the index state changes the answer more than most changes do');
}
const asJson = argv.includes('--json-out');
const loadCeiling = Number(flag('--load-ceiling', '4'));

const cli = join(PACKAGE_ROOT, 'dist', 'commitlore.mjs');
if (!existsSync(cli)) usage(`no built CLI at ${cli} — run npm run build first`);

const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
  cwd: repo,
  encoding: 'utf8',
}).trim();

/** A git that records its own argv, so what is counted is what actually ran. */
const shimDir = mkdtempSync(join(tmpdir(), 'commitlore-measure-'));
const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
writeFileSync(
  join(shimDir, 'git'),
  `#!/bin/sh\necho "$*" >> "\${CL_MEASURE_LOG:-/dev/null}"\nexec ${realGit} "$@"\n`,
);
execFileSync('chmod', ['+x', join(shimDir, 'git')]);

/** Put the index where the run says, without the shim: setup is not the subject. */
rmSync(join(gitDir, 'commitlore'), { recursive: true, force: true });
mkdirSync(join(gitDir, 'commitlore'), { recursive: true });
if (indexState === 'complete') {
  const built = spawnSync(process.execPath, [cli, 'index', '--rebuild'], { cwd: repo, encoding: 'utf8' });
  if (built.status !== 0) usage(`could not build the index: ${built.stderr}`);
}

const load = loadavg()[0] ?? 0;
const log = join(shimDir, 'calls.txt');
writeFileSync(log, '');

const started = Date.now();
const run = spawnSync(process.execPath, [cli, ...command.split(' ').filter((w) => w !== '')], {
  cwd: repo,
  encoding: 'utf8',
  env: { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ''}`, CL_MEASURE_LOG: log },
  maxBuffer: 1 << 28,
});
const elapsedMs = Date.now() - started;

const calls = readFileSync(log, 'utf8').split('\n').filter((line) => line !== '');
const byShape = new Map();
for (const argvLine of calls) {
  const word = argvLine.split(' ').find((p) => p !== '' && !p.startsWith('-') && !p.includes('=')) ?? '?';
  byShape.set(word, (byShape.get(word) ?? 0) + 1);
}

const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const notes = spawnSync('git', ['notes', '--ref=refs/notes/commitlore', 'list'], {
  cwd: repo,
  encoding: 'utf8',
});
const noteCount = notes.status === 0 ? notes.stdout.split('\n').filter((l) => l !== '').length : 0;

const provenance = {
  command,
  repo,
  head,
  commits: Number(commits),
  notes: noteCount,
  indexState,
  exitCode: run.status,
  load1: Number(load.toFixed(2)),
  cpus: cpus().length,
  // Recorded, never asserted on. It is here so a reader can see whether the run
  // was quiet, not so anyone compares two of them.
  elapsedMs,
};
const result = {
  provenance,
  total: calls.length,
  byShape: Object.fromEntries([...byShape].sort((a, b) => b[1] - a[1])),
};

rmSync(shimDir, { recursive: true, force: true });

if (asJson) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`\n  ${command}\n`);
  process.stdout.write(`    repo ${repo}\n`);
  process.stdout.write(`    head ${head.slice(0, 12)}   ${commits} commits, ${String(noteCount)} notes\n`);
  process.stdout.write(`    index ${indexState}   exit ${String(run.status)}\n`);
  process.stdout.write(`    load1 ${String(provenance.load1)} on ${String(provenance.cpus)} cpus` +
    `${load > loadCeiling ? '   *** BUSY: counts are exact, but read nothing into the duration ***' : ''}\n`);
  process.stdout.write(`\n    git processes  ${String(calls.length)}\n`);
  for (const [shape, n] of [...byShape].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`      ${shape.padEnd(22)}${String(n).padStart(5)}\n`);
  }
  process.stdout.write('\n');
}
