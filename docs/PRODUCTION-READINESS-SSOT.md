---
document_id: commitlore-production-readiness-ssot
document_version: 4.0.0
status: normative-until-superseded
evidence_release_tag: v1.0.1
canonical_repository_path: docs/PRODUCTION-READINESS-SSOT.md
supersedes:
  - docs/archive-PRODUCTION-READINESS-SSOT-v0.8.1.md
---

# Production readiness — where CommitLore actually is

Version 3 of this document was written before v1.0.0, and its whole shape was a
list of release blockers for v0.8.2. Those are gone; keeping the narrative would
mean a reader learns the state of a release two versions old from the file whose
job is to be current. It is archived beside this one rather than deleted, because
the reasoning in it is still the reasoning that produced the product.

## Status

**Maintenance.** v1.0.0 closed the scope; v1.0.1 made it arrive. No feature work
is planned, and the bar for new work is a defect a user meets.

```
protocol      2.0 Stable — spec/SPEC.md, with the retirement rule in docs/COMPATIBILITY.md
latest        v1.0.1
scope         Git-native lifecycle-aware decision delivery with verified assisted capture
excluded      deterministic autocapture, hosted service, dashboard, new protocol fields
```

## What the product claims, and what it refuses to

Every line here is enforced somewhere, not just written.

| claim | enforced by |
|---|---|
| a record written today is readable by any 2.x reader | `spec/SPEC.md` retirement rule; `test/dogfood.test.ts` |
| published figures match the preregistered analysis | `scripts/check-readme-numbers.mjs` — CI fails on drift |
| `[directive]` means what the configured trust mode allows | `SECURITY.md`; the two modes are separate claims |
| an answer says which build produced it | `runtime.version` + `runtime.build_id` in every JSON answer |
| a partial answer says it is partial | `coverage` field |
| this history gains no agent session identifiers | `test/dogfood.test.ts` baseline |

**Refused deliberately:** deterministic autocapture. No host is certified to turn
every eligible commit into a terminal assessment, and `auto status` says so in
its first line rather than three lines down.

## The release gate

`docs/RELEASE-GATE.md` is the operative document. Two sections came from
incidents rather than from planning:

- **§6b** — read the check runs at the commit the merge created. The PR's head,
  the latest run on `main`, and the resulting `main` head are three different
  commits, and only the last is what users get.
- **§6c** — install over the previous version, not fresh, and start a real host
  process. Three defects reached v1.0.0 that no suite could catch, because a
  suite starts from nothing and users do not.

## Known limits, stated

- A Windows `.cmd` launcher naming an absent interpreter reports as a timeout.
  Two faults share one signal; distinguishing them means reimplementing the
  host's command resolution (`docs/COMPATIBILITY.md`).
- An upgrade does not reach hooks already installed in a repository, nor sessions
  already running. `commitlore doctor` names both; the repair is
  `commitlore hooks install` and a restart.
- `install.ps1` still wires hosts directly as well as delegating, so Windows does
  each host twice. Tracked in #691; removing the duplicates needs a Windows
  machine with agents present, which CI cannot supply — its runners have none, so
  every host reports `notDetected` and wiring cannot be observed there at all.

## What this document is not

A roadmap. There is no next milestone. Work arrives as defects, and each is
judged by whether a user who does not know about it gets a wrong result.
