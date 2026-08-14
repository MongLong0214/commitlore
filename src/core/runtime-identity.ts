/**
 * The exact program a CommitLore surface is executing.
 *
 * A command name is not an identity: hooks pin a file, plugins cache a
 * checkout and MCP hosts retain a process.  This one value is deliberately
 * built from the entry file's own package, never from the caller's cwd.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { SCHEMA_VERSION } from './index-db.js';
import { PACKAGE_ROOT, findPackageRoot, installedPath } from './paths.js';

export interface RuntimeIdentity {
  readonly version: string;
  readonly entrypoint: string;
  readonly packageRoot: string;
  readonly indexSchemaVersion: number;
}

interface RuntimeManifest {
  readonly version?: unknown;
  readonly commitlore?: { readonly indexSchemaVersion?: unknown };
}

const physicalPath = (path: string): string => {
  try { return realpathSync(path); } catch { return resolve(path); }
};

const manifestAt = (root: string): RuntimeManifest => {
  try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as RuntimeManifest; }
  catch { return {}; }
};

/**
 * Produces every part of runtime identity from one entrypoint.  Passing an
 * entrypoint is for a pin or an observed MCP command; omission describes this
 * running installation, even when tests launched Node from somewhere else.
 */
export const runtimeIdentity = (entrypoint?: string): RuntimeIdentity => {
  const entry = physicalPath(entrypoint ?? installedPath('dist', 'commitlore.mjs'));
  const root = entrypoint === undefined ? PACKAGE_ROOT : findPackageRoot(dirname(entry));
  const manifest = manifestAt(root);
  const schema = manifest.commitlore?.indexSchemaVersion;
  return {
    version: typeof manifest.version === 'string' && manifest.version !== '' ? manifest.version : '0.0.0-unknown',
    entrypoint: entry,
    packageRoot: physicalPath(root),
    indexSchemaVersion: typeof schema === 'number' && Number.isInteger(schema) ? schema : SCHEMA_VERSION,
  };
};

/** Assets read by the capture path rather than supplied by a host. */
const CAPTURE_ASSETS = ['spec/schema/record.schema.json'] as const;

export const runtimeAssetProblems = (identity: RuntimeIdentity): string[] =>
  CAPTURE_ASSETS
    .map((asset) => join(identity.packageRoot, asset))
    .filter((path) => !existsSync(path));

export interface IdentityDiagnosis {
  readonly ok: boolean;
  readonly detail: string;
  readonly fix: string;
}

const printed = (identity: RuntimeIdentity): string =>
  `v${identity.version}; entry ${identity.entrypoint}; root ${identity.packageRoot}; schema v${identity.indexSchemaVersion}`;

/**
 * One diagnosis string for every surface identity doctor collected.
 *
 * An entrypoint identifies the route into an installation and stays in the
 * report, but it is not the installation boundary: the bundle and compiled
 * CLI are both legitimate entrypoints under one package root.
 */
export const diagnoseRuntimeIdentities = (identities: Partial<Record<'cli' | 'hook' | 'mcp' | 'plugin', RuntimeIdentity>>): IdentityDiagnosis => {
  const cli = identities.cli;
  if (cli === undefined) return { ok: false, detail: 'CLI runtime identity is unavailable', fix: 'run commitlore doctor from the installed CLI' };
  const mismatches = (Object.entries(identities) as Array<['cli' | 'hook' | 'mcp' | 'plugin', RuntimeIdentity | undefined]>)
    .filter(([surface, identity]) => surface !== 'cli' && identity !== undefined && (
      identity.version !== cli.version ||
      identity.packageRoot !== cli.packageRoot ||
      identity.indexSchemaVersion !== cli.indexSchemaVersion
    ));
  if (mismatches.length === 0) return { ok: true, detail: `all observed runtimes match CLI: ${printed(cli)}`, fix: '' };
  const fixes: Record<'hook' | 'mcp' | 'plugin', string> = {
    hook: 'commitlore hooks install',
    mcp: 'remove the stale MCP package root named below, update its registration, then restart the host session',
    plugin: 'remove and re-add the CommitLore plugin, then start a new agent session',
  };
  return {
    ok: false,
    detail: mismatches.map(([surface, identity]) => `${surface} identity differs from CLI: ${surface} ${printed(identity!)}; CLI ${printed(cli)}`).join('\n'),
    fix: mismatches.map(([surface]) => fixes[surface as 'hook' | 'mcp' | 'plugin']).join('\n'),
  };
};

/** Schema skew is never a steady-state scan fallback: the cache can be rebuilt. */
export const convergeIndexSchema = ({ writer, reader }: { writer: RuntimeIdentity; reader: RuntimeIdentity }): IdentityDiagnosis =>
  writer.indexSchemaVersion === reader.indexSchemaVersion
    ? { ok: true, detail: `index writer and reader both use schema v${writer.indexSchemaVersion}`, fix: '' }
    : {
        ok: false,
        detail: `index writer schema v${writer.indexSchemaVersion} differs from reader schema v${reader.indexSchemaVersion}; rebuild the derived cache after upgrading the reader`,
        fix: 'commitlore index --rebuild',
      };

export const formatRuntimeIdentity = (identity: RuntimeIdentity): string =>
  JSON.stringify(identity);
