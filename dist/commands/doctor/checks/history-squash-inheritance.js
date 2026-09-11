/**
 * The `squash-inheritance` doctor check (#915).
 *
 * A squash merge drops the branch commits' trailers, so the record is lost unless
 * something carries it onto the commit that squashed it. Two paths already do:
 *
 *   - a **local** `git merge --squash` is handled by the installed
 *     `prepare-commit-msg` hook, which reads `SQUASH_MSG` and appends every
 *     squashed record block to the draft (`src/hooks/prepare-commit-msg.ts`);
 *   - a **server-side** squash — the GitHub merge button — runs no local hook at
 *     all, and is handled by the `action/preserve` GitHub Action (ADR-0004).
 *
 * The second is the one nobody has running. It was built, this repository runs it
 * on itself, and it appeared in no README until #915: the reporter made one
 * record in twelve commits, the squash dropped it, and they found out only
 * because they went looking. Nothing was broken — the protection simply was not
 * installed, and no surface said so.
 *
 * `squash-conservation` is the other half of this and reports after the fact, on
 * records that are already gone. This one reports before: a repository with a
 * GitHub remote and no inheritance workflow will lose the next record it makes on
 * a branch, and that is knowable now.
 *
 * Deliberately a `warn` and not a `fail`. A repository may merge with merge
 * commits or rebase, where records survive on their own, and this check cannot
 * read the remote's merge settings — so it reports an exposure, not a defect.
 * Scoped to a GitHub remote because the Action is GitHub's mechanism; a GitLab or
 * Gitea host squashes too and has no answer here yet, which the detail says
 * rather than implying the check covered it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execGit } from '../../../core/git.js';
import { check } from '../model.js';
const WORKFLOW_DIR = join('.github', 'workflows');
/**
 * How a caller references the action. Both forms are real and this must match
 * either: `uses: OWNER/commitlore/action/preserve@vX` from another repository,
 * and `uses: ./action/preserve` from a checkout of this one — which is the form
 * this repository's own workflow uses, and the form the first draft of this
 * pattern missed because it required `commitlore` to appear in the path.
 */
const REFERENCES_ACTION = /uses:\s*\S*action[/\\]preserve/i;
const SETUP = 'see README "Squash-merge repositories" for the workflow to add';
/**
 * Whether any workflow file mentions the inheritance action. Read as text rather
 * than parsed as YAML: the question is whether the action is referenced at all,
 * and a `uses:` line is the same bytes however the surrounding job is shaped.
 */
const workflowReferencesAction = (root) => {
    const dir = join(root, WORKFLOW_DIR);
    if (!existsSync(dir))
        return { found: false, scanned: 0 };
    let scanned = 0;
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return { found: false, scanned: 0 };
    }
    for (const entry of entries) {
        if (!/\.ya?ml$/i.test(entry))
            continue;
        scanned += 1;
        let text;
        try {
            text = readFileSync(join(dir, entry), 'utf8');
        }
        catch {
            continue;
        }
        if (REFERENCES_ACTION.test(text))
            return { found: true, scanned };
    }
    return { found: false, scanned };
};
const githubRemote = (cwd) => {
    const result = execGit(['remote', '-v'], { cwd });
    if (result.code !== 0)
        return null;
    for (const line of result.stdout.split('\n')) {
        if (/github\.com/i.test(line))
            return line.split(/\s+/)[1] ?? 'origin';
    }
    return null;
};
export const checkSquashInheritance = (ctx) => {
    const id = 'squash-inheritance';
    const title = 'squash inheritance';
    const cwd = ctx.opts.cwd ?? process.cwd();
    const remote = githubRemote(cwd);
    if (remote === null) {
        return check(id, 'history', title, 'ok', 'no GitHub remote — the server-side squash path this protects against does not apply. ' +
            'A local `git merge --squash` is carried by the installed prepare-commit-msg hook either way', null, false, undefined, { evidence: { github_remote: 'none' } });
    }
    const { found, scanned } = workflowReferencesAction(cwd);
    if (found) {
        return check(id, 'history', title, 'ok', 'a workflow runs the squash inheritance action, so a record squashed by the GitHub merge ' +
            'button is carried onto the commit that squashed it', null, false, undefined, { evidence: { github_remote: remote, workflows_scanned: String(scanned), references_action: 'true' } });
    }
    return check(id, 'history', title, 'warn', 'no workflow runs the squash inheritance action. A squash merge drops the branch commits’ ' +
        'trailers, and GitHub performs that merge on its servers where no local hook runs — so if ' +
        'this repository is merged with the squash button, the next record made on a branch is lost ' +
        'silently and the author sees a green merge. `squash-conservation` reports that afterwards, ' +
        'once the record is already gone. A local `git merge --squash` is unaffected: the installed ' +
        'prepare-commit-msg hook carries those records itself. Nothing is broken here — this is ' +
        'protection that is not switched on', SETUP, false, undefined, {
        evidence: {
            github_remote: remote,
            workflows_scanned: String(scanned),
            references_action: 'false',
        },
    });
};
//# sourceMappingURL=history-squash-inheritance.js.map