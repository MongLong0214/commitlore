# F6 tickets — Org Action (M4)

> PRD: `docs/prd/PRD-F6-org-action.md` · ADR: 0003, 0004
> Layout: `action/lint/action.yml`, `action/preserve/action.yml`, `.github/workflows/demo-*.yml`

---

## T-601 Action: PR lint + active-constraint comment (M) — #20 · depends on T-202, T-204

**Implementation outline**
- composite action: checkout (fetch-depth 0 + notes refspec) → `node dist/cli.js validate --range origin/<base>..HEAD` → `commitlore context --json` for each changed path → upsert a single comment (update by marker comment, no flooding).
- Permission: only `pull-requests: write`. 0 external network calls (except GitHub API) — verify absence of fetch/axios in code review.
- Failure policy: lint violation = check failure; constraint summary is informational.

**Test**: capture an actual run log from a PR in this repository using the demo workflow.
**AC**: PRD-F6 AC 1·2.

---

## T-602 Action: automate squash inheritance (M) — #21 · depends on T-302, T-601

**Implementation outline**
- Trigger: `pull_request: closed` + `merged == true` + detect squash merge (merge-commit parent count/commit-message pattern).
- Behavior: collect branch records with the T-302 core function → attach merge-commit notes (`Provenance: inherited`) → `git push origin refs/notes/commitlore`.
- Permission: `contents: write`.

**Test**: demo-repository E2E — create PR→lint comment→squash merge→successful query on the PR target branch with `commitlore limits`, archive log.
**AC**: PRD-F6 AC 1 (log of 1 recorded E2E run).
