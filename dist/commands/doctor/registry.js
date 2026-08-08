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
/** Runs `hook-runtime` at most once per report, whichever row asks first. */
const hookRuntimeOf = (ctx) => {
    const cached = ctx.memo.get('hook-runtime');
    if (cached !== undefined)
        return cached;
    const computed = checkHookRuntime(ctx);
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
export const CHECK_REGISTRY = [
    { id: 'cli-runtime', title: 'cli runtime', category: 'runtime', dependencies: [], optional: false, run: (ctx) => checkRuntime(ctx) },
    { id: 'notes-refspec', title: 'notes fetch refspec', category: 'transport', dependencies: [], optional: false, run: (ctx) => checkRefspec(ctx) },
    { id: 'notes-push', title: 'notes push', category: 'transport', dependencies: [], optional: false, run: (ctx) => checkPush(ctx) },
    { id: 'commit-msg-hook', title: 'commit-msg hook', category: 'capture', dependencies: [], optional: false, run: (ctx) => checkHook(ctx, hookRuntimeOf(ctx)) },
    { id: 'hook-runtime', title: 'hook runtime', category: 'capture', dependencies: [], optional: false, run: hookRuntimeOf },
    { id: 'inject-runtime', title: 'PreToolUse hook runtime', category: 'delivery', dependencies: [], optional: false, run: (ctx) => checkInjectRuntime(ctx) },
    { id: 'inject-version', title: 'PreToolUse hook version', category: 'delivery', dependencies: ['inject-runtime'], optional: false, run: (ctx, dependencies) => checkInjectVersion(ctx, dependencies) },
    { id: 'mcp-lifecycle', title: 'MCP server sessions', category: 'delivery', dependencies: [], optional: false, run: (ctx) => checkMcpLifecycle(ctx) },
    { id: 'pending-backlog', title: 'pending captures', category: 'capture', dependencies: [], optional: false, run: (ctx) => checkPendingBacklog(ctx) },
    { id: 'git-trailers', title: 'git interpret-trailers', category: 'runtime', dependencies: [], optional: false, run: (ctx) => checkGit(ctx) },
    { id: 'history-depth', title: 'history depth', category: 'history', dependencies: [], optional: false, run: (ctx) => checkHistoryDepth(ctx) },
    { id: 'index-health', title: 'index health', category: 'index', dependencies: [], optional: false, run: (ctx) => checkIndex(ctx) },
    { id: 'squash-conservation', title: 'squash conservation', category: 'history', dependencies: [], optional: false, run: (ctx) => checkSquashConservation(ctx) },
];
//# sourceMappingURL=registry.js.map