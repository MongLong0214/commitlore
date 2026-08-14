import { spawnSync } from 'node:child_process';

import { execGit, type ExecGitOptions, type GitResult } from '../../core/git.js';
import { openIndex } from '../../core/index-db.js';
import { discoverLiveMcpRuntimes, type LiveMcpRuntimeScan } from '../../core/mcp-probe.js';

/**
 * Doctor's model and construction seam.
 *
 * Check modules share the frozen report shapes, factory, and observation
 * helpers here so that each can own one diagnosis without reaching into a
 * sibling check. Construction stays central because status-derived fields and
 * non-empty evidence are report-wide invariants, not per-check conventions.
 */

/**
 * `skipped` is a check that exists but has nothing to inspect yet — it is not
 * a pass. `fail` means the tool cannot work correctly here; `warn` means the
 * setup is incomplete but nothing gives a wrong answer locally.
 */
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skipped';

/** The report-level verdict a JSON consumer can branch on. */
export type DoctorStatus = 'ok' | 'degraded' | 'failed';

/** How this CLI installation was reached, without probing the network. */
export type InstallSource = 'plugin' | 'npm' | 'npx' | 'source' | 'unknown';

/**
 * The subsystem a check speaks for (PRD §2.1). A row that cannot name one
 * cannot be selected, grouped or rolled up, so it is supplied at construction
 * rather than looked up from the id afterwards — a lookup gives a new check a
 * silent default, and this makes omitting one a type error.
 */
export type Category = 'runtime' | 'transport' | 'capture' | 'delivery' | 'history' | 'index';

/**
 * Display-grade ordering only. **Never drives the exit code** (ADR-0032 §3).
 *
 * Derived from `status` at the single factory below and impossible to supply:
 * two axes that can disagree make every consumer resolve the disagreement, and
 * deriving at one chokepoint makes the inconsistency unrepresentable rather
 * than merely discouraged.
 */
export type Severity = 'error' | 'warning' | 'info';

/**
 * Why a check did not run, from a closed set (PRD §1.2). A skip whose reason is
 * free text is a skip nothing can act on. The union grows one member at a time
 * as sites are mapped.
 */
export type SkipReason =
  | 'command_unrecognized'
  | 'hook_not_installed'
  | 'probe_path_unavailable'
  | 'version_unreadable'
  | 'unborn_head'
  | 'nothing_applicable';

export interface DoctorCheck {
  // ---- v1 fields: names, types and meanings frozen (ADR-0032 §6) ----
  id: string;
  title: string;
  status: CheckStatus;
  needsAttention: boolean;
  detail: string;
  /** What makes this check `ok`, or `null` when nothing needs doing. */
  fix: string | null;
  /** Whether this run's `--fix` changed something for this check. */
  fixed: boolean;

  // ---- v2 additive fields, owned by construction ----
  category: Category;
  /** Derived from `status`; never passed in, never read by the exit code. */
  severity: Severity;
  /**
   * The observation behind the conclusion. A row without one cannot explain
   * why its status is trustworthy, so construction rejects empty evidence.
   */
  evidence: Record<string, string>;
  /** No shipping check is optional at introduction (PRD §1.4). */
  optional: boolean;
  /** Absence preserves the additive JSON contract for findings that stand alone. */
  blockedBy?: string;
  /** Present only on `skipped`. Omitted, never null. */
  skipReason?: SkipReason;
  /**
   * Wall time for this check, whole milliseconds, never negative. Stamped by
   * the runner from a monotonic clock — PRD §10's budget is an assertion until
   * something measures it.
   */
  durationMs?: number;
}

export interface DoctorReport {
  /** A consumer pins this schema id, not an incidental set of object keys. */
  schema: 'commitlore_doctor.v2';
  /** The CLI version that produced this report. */
  version: string;
  /** Derived once from the final completed rows. */
  status: DoctorStatus;
  /** The detected distribution channel for the running CLI. */
  installSource: InstallSource;
  /** The first actionable finding, or a status-appropriate no-action message. */
  headline: string;
  /** Counts and the sum of all per-check durations. */
  summary: {
    total: number;
    ok: number;
    warn: number;
    fail: number;
    skipped: number;
    durationMs: number;
  };
  /** Root causes in remediation order. */
  fixPlan: string[];
  /** Reserved for the filters ticket; omitted, never null, on a full run. */
  selection?: string[];
  checks: DoctorCheck[];
  /** 1 iff a non-optional check failed; degraded reports exit 0. */
  exitCode: number;
}

export interface DoctorOptions {
  cwd?: string;
  /** Apply the reversible local config fixes. */
  fix?: boolean;
  /** Run only these check ids. An absent value means the full registry. */
  only?: readonly string[];
  /** Run only checks in this category. An absent value means every category. */
  category?: string;
}

/** The process effects a check may need, supplied by the runner. */
export type DoctorGit = (args: string[], opts?: ExecGitOptions) => GitResult;
export type DoctorSpawn = typeof spawnSync;
export type DoctorOpenIndex = typeof openIndex;

/** Probe message for the git capability check — one trailer of each shape. */
export const PROBE_MESSAGE = 'commitlore doctor probe\n\nLimit: probe\nBlast: local\n';

export const gitOptions = (opts: DoctorOptions) => (opts.cwd === undefined ? {} : { cwd: opts.cwd });

/** The bound keeps a broken child process from making a JSON report unbounded. */
export const boundedExcerpt = (output: string | null | undefined): {
  firstLine: string;
  truncated: 'true' | 'false';
} => {
  const [firstLine = ''] = (output ?? '').split(/\r?\n/, 1);
  return {
    firstLine: firstLine.slice(0, 200),
    truncated: firstLine.length > 200 ? 'true' : 'false',
  };
};

export const streamEvidence = (stream: string, output: string | null | undefined): Record<string, string> => {
  const excerpt = boundedExcerpt(output);
  return {
    [`${stream}_first_line`]: excerpt.firstLine,
    [`${stream}_truncated`]: excerpt.truncated,
  };
};

/** Reports keep paths useful in bug reports without carrying a user's home directory. */
const homeRelativePath = (value: string): string => {
  const home = process.env['HOME'];
  if (home === undefined || home === '') return value;
  const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(`${escapedHome}(?=$|/)`, 'g'), '~');
};

const normaliseEvidence = (evidence: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(evidence).map(([key, value]) => [key, homeRelativePath(value)]),
  );

export const evidenceKey = (value: string): string =>
  value
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'remote';

/**
 * `severity` as a total function of `status` — the only place it is decided.
 *
 * `skipped` maps to `info`, not `warning`: a check that could not run has
 * reported nothing, and giving it a warning's weight is how a report starts
 * ranking its own blind spots above its findings.
 */
const severityOf = (status: CheckStatus): Severity =>
  status === 'fail' ? 'error' : status === 'warn' ? 'warning' : 'info';

/**
 * The single constructor. No `DoctorCheck` object literal exists outside it.
 *
 * `severity` is absent from the parameter list on purpose — there is no way to
 * pass one, which is the mechanical form of ADR-0032 §3's rule. `category` is
 * required and positional so a new check cannot be added without naming its
 * subsystem.
 *
 * The two `needsAttention` overrides this file already carried are unchanged:
 * the no-remote refspec warn and the ENOENT inject fail both clear it, because
 * neither is something the user can act on here (#192, #221).
 */
type CheckExtra =
  | { evidence?: Record<string, string>; optional?: boolean; skipReason?: never }
  /**
   * A `skipped` row must name a reason from the union. `skipped` is the one
   * status that reports nothing, so without a reason it says only "no answer" —
   * and a consumer branching on "we did not look" has nothing but prose to
   * match against, which the next release is free to reword. Making the reason
   * required is what turns that into a contract.
   */
  | { evidence?: Record<string, string>; optional?: boolean; skipReason: SkipReason };

export function check(
  id: string,
  category: Category,
  title: string,
  status: 'ok' | 'warn' | 'fail',
  detail: string,
  fix?: string | null,
  fixed?: boolean,
  needsAttention?: boolean,
  extra?: { evidence?: Record<string, string>; optional?: boolean; skipReason?: never },
): DoctorCheck;
export function check(
  id: string,
  category: Category,
  title: string,
  status: 'skipped',
  detail: string,
  fix: string | null,
  fixed: boolean,
  needsAttention: boolean,
  extra: { evidence?: Record<string, string>; optional?: boolean; skipReason: SkipReason },
): DoctorCheck;
export function check(
  id: string,
  category: Category,
  title: string,
  status: CheckStatus,
  detail: string,
  fix: string | null = null,
  fixed = false,
  needsAttention = status === 'warn' || status === 'fail',
  extra: CheckExtra = {},
): DoctorCheck {
  const evidence = extra.evidence ?? {};
  if (Object.keys(evidence).length === 0) {
    throw new Error(`doctor check ${id} has no evidence`);
  }
  return {
    id,
    title,
    status,
    needsAttention,
    detail,
    fix,
    fixed,
    category,
    severity: severityOf(status),
    evidence: normaliseEvidence(evidence),
    optional: extra.optional ?? false,
    ...(extra.skipReason === undefined ? {} : { skipReason: extra.skipReason }),
  };
}

export const blocked = (dependency: DoctorCheck, row: DoctorCheck): DoctorCheck => {
  if (dependency.status === 'ok') {
    throw new Error(`doctor check ${row.id} cannot repeat an ok finding`);
  }
  return { ...row, blockedBy: dependency.id };
};

/**
 * What a check is given. `memo` exists for the one dependency this file has
 * always had: `commit-msg-hook` consumes `hook-runtime`'s result, and both are
 * rows. The runner emits in registry order — where `commit-msg-hook` presents
 * first — so the dependency cannot be satisfied by running earlier entries and
 * reading their output. Memoising the computation keeps "each check runs
 * exactly once" true without reordering the report.
 */
export interface DoctorContext {
  readonly opts: DoctorOptions;
  /**
   * The registry entries this run is permitted to execute. A selected
   * `commit-msg-hook` must not reach through its historical memo seam and run
   * `hook-runtime` when that row was filtered out.
   */
  readonly selectedIds?: ReadonlySet<string>;
  /** Monotonic, for `durationMs`. A wall clock can go backwards. */
  readonly now: () => bigint;
  readonly memo: Map<string, DoctorCheck>;
  /** Git process runner; checks must not reach around this seam. */
  readonly git: DoctorGit;
  /** General child-process runner for executable and hook probes. */
  readonly spawn: DoctorSpawn;
  /** Environment seen by hook probes and configuration checks. */
  readonly env: NodeJS.ProcessEnv;
  /** Derived-index opener. */
  readonly openIndex: DoctorOpenIndex;
  /** Live MCP process-table observation; injectable because `ps` is platform-specific. */
  readonly liveMcpRuntimes: () => LiveMcpRuntimeScan;
}

/**
 * The shipping process effects. Tests pass a complete synthetic context to
 * exercise effect-dependent branches without starting the process they probe.
 */
export const defaultDoctorContext = (opts: DoctorOptions = {}): DoctorContext => ({
  opts,
  now: process.hrtime.bigint,
  memo: new Map(),
  git: execGit,
  spawn: spawnSync,
  env: process.env,
  openIndex,
  liveMcpRuntimes: discoverLiveMcpRuntimes,
});
