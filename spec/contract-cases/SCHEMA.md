# Contract case schema

`spec/contract-cases/*.yaml` are executable contracts: `{given, when, expect}` triples that any
conforming CommitLore implementation MUST reproduce. This document defines the file and case shape so
a consumer (T-205 stale engine, T-501 trust grading, or any future route implementation) can write
a loader from this document alone, without reading the YAML by hand.

Field values not covered here (trailer key/value grammar, `Record-Id` format, etc.) are governed by
`spec/SPEC.md` §3 and §6 — this document only adds the fields needed to describe a *test scenario*,
which SPEC.md does not need to define.

---

## 1. File shape

One file = one route. All cases in a file share that route.

```yaml
route: stale-engine        # required — see §2
cases:                     # required — array, 1+ entries
  - id: ...
    description: ...
    given: [...]
    when: {...}
    expect: {...}
```

A single-case array (`cases:` with one entry) is valid and expected for narrowly-scoped files.

**Filename convention**: the prefix groups files by route family and is load-bearing — T-205 loads
`spec/contract-cases/stale-*.yaml` by glob.

| Prefix | Route(s) |
|---|---|
| `stale-*.yaml` | `stale-engine` |
| `grade-*.yaml` | `trust-grade` |
| `route-*.yaml` | `approval-gate`, `injection` |

---

## 2. `route` (top-level)

One of:

| Value | SPEC route (§5) | What it evaluates |
|---|---|---|
| `stale-engine` | `Supersedes:` / `Expires:` / `Record-Id:` lifecycle fold | Given a record stream and an evaluation instant, what is each record's `lifecycle`? |
| `trust-grade` | `Provenance:` trust grading (§7) | Given a record and configured author strings, does `Warn:` render as `instruction` or `claim`? |
| `approval-gate` | `Blast:` / `Undo:` approval routing | Given a record's `Blast:`/`Undo:` values, is human approval required? |
| `injection` | `Warn:` graded injection (§7) | End-to-end: what grade does the injection route actually deliver for a record? |

`trust-grade` and `injection` both answer "instruction or claim", but from different ends of the
pipeline: `trust-grade` cases isolate the grading rule itself (provenance, configured author-string policy);
`injection` cases assert the delivered outcome including invariants that must hold regardless of
grading nuance (e.g. `reconstructed` provenance always ships as `claim`, full stop).

---

## 3. Case object

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string, kebab-case | yes | Unique within the whole `contract-cases/` directory |
| `description` | string | yes | Human-readable, one sentence. Not machine-consumed |
| `given` | array of [commit](#4-given-entry) | yes | Ordered oldest → newest (see `committed_at`) |
| `when` | object | yes | See [§5](#5-when) — shape depends on `route` |
| `expect` | object | yes | See [§6](#6-expect) — shape depends on `route` |

---

## 4. `given[]` entry

One synthetic commit.

| Field | Type | Required | Notes |
|---|---|---|---|
| `sha` | string | yes | Arbitrary, unique within the case only (not a real git SHA) |
| `committed_at` | ISO 8601 UTC (`YYYY-MM-DDTHH:MM:SSZ`) | yes | Fixed, absolute. Never relative to "today" — cases must not depend on evaluation date |
| `author` | string | only for `trust-grade` / `injection` cases | The trailer's commit **author** string (SPEC §7 grades the configured string match on author, never committer) |
| `committer` | string | optional | The commit **committer** identity, when it differs from `author`. Present only in cases that specifically test author-vs-committer confusion |
| `trailers` | array of `{key, value}` | yes | Must satisfy the value grammar in SPEC §3, unless the case intentionally exercises a violation — that MUST be called out in `description` |

`given` order matters: it is the chronological input to the fold. Consumers MUST sort by
`committed_at` if they don't already trust file order, since `committed_at` — not array position —
is the source of truth.

---

## 5. `when`

| Field | Type | Required | Applies to |
|---|---|---|---|
| `route` | string | yes | All — MUST equal the file's top-level `route` |
| `at` | ISO 8601 UTC | only for `stale-engine` | The evaluation instant the fold runs against (compared to `Expires:` dates) |
| `trusted_authors` | array of string | only for `trust-grade` / `injection` | The configured directive author strings for this scenario. Matched against `given[].author` — **never** `given[].committer`; this is not identity authentication |

---

## 6. `expect`

Shape depends on `route`. Contains only machine-comparable values — no prose.

### `stale-engine`

```yaml
expect:
  records:
    - record_id: r-a1b2c3
      lifecycle: active | superseded | expired
      review: true               # optional, omitted (== false) unless the record is flagged for review
      resolved_trailers:         # optional — only present when a case tests same-Record-Id folding across
        - {key: Certainty, value: firm}   # multiple commits. The values the fold resolves to, latest-commit-wins.
```

### `trust-grade` / `injection`

```yaml
expect:
  records:
    - record_id: r-a1b2c3
      warn_grade: instruction | claim
```

### `approval-gate`

```yaml
expect:
  approval_required: true | false
  triggered_by:                  # required when approval_required: true, [] when false
    - "Blast:system"             # "<Key>:<value>" for every trailer that independently justified the gate
```

`Blast: system` and `Undo: permanent` are **independent** triggers (SPEC §5 lists them as two
separate rules, not a conjunction) — `triggered_by` MUST list every trailer that would have
justified the gate on its own, not just one.

---

## 7. Conventions

- `lifecycle` values match `src/core/types.ts` `Lifecycle` exactly: `active`, `superseded`, `expired`.
- `warn_grade` values: `instruction`, `claim` — matches SPEC §7 prose exactly.
- Timestamps are always UTC (`Z` suffix), always explicit — no bare dates in `committed_at`/`at`.
- `Record-Id` values in fixtures must match `^r-[a-z0-9]{6,}$` (SPEC §3.2 / `src/core/types.ts` `RECORD_ID_RE`).
- A case that intentionally feeds a spec-violating value (e.g. to assert a route ignores/rejects it)
  MUST say so in `description` — silent violations are indistinguishable from authoring mistakes.
