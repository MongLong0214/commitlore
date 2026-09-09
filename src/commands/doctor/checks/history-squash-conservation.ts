/**
 * The `squash-conservation` doctor check.
 *
 * It owns the local branch/history comparison because squash loss can be
 * diagnosed from Git and records alone, without coupling to sibling checks.
 */

import { runQuery } from '../../../core/query.js';
import { collectRange } from '../../../core/squash.js';
import { check, gitOptions, type Category, type DoctorCheck, type DoctorContext } from '../model.js';

/** Local branches this check will look at, past which a repository is skipped rather than walked exhaustively. */
const MAX_SQUASH_CANDIDATE_BRANCHES = 200;

interface SquashCandidate {
  branch: string;
  sha: string;
  base: string;
}

interface SquashCandidateScan {
  candidates: SquashCandidate[];
  branchesSeen: number;
  branchesChecked: number;
}

/**
 * Local branches that look like `git merge --squash` may have collapsed them
 * into HEAD without a trace: not an ancestor of HEAD (a squash never carries
 * the branch's own commits forward), but sharing a common ancestor with it
 * (so it is a real candidate, not just unrelated history). A branch HEAD
 * already contains — the ordinary merge or fast-forward case — is not one:
 * nothing was collapsed, so there is nothing this check can lose track of.
 */
const squashCandidates = (ctx: DoctorContext, head: string): SquashCandidateScan => {
  const { opts, git } = ctx;
  const listed = git(
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
    gitOptions(opts),
  );
  if (listed.code !== 0) return { candidates: [], branchesSeen: 0, branchesChecked: 0 };

  const allBranches = listed.stdout
    .split('\n')
    .filter((line) => line !== '');
  const branches = allBranches.slice(0, MAX_SQUASH_CANDIDATE_BRANCHES);

  const candidates: SquashCandidate[] = [];
  for (const branch of branches) {
    const resolved = git(['rev-parse', '--verify', '--quiet', branch], gitOptions(opts));
    const sha = resolved.code === 0 ? resolved.stdout.trim() : '';
    if (sha === '' || sha === head) continue;

    // Already an ancestor of HEAD (or identical to it): reached by an
    // ordinary merge, rebase, or fast-forward, and nothing was lost.
    if (git(['merge-base', '--is-ancestor', sha, head], gitOptions(opts)).code === 0) {
      continue;
    }

    const merged = git(['merge-base', sha, head], gitOptions(opts));
    if (merged.code !== 0) continue; // no common ancestor — unrelated history
    const base = merged.stdout.trim();
    if (base === '' || base === sha) continue;

    candidates.push({ branch, sha, base });
  }

  return {
    candidates,
    branchesSeen: allBranches.length,
    branchesChecked: branches.length,
  };
};

/**
 * What became of a candidate branch's content, which is a different question
 * from what became of its commits (#888).
 *
 * `squashCandidates` asks only whether the branch's *commits* are reachable
 * from HEAD. A squash makes them unreachable, and so does closing a pull
 * request without merging — the two are identical in the commit graph, and the
 * check concluded "squashed" for both. That is not merely imprecise: the remedy
 * it prescribed, `squash-preserve --target`, writes the branch's records onto a
 * commit chosen by the caller with no check that the commit contains the work.
 * Run on an abandoned branch it manufactures provenance for something that was
 * deliberately discarded, which is the failure this tool exists to prevent.
 *
 * The content separates them: a squash carries the branch's tree into HEAD even
 * though its commits are gone, and an abandoned branch's tree is nowhere.
 *
 * This is not the content-guessing the module doc rules out. That warns against
 * identifying *records* by content instead of by `Record-Id`, and nothing here
 * does: the set of records reported is computed exactly as before and is
 * unchanged by this classification. What varies is only what the row claims
 * happened and what it prescribes — so a misclassification costs a vaguer
 * message, never a dropped finding.
 */
type BranchContentFate = 'present-in-head' | 'absent-from-head' | 'unknown';

/**
 * Compares blob ids per touched path rather than trees or patch ids.
 *
 * `git cherry` and `patch-id` cannot answer this: a squash collapses N commits
 * into one whose diff matches none of them individually, so a genuine squash
 * reads as "not applied" to both. `merge-tree --write-tree` would answer it
 * directly but needs Git 2.38, and this project declares no Git floor —
 * `git rev-parse <rev>:<path>` works everywhere.
 *
 * Deliberately asymmetric. `present-in-head` demands that *every* touched path
 * resolve to the same blob in HEAD, and `absent-from-head` that *no* touched
 * path exists in HEAD at all. A squash whose files `main` has since edited
 * satisfies neither and lands on `unknown`, which still prescribes preserving —
 * the direction that cannot lose a record.
 */
const branchContentFate = (
  ctx: DoctorContext,
  candidate: SquashCandidate,
  head: string,
): BranchContentFate => {
  const { opts, git } = ctx;
  const changed = git(
    ['diff', '--name-only', `${candidate.base}..${candidate.sha}`],
    gitOptions(opts),
  );
  if (changed.code !== 0) return 'unknown';
  const paths = changed.stdout.split('\n').filter((line) => line !== '');
  if (paths.length === 0) return 'unknown';

  let matching = 0;
  let missingFromHead = 0;
  for (const path of paths) {
    const onBranch = git(['rev-parse', '--verify', '--quiet', `${candidate.sha}:${path}`], gitOptions(opts));
    const onHead = git(['rev-parse', '--verify', '--quiet', `${head}:${path}`], gitOptions(opts));
    // A path deleted by the branch has no blob on either side; it says nothing
    // either way, so it is neither a match nor a miss.
    if (onBranch.code !== 0) return 'unknown';
    if (onHead.code !== 0) {
      missingFromHead += 1;
      continue;
    }
    if (onHead.stdout.trim() === onBranch.stdout.trim()) matching += 1;
  }

  if (matching === paths.length) return 'present-in-head';
  if (missingFromHead === paths.length) return 'absent-from-head';
  return 'unknown';
};

const scanLimitDetail = (scan: SquashCandidateScan): string =>
  scan.branchesSeen > MAX_SQUASH_CANDIDATE_BRANCHES
    ? `; only the first ${MAX_SQUASH_CANDIDATE_BRANCHES} of ${scan.branchesSeen} local branches were checked`
    : '';

const scanEvidence = (
  scan: SquashCandidateScan,
  evidence: Record<string, string>,
): Record<string, string> =>
  scan.branchesSeen > MAX_SQUASH_CANDIDATE_BRANCHES
    ? {
        ...evidence,
        branches_seen: String(scan.branchesSeen),
        branches_checked: String(scan.branchesChecked),
      }
    : evidence;

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
export const checkSquashConservation = (ctx: DoctorContext): DoctorCheck => {
  const { opts, git } = ctx;
  const title = 'squash conservation';
  const id = 'squash-conservation';
  const category: Category = 'history';
  const cwd = opts.cwd ?? process.cwd();

  const head = git(['rev-parse', '--verify', '--quiet', 'HEAD'], gitOptions(opts));
  if (head.code !== 0) {
    return check(
      id,
      category,
      title,
      'skipped',
      'no HEAD yet — nothing to compare against',
      null,
      false,
      false,
      {
        evidence: { candidates: '0', checked: '0', uncheckable: '0', lost_count: '0' },
        skipReason: 'unborn_head',
      },
    );
  }

  const scan = squashCandidates(ctx, head.stdout.trim());
  const { candidates } = scan;
  if (candidates.length === 0) {
    return check(
      id,
      category,
      title,
      'skipped',
      `no local branch looks like the source of a squash — nothing to check${scanLimitDetail(scan)}`,
        null,
    false,
    false,
    {
      evidence: scanEvidence(scan, { candidates: '0', checked: '0', uncheckable: '0', lost_count: '0' }),
      skipReason: 'nothing_applicable',
    },
  );
  }

  let known: Set<string> | null = null;
  const lost: { branch: string; recordId: string; fate: BranchContentFate }[] = [];
  let uncheckable = 0;
  let checked = 0;
  const headSha = head.stdout.trim();

  for (const candidate of candidates) {
    let records;
    try {
      records = collectRange(`${candidate.base}..${candidate.sha}`, { cwd });
    } catch {
      continue;
    }
    if (records.length === 0) continue;
    checked += 1;

    const ids = new Set(
      records
        .map((record) => record.recordId)
        .filter((recordId): recordId is string => recordId !== undefined),
    );
    if (ids.size === 0) {
      uncheckable += 1;
      continue;
    }

    // Computed once, lazily: every candidate needs the same answer for "what
    // does HEAD's history already know", and building it is the expensive
    // part of this check.
    if (known === null) {
      known = new Set(
        runQuery({ cwd, allHistory: true })
          .records.map((record) => record.recordId)
          .filter((recordId): recordId is string => recordId !== undefined),
      );
    }

    // Classified once per branch, and only when the branch has actually lost
    // something — an ok run pays nothing for it.
    let fate: BranchContentFate | null = null;
    for (const recordId of ids) {
      if (known.has(recordId)) continue;
      fate ??= branchContentFate(ctx, candidate, headSha);
      lost.push({ branch: candidate.branch, recordId, fate });
    }
  }

  if (checked === 0) {
    return check(
      id,
      category,
      title,
      'skipped',
      `${candidates.length} branch(es) looked like a squash source, but recorded nothing checkable${scanLimitDetail(scan)}`,
        null,
    false,
    false,
    {
      evidence: scanEvidence(scan, {
        candidates: String(candidates.length),
        checked: '0',
        uncheckable: String(uncheckable),
        lost_count: '0',
      }),
      skipReason: 'nothing_applicable',
    },
  );
  }

  if (lost.length > 0) {
    const FATE_NOTE: Record<BranchContentFate, string> = {
      'present-in-head': 'its changes are in HEAD, so it was squashed',
      'absent-from-head': 'none of its changes are in HEAD, so it was never merged',
      unknown: 'whether its changes reached HEAD could not be determined',
    };
    const named = lost
      .slice(0, 5)
      .map((entry) => `${entry.recordId} (${entry.branch} — ${FATE_NOTE[entry.fate]})`)
      .join(', ');
    const more = lost.length > 5 ? `, and ${lost.length - 5} more` : '';

    // Only branches whose work actually landed are worth preserving records
    // for. `unknown` is grouped with them deliberately: prescribing a
    // preservation that turns out to be unnecessary costs a discarded plan,
    // while withholding it from a real squash loses the record for good.
    const preservable = lost.filter((entry) => entry.fate !== 'absent-from-head');
    const abandonedOnly = preservable.length === 0;
    const fix = abandonedOnly
      ? // #888: this used to prescribe squash-preserve here too. `--target`
        // mirrors the records onto whatever commit it is handed without
        // checking that the commit contains the work, so running it on a
        // branch that was closed unmerged writes provenance for work that was
        // deliberately discarded.
        'nothing to preserve — these branches were closed without merging, and their records ' +
        'describe work HEAD does not contain; delete the branches, or leave them'
      : `commitlore squash-preserve <base>..<branch> --target <the commit that squashed it>, ` +
        `then commit or attach the result` +
        (preservable.length === lost.length
          ? ''
          : ` (only the ${preservable.length} on a branch whose changes reached HEAD)`);

    return check(
      id,
      category,
      title,
      'warn',
      `${lost.length} record(s) declared on a branch not reachable from HEAD do not appear in HEAD's history: ${named}${more}${scanLimitDetail(scan)}`,
      fix,
      false,
      undefined,
      {
        evidence: scanEvidence(scan, {
          candidates: String(candidates.length),
          checked: String(checked),
          uncheckable: String(uncheckable),
          lost_count: String(lost.length),
          squashed_count: String(lost.filter((entry) => entry.fate === 'present-in-head').length),
          unmerged_count: String(lost.filter((entry) => entry.fate === 'absent-from-head').length),
          undetermined_count: String(lost.filter((entry) => entry.fate === 'unknown').length),
        }),
      },
    );
  }

  const detail =
    uncheckable > 0
      ? `${checked} squash-shaped branch(es) checked, every declared Record-Id is reachable from HEAD ` +
        `(${uncheckable} branch(es) recorded nothing with an id and could not be checked this way)${scanLimitDetail(scan)}`
      : `${checked} squash-shaped branch(es) checked, every declared Record-Id is reachable from HEAD${scanLimitDetail(scan)}`;
  return check(
    id,
    category,
    title,
    'ok',
    detail,
    null,
    false,
    undefined,
    {
      evidence: scanEvidence(scan, {
        candidates: String(candidates.length),
        checked: String(checked),
        uncheckable: String(uncheckable),
        lost_count: '0',
      }),
    },
  );
};
