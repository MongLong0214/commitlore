/**
 * Doctor's ordered check registry.
 *
 * This is the single ownership point for report order and the one intentional
 * hook-runtime hand-off, so checks stay self-contained modules rather than
 * importing each other.
 */

import { checkHook } from './checks/capture-commit-msg-hook.js';
import { checkHookRuntime } from './checks/capture-hook-runtime.js';
import { checkPendingBacklog } from './checks/capture-pending-backlog.js';
import { checkPolicyOverlay } from './checks/capture-policy-overlay.js';
import { checkUnattendedCaptureInitiator } from './checks/capture-unattended-initiator.js';
import { checkInjectRuntime } from './checks/delivery-inject-runtime.js';
import { checkInjectVersion } from './checks/delivery-inject-version.js';
import { checkDirectiveTrustMode } from './checks/delivery-directive-trust-mode.js';
import { checkMcpLifecycle } from './checks/delivery-mcp-lifecycle.js';
import { checkMcpRuntimeIdentity } from './checks/delivery-mcp-runtime-identity.js';
import { checkHistoryDepth } from './checks/history-history-depth.js';
import { checkSquashConservation } from './checks/history-squash-conservation.js';
import { checkIndex } from './checks/index-index-health.js';
import { checkRuntime } from './checks/runtime-cli-runtime.js';
import { checkRuntimeIdentity } from './checks/runtime-runtime-identity.js';
import { checkInstallationIntegrity } from './checks/runtime-installation-integrity.js';
import { checkGit } from './checks/runtime-git-trailers.js';
import { checkPush } from './checks/transport-notes-push.js';
import { checkRefspec } from './checks/transport-notes-refspec.js';
import type { Category, DoctorCheck, DoctorContext, DoctorOptions } from './model.js';

/**
 * A check as data rather than a position in a hand-written array.
 *
 * What that buys, and why it is worth the indirection (ADR-0032 §4): ordering
 * becomes something a test can assert, `--only`/`--category` become filters
 * over data instead of new code paths, each `run` is testable in isolation, and
 * the dependencies that exist implicitly today get a declared place.
 */
export interface CheckDefinition {
  readonly id: string;
  readonly title: string;
  readonly category: Category;
  /** Ids of entries that appear earlier in this registry (PRD §2 req 2). */
  readonly dependencies: readonly string[];
  readonly optional: boolean;
  readonly run: (ctx: DoctorContext, dependencies: ReadonlyMap<string, DoctorCheck>) => DoctorCheck;
}

/** Runs `hook-runtime` at most once per report, whichever row asks first. */
const hookRuntimeOf = (ctx: DoctorContext): DoctorCheck => {
  const cached = ctx.memo.get('hook-runtime');
  if (cached !== undefined) return cached;
  const computed = checkHookRuntime(ctx);
  ctx.memo.set('hook-runtime', computed);
  return computed;
};

/**
 * `commit-msg-hook` historically asks for its runtime result through `memo`
 * because it appears before `hook-runtime` in the frozen output order. On a
 * partial run that would silently execute a row the user did not select, so
 * its optional hand-off is available only when the runtime row is selected.
 */
const selectedHookRuntimeOf = (ctx: DoctorContext): DoctorCheck | undefined =>
  ctx.selectedIds?.has('hook-runtime') === false ? undefined : hookRuntimeOf(ctx);

/**
 * The registry. **Order is the report's order**, frozen to the array
 * `runDoctor` shipped with, because PRD §9.1 holds the text byte-identical
 * until the rendering ticket.
 *
 * `commit-msg-hook → hook-runtime` is deliberately not declared here: the
 * dependency runs backwards against this order, and §2 req 2 admits only
 * earlier entries. It is threaded through `memo` instead and declared once the
 * ordering rule is settled.
 */
export const CHECK_REGISTRY: readonly CheckDefinition[] = [
  { id: 'cli-runtime', title: 'cli runtime', category: 'runtime', dependencies: [], optional: false, run: (ctx) => checkRuntime(ctx) },
  { id: 'runtime-identity', title: 'runtime identity', category: 'runtime', dependencies: [], optional: false, run: (ctx) => checkRuntimeIdentity(ctx) },
  { id: 'installation-integrity', title: 'installation integrity', category: 'runtime', dependencies: [], optional: false, run: (ctx) => checkInstallationIntegrity(ctx) },
  { id: 'notes-refspec', title: 'notes fetch refspec', category: 'transport', dependencies: [], optional: false, run: (ctx) => checkRefspec(ctx) },
  { id: 'notes-push', title: 'notes push', category: 'transport', dependencies: [], optional: false, run: (ctx) => checkPush(ctx) },
  { id: 'commit-msg-hook', title: 'commit-msg hook', category: 'capture', dependencies: [], optional: false, run: (ctx) => checkHook(ctx, selectedHookRuntimeOf(ctx)) },
  { id: 'hook-runtime', title: 'hook runtime', category: 'capture', dependencies: [], optional: false, run: hookRuntimeOf },
  { id: 'inject-runtime', title: 'PreToolUse hook runtime', category: 'delivery', dependencies: [], optional: false, run: (ctx) => checkInjectRuntime(ctx) },
  { id: 'inject-version', title: 'PreToolUse hook version', category: 'delivery', dependencies: ['inject-runtime'], optional: false, run: (ctx, dependencies) => checkInjectVersion(ctx, dependencies) },
  { id: 'directive-trust-mode', title: 'directive trust mode', category: 'delivery', dependencies: [], optional: false, run: (ctx) => checkDirectiveTrustMode(ctx) },
  { id: 'mcp-lifecycle', title: 'MCP server sessions', category: 'delivery', dependencies: [], optional: false, run: (ctx) => checkMcpLifecycle(ctx) },
  { id: 'mcp-runtime-identity', title: 'live MCP runtime identity', category: 'delivery', dependencies: [], optional: false, run: (ctx) => checkMcpRuntimeIdentity(ctx) },
  { id: 'unattended-initiator', title: 'unattended capture initiator', category: 'capture', dependencies: [], optional: false, run: (ctx) => checkUnattendedCaptureInitiator(ctx) },
  { id: 'policy-overlay', title: 'capture policy overlay', category: 'capture', dependencies: [], optional: false, run: (ctx) => checkPolicyOverlay(ctx) },
  { id: 'pending-backlog', title: 'pending captures', category: 'capture', dependencies: [], optional: false, run: (ctx) => checkPendingBacklog(ctx) },
  { id: 'git-trailers', title: 'git interpret-trailers', category: 'runtime', dependencies: [], optional: false, run: (ctx) => checkGit(ctx) },
  { id: 'history-depth', title: 'history depth', category: 'history', dependencies: [], optional: false, run: (ctx) => checkHistoryDepth(ctx) },
  { id: 'index-health', title: 'index health', category: 'index', dependencies: [], optional: false, run: (ctx) => checkIndex(ctx) },
  { id: 'squash-conservation', title: 'squash conservation', category: 'history', dependencies: [], optional: false, run: (ctx) => checkSquashConservation(ctx) },
] as const;

/** An invalid selection is a usage error, never an empty health report. */
export class DoctorSelectionError extends Error {}

export interface DoctorSelection {
  /** The entries to run, kept in their registry order. */
  readonly definitions: readonly CheckDefinition[];
  /** Present exactly when a caller asked for a partial run. */
  readonly selection?: string[];
}

const knownCategories = (): ReadonlySet<string> => new Set(CHECK_REGISTRY.map((definition) => definition.category));

/**
 * Select before a context or check exists. Filtering after the runner would
 * hide rows while still spawning probes and touching Git, which is neither a
 * filter nor an honest partial report.
 */
export const selectChecks = (opts: DoctorOptions): DoctorSelection => {
  const ids = opts.only === undefined ? undefined : [...new Set(opts.only)];
  const category = opts.category;

  if (ids === undefined && category === undefined) return { definitions: CHECK_REGISTRY };

  if (ids !== undefined) {
    if (ids.length === 0 || ids.some((id) => id === '')) {
      throw new DoctorSelectionError('--only must name at least one check id');
    }
    const unknown = ids.find((id) => !CHECK_REGISTRY.some((definition) => definition.id === id));
    if (unknown !== undefined) throw new DoctorSelectionError(`unknown doctor check id: ${unknown}`);
  }

  if (category !== undefined && !knownCategories().has(category)) {
    throw new DoctorSelectionError(`unknown doctor check category: ${category}`);
  }

  const definitions = CHECK_REGISTRY.filter(
    (definition) =>
      (ids === undefined || ids.includes(definition.id)) &&
      (category === undefined || definition.category === category),
  );
  if (definitions.length === 0) {
    throw new DoctorSelectionError('--only and --category do not select a common check');
  }

  return {
    definitions,
    selection: [...(ids ?? []), ...(category === undefined ? [] : [category])],
  };
};
