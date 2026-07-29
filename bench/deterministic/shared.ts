import { execFileSync, spawnSync } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import process from 'node:process';

import type { Machine, RowBase, Timing } from './types.ts';
import { percentile } from './report.ts';

export interface CommandOptions {
  readonly cwd: string;
  readonly input?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowed?: readonly number[];
}

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}

export const command = (
  executable: string,
  args: readonly string[],
  options: CommandOptions,
): CommandResult => {
  const result = spawnSync(executable, [...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    input: options.input,
    env: options.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  const status = result.status ?? -1;
  const allowed = options.allowed ?? [0];
  if (!allowed.includes(status)) {
    throw new Error(
      `${executable} ${args.join(' ')} exited ${status}\n${result.stderr || result.stdout}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr, status };
};

export const git = (
  cwd: string,
  args: readonly string[],
  options: Omit<CommandOptions, 'cwd'> = {},
): CommandResult => command('git', args, { cwd, ...options });

const HARNESS_PATHS = ['bench/deterministic.ts', 'bench/deterministic'] as const;
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export const harnessTreeDigest = (repoRoot: string, ref = 'HEAD'): string => {
  const manifest = git(repoRoot, [
    'ls-tree', '-r', '--full-tree', ref, '--', ...HARNESS_PATHS,
  ]).stdout;
  if (manifest === '') throw new Error(`no deterministic harness found at ${ref}`);
  return git(repoRoot, ['hash-object', '--stdin'], { input: manifest }).stdout.trim();
};

export interface HarnessProvenance {
  readonly harness_commit: string;
  readonly harness_digest?: string;
}

export interface HarnessVerification {
  readonly historyRef: string;
  readonly verifiedBy: 'commit' | 'digest';
  readonly message: string;
}

export const verifyHarnessProvenance = (
  repoRoot: string,
  provenance: HarnessProvenance,
): HarnessVerification => {
  if (!GIT_OBJECT_ID.test(provenance.harness_commit)) {
    throw new Error(`invalid harness commit ${JSON.stringify(provenance.harness_commit)}`);
  }
  const resolved = git(
    repoRoot,
    ['rev-parse', '--verify', '--quiet', `${provenance.harness_commit}^{commit}`],
    { allowed: [0, 1] },
  );
  if (resolved.status === 0) {
    const message =
      `benchmark provenance: verified by harness commit ${provenance.harness_commit}; ` +
      `re-deriving from that commit's history`;
    process.stdout.write(`${message}\n`);
    return { historyRef: provenance.harness_commit, verifiedBy: 'commit', message };
  }

  if (provenance.harness_digest === undefined) {
    throw new Error(
      `benchmark provenance failed: harness commit ${provenance.harness_commit} is unresolvable ` +
        'and no harness digest was recorded; this result cannot be re-derived',
    );
  }
  if (!GIT_OBJECT_ID.test(provenance.harness_digest)) {
    throw new Error(`invalid harness digest ${JSON.stringify(provenance.harness_digest)}`);
  }
  const currentDigest = harnessTreeDigest(repoRoot);
  if (currentDigest !== provenance.harness_digest) {
    throw new Error(
      `benchmark provenance failed: harness commit ${provenance.harness_commit} is unresolvable ` +
        `and harness digest does not match HEAD (recorded ${provenance.harness_digest}, ` +
        `${currentDigest}); this result cannot be re-derived`,
    );
  }

  const message =
    `benchmark provenance: WARNING: harness commit ${provenance.harness_commit} is unresolvable; ` +
    `verified by harness digest ${provenance.harness_digest} at HEAD. ` +
    'The digest proves the harness code is identical, not that the recorded commit existed';
  process.stdout.write(`${message}\n`);
  return { historyRef: 'HEAD', verifiedBy: 'digest', message };
};

export const assertCleanCheckout = (repoRoot: string): void => {
  const status = git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.trim();
  if (status !== '') {
    throw new Error(`deterministic benchmark requires a clean checkout:\n${status}`);
  }
};

export const timed = (run: () => void): number => {
  const started = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - started) / 1e6;
};

export const timing = (
  run: () => void,
  runs: number,
  warmups = 1,
): Timing => {
  for (let index = 0; index < warmups; index += 1) run();
  const samples = Array.from({ length: runs }, () => timed(run));
  return {
    runs,
    warmups,
    p50_ms: percentile(samples, 0.5),
    p95_ms: percentile(samples, 0.95),
    min_ms: Math.min(...samples),
    max_ms: Math.max(...samples),
  };
};

export const machine = (repoRoot: string): Machine => {
  const processors = cpus();
  return {
    platform: process.platform,
    release: execFileSync('uname', ['-r'], { encoding: 'utf8' }).trim(),
    arch: process.arch,
    cpu: processors[0]?.model ?? 'unknown',
    logical_cpus: processors.length,
    memory_bytes: totalmem(),
    node: process.version,
    git: git(repoRoot, ['--version']).stdout.trim(),
  };
};

export const rowBase = (
  repoRoot: string,
  harnessCommit: string,
  distDigest: string,
  measuredAt: string,
): RowBase => ({
  schema_version: 1,
  harness_commit: harnessCommit,
  harness_digest: harnessTreeDigest(repoRoot, harnessCommit),
  dist_digest: distDigest,
  measured_at: measuredAt,
  machine: machine(repoRoot),
});

export const parsePositiveInteger = (name: string, raw: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
};

export const parseSizes = (raw: string): readonly number[] => {
  const sizes = raw.split(',').map((value) => parsePositiveInteger('history size', value.trim()));
  if (sizes.length === 0) throw new Error('at least one history size is required');
  return sizes;
};
