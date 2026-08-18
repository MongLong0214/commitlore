---
document_id: commitlore-production-readiness-ssot
document_version: 5.0.0
status: normative
scope: shipped-product-contract
protocol: CommitLore Protocol 2.0 Stable
operating_mode: maintenance
canonical_repository_path: docs/PRODUCTION-READINESS-SSOT.md
live_release_source: GitHub Releases
live_work_source: GitHub Issues and Pull Requests
supersedes:
  - docs/archive-PRODUCTION-READINESS-SSOT-v0.8.1.md
---

# Production readiness — the stable product contract

CommitLore is in maintenance. Its stable scope is Git-native, lifecycle-aware
decision delivery with verified assisted capture.

**The supported build is the latest published GitHub release.** Code on `main`,
an accepted ADR, a PRD, a ticket, or an open pull request is not part of the
supported product until a release publishes it.

## Why version 5 names no version

Version 4 said `latest v1.0.1` and `No feature work is planned`, and cited an
open issue as a current limitation. By the time anyone read it, all three were
false: the release had moved twice, feature work had shipped, and the issue had
closed with the defect fixed. A normative document that hardcodes a patch number
and an issue number starts lying on the next release and keeps lying until
somebody notices — and the thing readers trust it for is exactly the part that
went stale.

So this document owns the **contract**, and nothing that moves on its own. The
current release is on the releases page; the current work is in issues and pull
requests. Neither is copied here.

## Shipped scope

- Git holds the authority: commit trailers and `refs/notes/commitlore`. Index,
  reports and caches are derived and can be rebuilt from Git alone.
- Lifecycle filtering — active, superseded, expired — with stable `Record-Id`.
- Path-scoped delivery of the decisions still in force for the file being edited.
- Trust grading, with a separate signed-authority mode.
- Verified assisted capture: prepare, verify against transcript and diff, stage,
  and finalize only on a commit that succeeded.
- Supported installers for macOS, Linux, Alpine and Windows.
- `doctor`, and runtime identity in every answer.
- Partial coverage disclosed rather than presented as complete.
- CommitLore Protocol 2.0 Stable.

## Explicitly not shipped

Naming these is part of the contract, because each is something a reader could
otherwise assume from what is shipped.

- Deterministic every-commit capture. No host is certified to turn every eligible
  commit into a terminal assessment, and `auto status` says so in its first line.
- Host-independent automatic capture.
- A hosted memory or control plane.
- `guard` as a complete safety boundary. It is advisory.
- Complete answers under every budget.
- Automatic replacement of a running host session.
- Implicit discovery of repositories in order to rewrite hooks installed in them.

## What the product claims, and what enforces it

Every line is enforced somewhere, not only written.

| claim | enforced by |
|---|---|
| a record written today is readable by any 2.x reader | `spec/SPEC.md` retirement rule; `test/dogfood.test.ts` |
| published figures match the preregistered analysis | `scripts/check-readme-numbers.mjs` — CI fails on drift |
| `[directive]` means what the configured trust mode allows | `SECURITY.md`; the two modes are separate claims |
| an answer says which build produced it | `runtime.version` + `runtime.build_id` in every JSON answer |
| a partial answer says it is partial | `coverage` field |
| this history gains no agent session identifiers | `test/dogfood.test.ts` baseline |
| a released commit's bundle matches its own source | canonical artifact manifest; `exact-head-ci` at the tag |

## Authority and trust boundary

- Records in Git are untrusted input until graded.
- Default author matching is policy metadata, not authentication.
- Signed directive mode requires a Git-verified signature and a repository
  fingerprint allowlist; a missing allowlist fails closed.
- Injection-shaped payload is withheld from model-readable routes.
- CommitLore does not judge whether a record is factually true.

`SECURITY.md` owns the detail. This section is a summary and defers to it.

## Lasting limitations

These are properties of the design, not open defects. An open defect belongs in
the issue tracker, which is where a reader should look for one.

- A running host session keeps the runtime it loaded at session start. Installing
  or updating does not reach it; a new session does.
- A hook is a file written at install time. An upgrade does not rewrite hooks
  already on disk — `docs/COMPATIBILITY.md` owns the generation matrix and the
  one-time repair.
- An answer can be partial, and says so rather than presenting the part it read
  as the whole.
- Default author metadata is not authentication.
- Records live in `refs/notes/commitlore`, which an ordinary clone does not
  fetch until the refspec is configured.
- Platform support is stated as supported or undecided, never inferred. A
  platform CI does not run is not claimed to work.

## Release and maintenance policy

`docs/RELEASE-GATE.md` is operative. Two of its sections came from incidents
rather than from planning, and both are about measuring the right artifact:

- read the check runs at the commit the merge created — the pull request's head,
  the latest run on `main`, and the resulting `main` head are three different
  commits, and only the last is what users get;
- install over the previous version rather than fresh, and start a real host
  process. A suite starts from nothing; users do not.

New work arrives as a defect a user meets, a reproducible P0/P1, or a product
charter approved explicitly. It does not arrive as a roadmap item.

## Document ownership

| fact | canonical owner |
|---|---|
| current release | GitHub Releases |
| current work | GitHub Issues and Pull Requests |
| protocol semantics and vocabulary | `spec/SPEC.md` |
| protocol tutorial and worked example | `docs/protocol.md` |
| host capability and upgrade generations | `docs/COMPATIBILITY.md` |
| trust semantics | `SECURITY.md` |
| install, upgrade and uninstall | `docs/install.md` |
| measurements, methods and run identifiers | `docs/evidence.md` |
| shipped product scope | this document |

## Proposed work is not shipped work

An ADR, a PRD or a ticket records a decision or a plan. None of them makes a
feature part of the product. If a document under `docs/prd/` or `docs/tickets/`
describes something this file does not list under **Shipped scope**, this file is
correct and the reader should treat the feature as absent.
