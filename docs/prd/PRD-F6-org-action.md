# PRD F6 — Minimum org layer (GitHub Action: PR lint + squash inheritance)

- Milestone: M4 (08-23) · ADR: 0003, 0004

## Goal
Run the team-level quality loop in the user's own free CI. 0 servers, DBs, or charges (self-hosting principle).

## Non-goals
Organization decision graph/dashboard (Backlog), approval-gate automation (Backlog — v0.1 stops at the lint report).

## User stories
- As a reviewer, the PR automatically receives a comment with "active constraints for files this PR touches + trailer lint results."
- On squash-merge, the Action automatically inherits trailers, so no knowledge is lost.

## Requirements
1. Action 1: publish `commitlore validate` + a summary of active constraints for target paths as a PR comment (user's GITHUB_TOKEN, no external transmission).
2. Action 2: on the merge event, run `commitlore squash-preserve` + push notes.
3. Distribution: provide this repository's `action.yml` as a reusable workflow, with 3 README installation lines.

## AC
- [ ] Record (log) 1 successful E2E run in a demo repository: create PR→publish comment→squash merge→query PR target branch
- [ ] Verify 0 external network calls (except GitHub API)
