/**
 * The `commit-msg-hook` doctor check.
 *
 * It owns the installed-hook diagnosis while accepting the runtime row from
 * the registry, keeping its sole declared relationship out of sibling imports.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execGit } from '../../../core/git.js';
import { classifyBinTarget, describeRecordedHookTarget, readRecordedHookTarget } from '../../../core/hook-target.js';
import { HOOK_MARKER, commitMsgStub } from '../../../hooks/commit-msg.js';
import { blocked, check, gitOptions } from '../model.js';
/**
 * Installation belongs to `commitlore hooks install` (T-202). This reads.
 *
 * The marker is imported from the stub rather than restated, so that doctor
 * can never disagree with the installer about what "installed" means.
 */
export const checkHook = (opts, runtime) => {
    const title = 'commit-msg hook';
    const id = 'commit-msg-hook';
    const category = 'capture';
    const install = 'commitlore hooks install';
    // --git-path, not a hardcoded .git/: worktrees and submodules keep hooks
    // somewhere else entirely.
    const located = execGit(['rev-parse', '--git-path', 'hooks/commit-msg'], gitOptions(opts));
    if (located.code !== 0) {
        return check(id, category, title, 'warn', 'not inside a git repository', install, false, undefined, { evidence: { hook_path: 'unavailable', bin: 'not_recorded', node: 'not_recorded' } });
    }
    const path = resolve(opts.cwd ?? process.cwd(), located.stdout.trim());
    const target = readRecordedHookTarget(opts.cwd ?? process.cwd());
    const override = process.env['COMMITLORE_BIN'];
    const hookEvidence = {
        hook_path: path,
        bin: target.bin || '(unset)',
        node: target.node || '(unset)',
        ...(override === undefined || override === '' ? {} : { commitlore_bin_override: override }),
    };
    const targetDetail = [
        ...describeRecordedHookTarget(target),
        ...(override === undefined || override === '' ? [] : [`COMMITLORE_BIN: ${override}`]),
    ].join('; ');
    if (!existsSync(path)) {
        return check(id, category, title, 'warn', `no commit-msg hook at ${path}; ${targetDetail}`, install, false, undefined, { evidence: hookEvidence });
    }
    const contents = readFileSync(path, 'utf8');
    if (!contents.includes(HOOK_MARKER)) {
        return check(id, category, title, 'warn', `a commit-msg hook exists at ${path} but does not invoke commitlore; ${targetDetail}`, install, false, undefined, { evidence: hookEvidence });
    }
    // `hooks status` has always reported this; doctor did not, and doctor is what
    // people run to ask whether their installation is healthy. A stale stub is
    // exactly how a fixed resolution order fails to reach anyone who installed
    // before it landed.
    if (contents !== commitMsgStub()) {
        return check(id, category, title, 'warn', `installed at ${path}, but the stub is out of date — it predates a change to how the hook finds the CLI; ${targetDetail}`, install, false, undefined, { evidence: hookEvidence });
    }
    const problems = [
        ...target.problems,
        ...(override === undefined || override === ''
            ? []
            : classifyBinTarget(override) !== null
                ? ['COMMITLORE_BIN override is active']
                : [
                    'COMMITLORE_BIN override is active, but is not a .js or .mjs file — the hook ' +
                        'ignores it and falls through to the remaining resolution steps',
                ]),
    ];
    if (runtime.status !== 'ok') {
        const inherited = `installed at ${path}; ${targetDetail}; outcome: ${runtime.detail}`;
        // A skipped runtime would make this row a skip too, and a skip has to name
        // a reason. Inheriting the runtime's is the only answer that stays true —
        // this row did not look for the same reason that one did not. The branch is
        // unreachable today because `hook-runtime` has no skip site, and it is
        // written out rather than cast away so that adding one cannot silently
        // produce a reasonless skip here.
        if (runtime.status === 'skipped') {
            return blocked(runtime, check(id, category, title, 'skipped', inherited, install, false, false, {
                evidence: { ...hookEvidence, runtime_status: runtime.status },
                skipReason: runtime.skipReason ?? 'nothing_applicable',
            }));
        }
        return blocked(runtime, check(id, category, title, runtime.status, inherited, install, false, undefined, { evidence: { ...hookEvidence, runtime_status: runtime.status } }));
    }
    return problems.length === 0
        ? check(id, category, title, 'ok', `installed at ${path}; ${targetDetail}`, null, false, undefined, { evidence: hookEvidence })
        : check(id, category, title, 'warn', `installed at ${path}; ${targetDetail}; ${problems.join('; ')}`, install, false, undefined, { evidence: hookEvidence });
};
//# sourceMappingURL=capture-commit-msg-hook.js.map