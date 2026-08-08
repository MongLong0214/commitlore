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
import { checkInjectRuntime } from './checks/delivery-inject-runtime.js';
import { checkInjectVersion } from './checks/delivery-inject-version.js';
import { checkMcpLifecycle } from './checks/delivery-mcp-lifecycle.js';
import { checkHistoryDepth } from './checks/history-history-depth.js';
import { checkSquashConservation } from './checks/history-squash-conservation.js';
import { checkIndex } from './checks/index-index-health.js';
import { checkRuntime } from './checks/runtime-cli-runtime.js';
import { checkGit } from './checks/runtime-git-trailers.js';
import { checkPush } from './checks/transport-notes-push.js';
import { checkRefspec } from './checks/transport-notes-refspec.js';
import type { Category, DoctorCheck, DoctorContext } from './model.js';

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
  const computed = checkHookRuntime(ctx.opts);
  ctx.memo.set('hook-runtime', computed);
  return computed;
};

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
  { id: 'cli-runtime', title: 'cli runtime', category: 'runtime', dependencies: [], optional: false, run: (ctx) => checkRuntime(ctx.opts) },
  { id: 'notes-refspec', title: 'notes fetch refspec', category: 'transport', dependencies: [], optional: false, run: (ctx) => checkRefspec(ctx.opts) },
  { id: 'notes-push', title: 'notes push', category: 'transport', dependencies: [], optional: false, run: (ctx) => checkPush(ctx.opts) },
  { id: 'commit-msg-hook', title: 'commit-msg hook', category: 'capture', dependencies: [], optional: false, run: (ctx) => checkHook(ctx.opts, hookRuntimeOf(ctx)) },
  { id: 'hook-runtime', title: 'hook runtime', category: 'capture', dependencies: [], optional: false, run: hookRuntimeOf },
  { id: 'inject-runtime', title: 'PreToolUse hook runtime', category: 'delivery', dependencies: [], optional: false, run: (ctx) => checkInjectRuntime(ctx.opts) },
  { id: 'inject-version', title: 'PreToolUse hook version', category: 'delivery', dependencies: ['inject-runtime'], optional: false, run: (ctx, dependencies) => checkInjectVersion(ctx.opts, dependencies) },
  { id: 'mcp-lifecycle', title: 'MCP server sessions', category: 'delivery', dependencies: [], optional: false, run: (ctx) => checkMcpLifecycle(ctx.opts) },
  { id: 'pending-backlog', title: 'pending captures', category: 'capture', dependencies: [], optional: false, run: (ctx) => checkPendingBacklog(ctx.opts) },
  { id: 'git-trailers', title: 'git interpret-trailers', category: 'runtime', dependencies: [], optional: false, run: (ctx) => checkGit(ctx.opts) },
  { id: 'history-depth', title: 'history depth', category: 'history', dependencies: [], optional: false, run: (ctx) => checkHistoryDepth(ctx.opts) },
  { id: 'index-health', title: 'index health', category: 'index', dependencies: [], optional: false, run: (ctx) => checkIndex(ctx.opts) },
  { id: 'squash-conservation', title: 'squash conservation', category: 'history', dependencies: [], optional: false, run: (ctx) => checkSquashConservation(ctx.opts) },
] as const;
