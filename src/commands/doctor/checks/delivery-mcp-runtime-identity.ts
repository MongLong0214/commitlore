/** The live-process identity check for MCP servers (#F-001). */

import type { LiveMcpRuntime } from '../../../core/mcp-probe.js';
import { check, type Category, type DoctorCheck, type DoctorContext } from '../model.js';

/**
 * None of the `warn` rows below claims attention, and the reason is the one this
 * file already gives for refusing to `fail`: what it observes is the machine,
 * not this repository. A server another session left running, from an install
 * that may since have been deleted, is not something a checkout can act on --
 * which is the same test the two existing `needsAttention` overrides use (#192,
 * #221: "neither is something the user can act on here").
 *
 * It matters beyond `doctor`, which exits 0 for a `warn` anyway. `init` is
 * stricter on purpose and treats any check needing attention as a step that did
 * not complete, so without this a repository-scoped command reports failure
 * because of an unrelated process on the developer's machine -- and it did:
 * six cases in `test/init.test.ts` failed for every developer with an editor
 * session open, and passed on CI runners, which is a suite that stops carrying
 * information (#750).
 */
const identityOf = (runtime: LiveMcpRuntime): string =>
  `${runtime.entrypointRealpath} (root ${runtime.packageRoot})`;

/**
 * Group the scan by identity, keeping every pid rather than the first (#885).
 *
 * The scan already knows each process id and this row used to drop all of them
 * on the way to a deduplicated identity string. That left an operator told three
 * runtimes were answering and given nothing to act on — the reporter had to run
 * `ps` themselves to find the five processes behind those three names.
 */
const pidsByIdentity = (runtimes: readonly LiveMcpRuntime[]): Map<string, number[]> => {
  const grouped = new Map<string, number[]>();
  for (const runtime of runtimes) {
    const key = identityOf(runtime);
    const pids = grouped.get(key);
    if (pids === undefined) grouped.set(key, [runtime.pid]);
    else pids.push(runtime.pid);
  }
  return grouped;
};

const withPids = (identity: string, pids: readonly number[]): string =>
  `${identity} pid ${pids.join(', ')}`;

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
      // Machine state, not this repository's -- see the note above.
      false,
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
      // Machine state, not this repository's -- see the note above.
      false,
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
    const grouped = pidsByIdentity(scan.runtimes);
    const allPids = scan.runtimes.map((runtime) => runtime.pid);
    return check(
      id,
      category,
      title,
      'warn',
      `${identities.length} distinct live CommitLore runtimes are answering MCP — runtime mismatch: ` +
        identities
          .map((runtime) => withPids(identityOf(runtime), grouped.get(identityOf(runtime)) ?? []))
          .join('; ') +
        // #885: the row named versions and stopped, so an operator could not tell
        // whether it was cosmetic. These runtimes write. Each answers with the
        // build it started on, so records committed in one repository on one day
        // can come from more than one of them, and nothing on the commit says
        // which. Deliberately does not name one of them as the stale one:
        // r-liveruntime660 ruled that out, because a copied or stale install can
        // report the same version as a current one.
        '. Each keeps writing records with the build it started on, so this' +
        ' repository can receive records from more than one of them',
      'restart the host sessions that own these pids so every session answers from one install' +
        ` (${allPids.join(', ')}) — a host resolves the launcher once at session start and holds` +
        ' that runtime until the session ends, so an upgrade does not reach a session already running',
      false,
      // Machine state, not this repository's -- see the note above.
      false,
      {
        evidence: {
          discovery: scan.detail,
          runtime_count: String(scan.runtimes.length),
          distinct_identities: String(identities.length),
          package_roots: identities.map((runtime) => runtime.packageRoot).join(', '),
          pids: allPids.join(', '),
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
