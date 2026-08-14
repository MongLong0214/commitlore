/** The live-process identity check for MCP servers (#F-001). */

import type { LiveMcpRuntime } from '../../../core/mcp-probe.js';
import { check, type Category, type DoctorCheck, type DoctorContext } from '../model.js';

const identityOf = (runtime: LiveMcpRuntime): string =>
  `${runtime.entrypointRealpath} (root ${runtime.packageRoot})`;

const missingAssets = (runtime: LiveMcpRuntime): string[] => [
  ...(runtime.bundlePresent ? [] : ['dist/commitlore.mjs']),
  ...(runtime.specPresent ? [] : ['spec/SPEC.md']),
];

/**
 * A registration records an intended launch; only the process list identifies
 * which already-running server owns a client's current session. Never compare
 * versions here: a copied or stale install can legitimately report the same.
 */
export const checkMcpRuntimeIdentity = (ctx: DoctorContext): DoctorCheck => {
  const id = 'mcp-runtime-identity';
  const title = 'live MCP runtime identity';
  const category: Category = 'delivery';
  const scan = ctx.liveMcpRuntimes();

  if (!scan.available) {
    return check(
      id,
      category,
      title,
      'warn',
      `could not enumerate live CommitLore MCP runtimes: ${scan.detail}`,
      null,
      false,
      undefined,
      { evidence: { discovery: 'unavailable', detail: scan.detail } },
    );
  }

  const unusable = scan.runtimes.filter((runtime) => missingAssets(runtime).length > 0);
  if (unusable.length > 0) {
    const detail = unusable
      .map((runtime) => `${runtime.packageRoot} is missing ${missingAssets(runtime).join(' and ')}`)
      .join('; ');
    // `warn`, not `fail`. What this observes is the machine, not this
    // repository: a server left running by another session, from an install
    // that has since been deleted, is not something the checkout can fix and
    // must not decide its exit code. Making it fail also made this suite's
    // result depend on what happened to be running while it ran, which is the
    // defect class this check exists to surface.
    return check(
      id,
      category,
      title,
      'warn',
      `${unusable.length} live CommitLore MCP runtime(s) are unusable: ${detail}`,
      null,
      false,
      undefined,
      {
        evidence: {
          discovery: scan.detail,
          runtime_count: String(scan.runtimes.length),
          unusable_roots: unusable.map((runtime) => runtime.packageRoot).join(', '),
        },
      },
    );
  }

  const identities = [...new Map(scan.runtimes.map((runtime) => [identityOf(runtime), runtime])).values()];
  if (identities.length > 1) {
    return check(
      id,
      category,
      title,
      'warn',
      `${identities.length} distinct live CommitLore runtimes are answering MCP — runtime mismatch: ` +
        identities.map(identityOf).join('; '),
      null,
      false,
      undefined,
      {
        evidence: {
          discovery: scan.detail,
          runtime_count: String(scan.runtimes.length),
          distinct_identities: String(identities.length),
          package_roots: identities.map((runtime) => runtime.packageRoot).join(', '),
        },
      },
    );
  }

  return check(
    id,
    category,
    title,
    'ok',
    identities.length === 0
      ? 'no live CommitLore MCP runtime was found'
      : `one live CommitLore MCP runtime is answering from ${identityOf(identities[0]!)}`,
    null,
    false,
    undefined,
    {
      evidence: {
        discovery: scan.detail,
        runtime_count: String(scan.runtimes.length),
        distinct_identities: String(identities.length),
      },
    },
  );
};
