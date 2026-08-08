/**
 * The `squash-conservation` doctor check.
 *
 * It owns the local branch/history comparison because squash loss can be
 * diagnosed from Git and records alone, without coupling to sibling checks.
 */
import { execGit } from '../../../core/git.js';
import { runQuery } from '../../../core/query.js';
import { collectRange } from '../../../core/squash.js';
import { check, gitOptions } from '../model.js';
/** Local branches this check will look at, past which a repository is skipped rather than walked exhaustively. */
const MAX_SQUASH_CANDIDATE_BRANCHES = 200;
/**
 * Local branches that look like `git merge --squash` may have collapsed them
 * into HEAD without a trace: not an ancestor of HEAD (a squash never carries
 * the branch's own commits forward), but sharing a common ancestor with it
 * (so it is a real candidate, not just unrelated history). A branch HEAD
 * already contains — the ordinary merge or fast-forward case — is not one:
 * nothing was collapsed, so there is nothing this check can lose track of.
 */
const squashCandidates = (opts, head) => {
    const listed = execGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], gitOptions(opts));
    if (listed.code !== 0)
        return [];
    const branches = listed.stdout
        .split('\n')
        .filter((line) => line !== '')
        .slice(0, MAX_SQUASH_CANDIDATE_BRANCHES);
    const candidates = [];
    for (const branch of branches) {
        const resolved = execGit(['rev-parse', '--verify', '--quiet', branch], gitOptions(opts));
        const sha = resolved.code === 0 ? resolved.stdout.trim() : '';
        if (sha === '' || sha === head)
            continue;
        // Already an ancestor of HEAD (or identical to it): reached by an
        // ordinary merge, rebase, or fast-forward, and nothing was lost.
        if (execGit(['merge-base', '--is-ancestor', sha, head], gitOptions(opts)).code === 0) {
            continue;
        }
        const merged = execGit(['merge-base', sha, head], gitOptions(opts));
        if (merged.code !== 0)
            continue; // no common ancestor — unrelated history
        const base = merged.stdout.trim();
        if (base === '' || base === sha)
            continue;
        candidates.push({ branch, sha, base });
    }
    return candidates;
};
/**
 * Detects records a squash may have collapsed out of reach, and says so
 * (SPEC §2.4, bug-issue-60 finding 1: nothing invokes `squash-preserve`, and
 * for GitHub's server-side squash button nothing local can — the collapse
 * happens on a server this checkout never runs code on). Detection is the
 * honest answer where prevention is impossible.
 *
 * `Ruled-out: a CI step comparing a PR's commits against its post-merge
 * squash commit`. That is the complementary check for the case this one
 * cannot reach — a repository whose feature branch was deleted by the
 * squash before the next local clone or fetch — but it needs the GitHub API
 * to reconstruct a PR's original commits (this tool takes no HTTP dependency
 * anywhere else) and it can only ever run *after* the squash has already
 * happened and been pushed, which is too late to fix locally. `doctor` runs
 * at the moment the mistake is still cheap to fix: right after a local
 * `git merge --squash`, when the feature branch this check looks for is, in
 * the overwhelmingly common case, still sitting right there in
 * `refs/heads`. A CI step remains worth adding separately for the server-side
 * case (documented, not built here — see the module doc comment above).
 *
 * A candidate branch (`squashCandidates`) that declared no `Record-Id` at all
 * cannot be checked this way: without an identity there is nothing to search
 * HEAD's history for by name, and guessing by content would be exactly the
 * kind of heuristic this project has repeatedly found unsafe (SPEC §2.1 B3).
 * That is a real, narrower gap than "detects every lost record" and is
 * reported as such rather than silently passed over.
 */
export const checkSquashConservation = (opts) => {
    const title = 'squash conservation';
    const id = 'squash-conservation';
    const category = 'history';
    const cwd = opts.cwd ?? process.cwd();
    const head = execGit(['rev-parse', '--verify', '--quiet', 'HEAD'], gitOptions(opts));
    if (head.code !== 0) {
        return check(id, category, title, 'skipped', 'no HEAD yet — nothing to compare against', null, false, false, {
            evidence: { candidates: '0', checked: '0', uncheckable: '0', lost_count: '0' },
            skipReason: 'unborn_head',
        });
    }
    const candidates = squashCandidates(opts, head.stdout.trim());
    if (candidates.length === 0) {
        return check(id, category, title, 'skipped', 'no local branch looks like the source of a squash — nothing to check', null, false, false, {
            evidence: { candidates: '0', checked: '0', uncheckable: '0', lost_count: '0' },
            skipReason: 'nothing_applicable',
        });
    }
    let known = null;
    const lost = [];
    let uncheckable = 0;
    let checked = 0;
    for (const candidate of candidates) {
        let records;
        try {
            records = collectRange(`${candidate.base}..${candidate.sha}`, { cwd });
        }
        catch {
            continue;
        }
        if (records.length === 0)
            continue;
        checked += 1;
        const ids = new Set(records
            .map((record) => record.recordId)
            .filter((recordId) => recordId !== undefined));
        if (ids.size === 0) {
            uncheckable += 1;
            continue;
        }
        // Computed once, lazily: every candidate needs the same answer for "what
        // does HEAD's history already know", and building it is the expensive
        // part of this check.
        if (known === null) {
            known = new Set(runQuery({ cwd, allHistory: true })
                .records.map((record) => record.recordId)
                .filter((recordId) => recordId !== undefined));
        }
        for (const recordId of ids) {
            if (!known.has(recordId))
                lost.push({ branch: candidate.branch, recordId });
        }
    }
    if (checked === 0) {
        return check(id, category, title, 'skipped', `${candidates.length} branch(es) looked like a squash source, but recorded nothing checkable`, null, false, false, {
            evidence: {
                candidates: String(candidates.length),
                checked: '0',
                uncheckable: String(uncheckable),
                lost_count: '0',
            },
            skipReason: 'nothing_applicable',
        });
    }
    if (lost.length > 0) {
        const named = lost
            .slice(0, 5)
            .map((entry) => `${entry.recordId} (${entry.branch})`)
            .join(', ');
        const more = lost.length > 5 ? `, and ${lost.length - 5} more` : '';
        return check(id, category, title, 'warn', `${lost.length} record(s) declared on a branch not reachable from HEAD do not appear in HEAD's history: ${named}${more}`, 'commitlore squash-preserve <base>..<branch> --target <the commit that squashed it>, ' +
            'then commit or attach the result', false, undefined, {
            evidence: {
                candidates: String(candidates.length),
                checked: String(checked),
                uncheckable: String(uncheckable),
                lost_count: String(lost.length),
            },
        });
    }
    const detail = uncheckable > 0
        ? `${checked} squash-shaped branch(es) checked, every declared Record-Id is reachable from HEAD ` +
            `(${uncheckable} branch(es) recorded nothing with an id and could not be checked this way)`
        : `${checked} squash-shaped branch(es) checked, every declared Record-Id is reachable from HEAD`;
    return check(id, category, title, 'ok', detail, null, false, undefined, {
        evidence: {
            candidates: String(candidates.length),
            checked: String(checked),
            uncheckable: String(uncheckable),
            lost_count: '0',
        },
    });
};
//# sourceMappingURL=history-squash-conservation.js.map