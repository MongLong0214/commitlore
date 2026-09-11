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

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { execGit } from '../../../core/git.js';
import { check, type DoctorCheck, type DoctorContext } from '../model.js';

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
const workflowReferencesAction = (
  root: string,
): { found: boolean; scanned: number; wired: boolean } => {
  const dir = join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) return { found: false, scanned: 0, wired: false };
  let scanned = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return { found: false, scanned: 0, wired: false };
  }
  for (const entry of entries) {
    if (!/\.ya?ml$/i.test(entry)) continue;
    scanned += 1;
    let text: string;
    try {
      text = readFileSync(join(dir, entry), 'utf8');
    } catch {
      continue;
    }
    if (REFERENCES_ACTION.test(text)) {
      /*
       * #926: referencing the action is not running it. `action/preserve` declares
       * `cli-path` as required -- this package is private, so there is no npm name
       * to fall back to and an `npx` fallback would run whoever registers it -- and
       * the action exits on an empty value. The README recipe shipped in 1.2.13
       * omitted the input, so following it produced a job that always failed while
       * flipping this row to satisfied: the warning disappeared and records kept
       * being dropped at every squash, which is the failure this row exists to
       * report. A check that reads the name and not the requirement is the
       * enforcement site drifting from the named site.
       */
      return { found: true, scanned, wired: /(?:^|\n)\s*cli-path\s*:/.test(text) };
    }
  }
  return { found: false, scanned, wired: false };
};

const githubRemote = (cwd: string): string | null => {
  const result = execGit(['remote', '-v'], { cwd });
  if (result.code !== 0) return null;
  for (const line of result.stdout.split('\n')) {
    if (/github\.com/i.test(line)) return line.split(/\s+/)[1] ?? 'origin';
  }
  return null;
};

/** `owner/repo` out of either URL form, or null if neither matches. */
const githubSlug = (remote: string): string | null => {
  const match =
    /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(remote) ?? null;
  if (match === null) return null;
  const [, owner, repo] = match;
  return owner === undefined || repo === undefined ? null : `${owner}/${repo}`;
};

/**
 * Whether the squash button is enabled on the remote: `true`, `false`, or `null`
 * when it could not be asked (#925).
 *
 * Asked because the previous version of this row could not be cleared by fixing
 * the problem. A reporter turned the button off — the cheaper remedy, and the one
 * the README names — and the row went on prescribing a `pull_request_target`
 * workflow, which runs with a writable token against a fork's pull request. That
 * is recommending a risk in exchange for nothing, and it teaches an operator to
 * ignore the row.
 *
 * The Ruled-out on r-squashdiscovery915 said this check "cannot read the remote's
 * merge setting". That was wrong: `gh` reads it in one call. `doctor` talks to the
 * remote already, though through `git ls-remote` rather than the API (ADR-0037),
 * so this is a new and deliberately optional dependency — an absent or
 * unauthenticated `gh` yields `null` and the row says the setting is unknown
 * instead of asserting exposure it did not verify.
 */
const squashButtonEnabled = (cwd: string, slug: string): boolean | null => {
  const probe = spawnSync(
    'gh',
    ['api', `repos/${slug}`, '--jq', '.allow_squash_merge'],
    { shell: false, encoding: 'utf8', cwd },
  );
  if (probe.error !== undefined || probe.status !== 0) return null;
  const answer = (probe.stdout ?? '').trim();
  if (answer === 'true') return true;
  if (answer === 'false') return false;
  return null;
};

export const checkSquashInheritance = (ctx: DoctorContext): DoctorCheck => {
  const id = 'squash-inheritance';
  const title = 'squash inheritance';
  const cwd = ctx.opts.cwd ?? process.cwd();

  const remote = githubRemote(cwd);
  if (remote === null) {
    return check(
      id,
      'history',
      title,
      'ok',
      'no GitHub remote — the server-side squash path this protects against does not apply. ' +
        'A local `git merge --squash` is carried by the installed prepare-commit-msg hook either way',
      null,
      false,
      undefined,
      { evidence: { github_remote: 'none' } },
    );
  }

  const { found, scanned, wired } = workflowReferencesAction(cwd);
  const wiredEvidence = {
    github_remote: remote,
    workflows_scanned: String(scanned),
    references_action: String(found),
    cli_path_supplied: String(wired),
  };
  if (found && wired) {
    return check(
      id,
      'history',
      title,
      'ok',
      'a workflow runs the squash inheritance action and supplies the cli-path it requires, so a ' +
        'record squashed by the GitHub merge button is carried onto the commit that squashed it',
      null,
      false,
      undefined,
      { evidence: wiredEvidence },
    );
  }
  if (found) {
    return check(
      id,
      'history',
      title,
      'warn',
      'a workflow references the squash inheritance action but supplies no `cli-path`, which the ' +
        'action declares required — it exits immediately on an empty value, so the job fails at ' +
        'every squash merge and the records are dropped exactly as if no workflow existed. The ' +
        'recipe published in 1.2.13 omitted this input, and a workflow that merely names the ' +
        'action was enough to satisfy this row, so following that recipe removed the warning ' +
        'without adding the protection',
      'add `with: cli-path: <path to a checked-out dist/cli.js>` to the step — see README ' +
        '"Squash-merge repositories" for the checkout step that provides it',
      false,
      undefined,
      { evidence: wiredEvidence },
    );
  }

  const slug = githubSlug(remote);
  const squash = slug === null ? null : squashButtonEnabled(cwd, slug);
  const shared = {
    github_remote: remote,
    workflows_scanned: String(scanned),
    references_action: 'false',
    squash_button: squash === null ? 'unknown' : String(squash),
  };

  if (squash === false) {
    return check(
      id,
      'history',
      title,
      'ok',
      'no workflow runs the squash inheritance action, and none is needed: the squash button is ' +
        'disabled on this repository, so the merge that drops a branch’s trailers cannot be ' +
        'performed. Turning it back on brings this row back',
      null,
      false,
      undefined,
      { evidence: shared },
    );
  }

  // The cheaper remedy is named first, and named at all, because the workflow one
  // asks for `pull_request_target` with a writable token against a fork's pull
  // request. Recommending that to a repository that does not squash is
  // recommending a risk for nothing (#925).
  const remedy =
    `either disable the squash button on this repository (nothing to install, and records survive ` +
    `a merge commit or a rebase on their own), or ${SETUP}`;

  return check(
    id,
    'history',
    title,
    'warn',
    'no workflow runs the squash inheritance action. A squash merge drops the branch commits’ ' +
      'trailers, and GitHub performs that merge on its servers where no local hook runs — so if ' +
      'this repository is merged with the squash button, the next record made on a branch is lost ' +
      'silently and the author sees a green merge. `squash-conservation` reports that afterwards, ' +
      'once the record is already gone. A local `git merge --squash` is unaffected: the installed ' +
      'prepare-commit-msg hook carries those records itself. Nothing is broken here — this is ' +
      'protection that is not switched on' +
      (squash === true
        ? '. The squash button is enabled, so the loss is reachable today'
        : '. Whether the squash button is even enabled could not be read — `gh` is not available ' +
          'or not authenticated — so this may already be moot'),
    remedy,
    false,
    undefined,
    { evidence: shared },
  );
};
