/**
 * Loader for `spec/contract-cases/*.yaml`, the executable route contracts
 * described by `spec/contract-cases/SCHEMA.md`.
 *
 * Files are discovered by filename prefix, never enumerated in code: SCHEMA.md
 * makes the prefix load-bearing (`stale-*` → the stale engine, `grade-*` →
 * trust grading), so a new case file is covered by its suite the moment it
 * lands. The YAML is validated as it is read rather than trusted — a case that
 * silently fails to load is a case that silently stops being a contract.
 *
 * Field names are converted to the codebase's camelCase here, at the single
 * boundary where the wire shape is known.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';

import type { Lifecycle, Trailer } from '../src/core/types.js';

/** Filename prefixes, per SCHEMA.md §1. */
export const STALE_PREFIX = 'stale-';
export const GRADE_PREFIX = 'grade-';
export const ROUTE_PREFIX = 'route-';

export type WarnGrade = 'instruction' | 'claim';

/** One synthetic commit in a case's `given` stream (SCHEMA.md §4). */
export interface ContractCommit {
  sha: string;
  committedAt: string;
  author?: string;
  committer?: string;
  trailers: Trailer[];
}

/** A case's `when` block (SCHEMA.md §5). */
export interface ContractWhen {
  route: string;
  at?: string;
  trustedAuthors?: string[];
}

/** One entry of `expect.records` (SCHEMA.md §6). */
export interface ContractExpectedRecord {
  recordId: string;
  lifecycle?: Lifecycle;
  review?: boolean;
  resolvedTrailers?: Trailer[];
  warnGrade?: WarnGrade;
}

/** A case's `expect` block (SCHEMA.md §6). */
export interface ContractExpect {
  records?: ContractExpectedRecord[];
  approvalRequired?: boolean;
  triggeredBy?: string[];
}

export interface ContractCase {
  /** Basename of the file the case came from, e.g. `stale-supersedes.yaml`. */
  file: string;
  route: string;
  id: string;
  description: string;
  given: ContractCommit[];
  when: ContractWhen;
  expect: ContractExpect;
}

const CASE_ROOT = fileURLToPath(new URL('../spec/contract-cases/', import.meta.url));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const object = (value: unknown, where: string): Record<string, unknown> => {
  if (!isObject(value)) throw new Error(`${where}: expected a mapping, got ${JSON.stringify(value)}`);
  return value;
};

const array = (value: unknown, where: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${where}: expected a list, got ${JSON.stringify(value)}`);
  return value;
};

const string = (value: unknown, where: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`${where}: expected a string, got ${JSON.stringify(value)} (quote it in YAML?)`);
  }
  return value;
};

const optionalString = (value: unknown, where: string): string | undefined =>
  value === undefined ? undefined : string(value, where);

const optionalBoolean = (value: unknown, where: string): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`${where}: expected true or false, got ${JSON.stringify(value)}`);
  }
  return value;
};

const readTrailers = (value: unknown, where: string): Trailer[] =>
  array(value, where).map((entry, index) => {
    const trailer = object(entry, `${where}[${index}]`);
    return {
      key: string(trailer.key, `${where}[${index}].key`),
      value: string(trailer.value, `${where}[${index}].value`),
    };
  });

const readCommit = (value: unknown, where: string): ContractCommit => {
  const commit = object(value, where);
  const author = optionalString(commit.author, `${where}.author`);
  const committer = optionalString(commit.committer, `${where}.committer`);
  return {
    sha: string(commit.sha, `${where}.sha`),
    committedAt: string(commit.committed_at, `${where}.committed_at`),
    trailers: readTrailers(commit.trailers, `${where}.trailers`),
    ...(author === undefined ? {} : { author }),
    ...(committer === undefined ? {} : { committer }),
  };
};

const isLifecycle = (value: string): value is Lifecycle =>
  value === 'active' || value === 'superseded' || value === 'expired';

const isWarnGrade = (value: string): value is WarnGrade =>
  value === 'instruction' || value === 'claim';

const readLifecycle = (value: unknown, where: string): Lifecycle | undefined => {
  const raw = optionalString(value, where);
  if (raw === undefined) return undefined;
  if (!isLifecycle(raw)) throw new Error(`${where}: unknown lifecycle ${JSON.stringify(raw)}`);
  return raw;
};

const readWarnGrade = (value: unknown, where: string): WarnGrade | undefined => {
  const raw = optionalString(value, where);
  if (raw === undefined) return undefined;
  if (!isWarnGrade(raw)) throw new Error(`${where}: unknown warn grade ${JSON.stringify(raw)}`);
  return raw;
};

const readExpectedRecord = (value: unknown, where: string): ContractExpectedRecord => {
  const expected = object(value, where);
  const lifecycle = readLifecycle(expected.lifecycle, `${where}.lifecycle`);
  const review = optionalBoolean(expected.review, `${where}.review`);
  const warnGrade = readWarnGrade(expected.warn_grade, `${where}.warn_grade`);
  const resolved =
    expected.resolved_trailers === undefined
      ? undefined
      : readTrailers(expected.resolved_trailers, `${where}.resolved_trailers`);

  return {
    recordId: string(expected.record_id, `${where}.record_id`),
    ...(lifecycle === undefined ? {} : { lifecycle }),
    ...(review === undefined ? {} : { review }),
    ...(warnGrade === undefined ? {} : { warnGrade }),
    ...(resolved === undefined ? {} : { resolvedTrailers: resolved }),
  };
};

const readWhen = (value: unknown, where: string, route: string): ContractWhen => {
  const when = object(value, where);
  const at = optionalString(when.at, `${where}.at`);
  const trusted =
    when.trusted_authors === undefined
      ? undefined
      : array(when.trusted_authors, `${where}.trusted_authors`).map((entry, index) =>
          string(entry, `${where}.trusted_authors[${index}]`),
        );

  const whenRoute = string(when.route, `${where}.route`);
  if (whenRoute !== route) {
    throw new Error(`${where}.route is ${whenRoute} but the file declares ${route}`);
  }

  return {
    route: whenRoute,
    ...(at === undefined ? {} : { at }),
    ...(trusted === undefined ? {} : { trustedAuthors: trusted }),
  };
};

const readExpect = (value: unknown, where: string): ContractExpect => {
  const expected = object(value, where);
  const records =
    expected.records === undefined
      ? undefined
      : array(expected.records, `${where}.records`).map((entry, index) =>
          readExpectedRecord(entry, `${where}.records[${index}]`),
        );
  const approvalRequired = optionalBoolean(expected.approval_required, `${where}.approval_required`);
  const triggeredBy =
    expected.triggered_by === undefined
      ? undefined
      : array(expected.triggered_by, `${where}.triggered_by`).map((entry, index) =>
          string(entry, `${where}.triggered_by[${index}]`),
        );

  return {
    ...(records === undefined ? {} : { records }),
    ...(approvalRequired === undefined ? {} : { approvalRequired }),
    ...(triggeredBy === undefined ? {} : { triggeredBy }),
  };
};

const readFile = (file: string): ContractCase[] => {
  const parsed = object(load(readFileSync(join(CASE_ROOT, file), 'utf8')), file);
  const route = string(parsed.route, `${file}.route`);
  const cases = array(parsed.cases, `${file}.cases`);
  if (cases.length === 0) throw new Error(`${file}.cases: a contract file with no cases contracts nothing`);

  return cases.map((entry, index) => {
    const single = object(entry, `${file}.cases[${index}]`);
    const id = string(single.id, `${file}.cases[${index}].id`);
    const where = `${file}#${id}`;
    return {
      file,
      route,
      id,
      description: string(single.description, `${where}.description`),
      given: array(single.given, `${where}.given`).map((commit, at) =>
        readCommit(commit, `${where}.given[${at}]`),
      ),
      when: readWhen(single.when, `${where}.when`, route),
      expect: readExpect(single.expect, `${where}.expect`),
    };
  });
};

/** Every `*.yaml` under `spec/contract-cases/`, sorted. */
export const contractCaseFiles = (prefix = ''): string[] =>
  readdirSync(CASE_ROOT)
    .filter((entry) => entry.endsWith('.yaml') && entry.startsWith(prefix))
    .sort();

/**
 * Loads every case whose file matches `prefix` — `''` loads all of them.
 * Case ids must be unique across everything loaded (SCHEMA.md §3), so a
 * copy-pasted case cannot quietly shadow the one it was copied from.
 */
export const loadContractCases = (prefix = ''): ContractCase[] => {
  const cases = contractCaseFiles(prefix).flatMap(readFile);

  const seen = new Map<string, string>();
  for (const single of cases) {
    const previous = seen.get(single.id);
    if (previous !== undefined) {
      throw new Error(`duplicate contract case id ${single.id} in ${previous} and ${single.file}`);
    }
    seen.set(single.id, single.file);
  }

  return cases;
};
