/**
 * Re-measures the PreToolUse inject hook's overhead (#39) against the
 * compiled single-executable binary, using the exact same method
 * `bench/deterministic/hooks.ts#preToolUseOverhead` uses for the script
 * distribution: one discarded warmup, then 20 timed runs of a file write with
 * and without the hook in front of it.
 *
 * It is deliberately a standalone script rather than a new arm wired into
 * `bench/deterministic.ts`. That harness's provenance guarantees
 * (`assertSingleProvenance`, `digestDistTree`) are about the committed,
 * byte-diffed `dist/` tree (ADR-0011) — the whole reason a `dist_digest`
 * column exists at all. The compiled binary is the opposite of that on
 * purpose (ADR-0015): a reproducible but uncommitted, platform-specific
 * artifact. Forcing it through the same provenance columns would either
 * violate them or need to make them optional, weakening what they guarantee
 * for the measurements that already rely on them.
 *
 * Three arms in one run, so the comparison is same-machine and same-session
 * rather than read off two different `bench/results/*.md` files with drift
 * between them:
 *
 *   1. no hook at all (baseline)
 *   2. the shipped script path: `node dist/cli.js inject --hook-input`
 *   3. the compiled binary: `dist/commitlore inject --hook-input`
 *
 * Usage: node --experimental-strip-types bench/binary-hook-overhead.ts
 * Requires `npm run build:binary` to have produced `dist/commitlore` first.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { command, git, timing } from './deterministic/shared.ts';
import { machine as machineInfo } from './deterministic/shared.ts';
import type { Timing } from './deterministic/types.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const CLI_ENTRY = join(REPO_ROOT, 'dist', 'cli.js');
const BINARY_ENTRY = join(REPO_ROOT, 'dist', 'commitlore');
const RUNS = 20;

for (const [label, path] of [
  ['dist/cli.js', CLI_ENTRY],
  ['dist/commitlore', BINARY_ENTRY],
] as const) {
  if (!existsSync(path)) {
    process.stderr.write(
      `${label} does not exist at ${path} — run \`npm run build\` and \`npm run build:binary\` first\n`,
    );
    process.exit(1);
  }
}

const configureRepo = (repo: string): void => {
  git(repo, ['config', 'user.name', 'CommitLore Binary Bench']);
  git(repo, ['config', 'user.email', 'bench@commitlore.invalid']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'core.hooksPath', join(repo, '.git', 'hooks')]);
};

const makeRepo = (scratch: string, label: string): string => {
  const repo = join(scratch, label);
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main', '--template=']);
  configureRepo(repo);
  writeFileSync(join(repo, 'subject.ts'), 'export const value = 0;\n');
  git(repo, ['add', 'subject.ts']);
  git(repo, ['commit', '-q', '--no-verify', '-m', 'Seed repository']);
  return repo;
};

const seedInjectionRecord = (repo: string, indexArgs: readonly string[]): void => {
  writeFileSync(join(repo, 'subject.ts'), 'export const value = 1;\n');
  git(repo, ['add', 'subject.ts']);
  git(repo, ['commit', '-q', '--cleanup=verbatim', '-F', '-'], {
    input: [
      'Record edit constraint',
      '',
      'Warn: preserve the stable wire format while editing this file',
      'Blast: local',
      'Undo: easy',
      'Certainty: firm',
      'Record-Id: r-binbench01',
      '',
    ].join('\n'),
  });
  command(indexArgs[0] ?? '', [...indexArgs.slice(1), 'index', '--rebuild', '--json'], { cwd: repo });
};

/** [executable, ...leadingArgs] — `[node, dist/cli.js]` or `[dist/commitlore]`. */
type Invocation = readonly [string, ...string[]];

const measureArm = (scratch: string, label: string, invocation: Invocation): Timing => {
  const repo = makeRepo(scratch, `pre-tool-use-${label}`);
  seedInjectionRecord(repo, invocation);
  const path = resolve(repo, 'subject.ts');
  const payload = `${JSON.stringify({ cwd: repo, tool_input: { file_path: path } })}\n`;
  let sequence = 0;
  const edit = (): void => {
    sequence += 1;
    writeFileSync(path, `export const value = ${sequence};\n`);
  };

  timing(edit, RUNS); // warm the filesystem/cache the same way for every arm
  writeFileSync(path, 'export const value = 1;\n');
  return timing(() => {
    command(invocation[0], [...invocation.slice(1), 'inject', '--hook-input'], {
      cwd: repo,
      input: payload,
    });
    edit();
  }, RUNS);
};

const fixed = (value: number, digits = 2): string => value.toFixed(digits);

const main = (): void => {
  const scratch = mkdtempSync(join(tmpdir(), 'commitlore-binary-bench-'));
  try {
    process.stdout.write(`binary hook-overhead bench: ${RUNS} runs per arm\n`);

    const baselineRepo = makeRepo(scratch, 'baseline');
    let sequence = 0;
    const baselinePath = resolve(baselineRepo, 'subject.ts');
    const baseline = timing(() => {
      sequence += 1;
      writeFileSync(baselinePath, `export const value = ${sequence};\n`);
    }, RUNS);

    const viaNode = measureArm(scratch, 'node', [process.execPath, CLI_ENTRY]);
    const viaBinary = measureArm(scratch, 'binary', [BINARY_ENTRY]);

    const rows = [
      { label: 'no hook (baseline)', timing: baseline, deltaVsBaseline: 0 },
      {
        label: 'node dist/cli.js inject --hook-input',
        timing: viaNode,
        deltaVsBaseline: viaNode.p50_ms - baseline.p50_ms,
      },
      {
        label: 'dist/commitlore inject --hook-input',
        timing: viaBinary,
        deltaVsBaseline: viaBinary.p50_ms - baseline.p50_ms,
      },
    ];

    const machine = machineInfo(REPO_ROOT);
    const lines = [
      '# CommitLore binary hook-overhead measurement (#39)',
      '',
      `Machine: ${machine.cpu}, ${machine.logical_cpus} logical CPUs, ` +
        `${fixed(machine.memory_bytes / 1024 ** 3, 1)} GiB RAM, ${machine.platform} ${machine.release} ` +
        `(${machine.arch}), Node ${machine.node}, ${machine.git}.`,
      '',
      'Method: same as `bench/deterministic/hooks.ts#preToolUseOverhead` (one discarded warmup, then ' +
        `${RUNS} timed runs of a file write, with and without the hook in front of it) — run against three ` +
        'arms in the same session so the comparison is same-machine rather than read off two separate reports.',
      '',
      '| arm | runs | p50 ms | p95 ms | delta p50 vs baseline ms |',
      '|---|---:|---:|---:|---:|',
      ...rows.map(
        (row) =>
          `| ${row.label} | ${row.timing.runs} | ${fixed(row.timing.p50_ms)} | ` +
          `${fixed(row.timing.p95_ms)} | ${fixed(row.deltaVsBaseline)} |`,
      ),
      '',
      `Node-path delta p50: **${fixed(viaNode.p50_ms - baseline.p50_ms)} ms**. ` +
        `Binary delta p50: **${fixed(viaBinary.p50_ms - baseline.p50_ms)} ms**. ` +
        `Binary vs node-path, same session: **${fixed(viaBinary.p50_ms - viaNode.p50_ms)} ms** ` +
        `(${fixed(((viaNode.p50_ms - viaBinary.p50_ms) / viaNode.p50_ms) * 100, 1)}% lower).`,
      '',
    ];

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const outputDir = resolve(REPO_ROOT, 'bench', 'results');
    mkdirSync(outputDir, { recursive: true });
    const reportPath = join(outputDir, `binary-hook-overhead-${stamp}.md`);
    writeFileSync(reportPath, lines.join('\n'));
    process.stdout.write(lines.join('\n'));
    process.stdout.write(`\nbinary hook-overhead bench: wrote ${reportPath}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

main();
