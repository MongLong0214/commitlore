/** One doctor row that compares the programs actually selected by each surface. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { recordedHookIdentity, readRecordedHookTarget } from '../../../core/hook-target.js';
import { convergeIndexSchema, diagnoseRuntimeIdentities, runtimeAssetProblems, runtimeIdentity, } from '../../../core/runtime-identity.js';
import { latestLifecycleIdentity } from '../../../mcp/lifecycle.js';
import { check } from '../model.js';
const pluginIdentity = () => {
    const root = process.env['CLAUDE_PLUGIN_ROOT'];
    if (root === undefined || root === '')
        return undefined;
    const entry = join(root, 'dist', 'commitlore.mjs');
    try {
        return existsSync(entry) ? runtimeIdentity(entry) : undefined;
    }
    catch {
        return undefined;
    }
};
/**
 * A single mismatch report, not four independent version checks.  The root and
 * entrypoint are compared with the version so two cache copies cannot appear
 * healthy merely because their package manifests carry the same release.
 */
export const checkRuntimeIdentity = (ctx) => {
    const cwd = ctx.opts.cwd ?? process.cwd();
    const cli = runtimeIdentity();
    const hook = recordedHookIdentity(readRecordedHookTarget(cwd), cwd) ?? undefined;
    const mcp = latestLifecycleIdentity(cwd) ?? undefined;
    const plugin = pluginIdentity();
    const diagnosis = diagnoseRuntimeIdentities({ cli, ...(hook === undefined ? {} : { hook }), ...(mcp === undefined ? {} : { mcp }), ...(plugin === undefined ? {} : { plugin }) });
    const identities = [
        ['cli', cli],
        ...(hook === undefined ? [] : [['hook', hook]]),
        ...(mcp === undefined ? [] : [['mcp', mcp]]),
        ...(plugin === undefined ? [] : [['plugin', plugin]]),
    ];
    const missing = identities.flatMap(([surface, identity]) => runtimeAssetProblems(identity).map((path) => `${surface}: ${path}`));
    const schema = mcp === undefined ? undefined : convergeIndexSchema({ writer: cli, reader: mcp });
    const detail = [
        diagnosis.ok ? diagnosis.detail : diagnosis.detail,
        ...(missing.length === 0 ? [] : [`capture assets missing: ${missing.join(', ')}`]),
        ...(schema === undefined || schema.ok ? [] : [schema.detail]),
    ].join('\n');
    const fixes = [
        diagnosis.ok ? '' : diagnosis.fix,
        ...(missing.length === 0 ? [] : ['remove the stale package root named above, reinstall that host plugin, then restart its session']),
        ...(schema === undefined || schema.ok ? [] : ['upgrade the MCP runtime, restart its host session, then run commitlore index --rebuild']),
    ].filter(Boolean).join('\n');
    return check('runtime-identity', 'runtime', 'runtime identity', diagnosis.ok && missing.length === 0 && (schema === undefined || schema.ok) ? 'ok' : 'warn', detail, fixes === '' ? null : fixes, false, undefined, { evidence: {
            cli: JSON.stringify(cli),
            hook: hook === undefined ? 'not_observed' : JSON.stringify(hook),
            mcp: mcp === undefined ? 'not_observed (start an MCP session, then rerun doctor)' : JSON.stringify(mcp),
            plugin: plugin === undefined ? 'not_observed' : JSON.stringify(plugin),
            missing_assets: missing.join(', ') || 'none',
        } });
};
//# sourceMappingURL=runtime-runtime-identity.js.map