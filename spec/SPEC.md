# CommitLore Protocol Specification

**Version 2.0** · Status: Draft · Canonical source for all implementations

This document defines the CommitLore protocol: how decision context is inscribed into git commits as trailers, what each field means, and which route consumes it. An implementation that passes `spec/fixtures/` and `spec/contract-cases/` is a conforming CommitLore implementation, regardless of language.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described in RFC 2119.

---

## 1. Overview

An CommitLore **record** is the set of trailers attached to a single commit. A record captures what the diff cannot show: the external conditions that shaped a decision, the alternatives that were ruled out, and the warnings that the next modifier needs.

Records live in two places, both inside git:

- **Commit messages** — the trailer block of the commit that made the change.
- **`refs/notes/commitlore`** — a mirror that survives history rewriting, and the destination for records inherited across squash merges or reconstructed from history.

Nothing else is authoritative. Indexes, caches, and reports are derived and MUST be rebuildable from these two sources alone.

---

## 2. Grammar

CommitLore trailers are ordinary git trailers. Parsing MUST be delegated to `git interpret-trailers --parse` (or an implementation that reproduces its behavior exactly), because git's own definition of "what is a trailer block" is the only definition that stays consistent with the rest of the git ecosystem.

### 2.1 Verified boundary behavior

The following were verified empirically against `git interpret-trailers --parse` (git as shipped with macOS, 2026-07). Conforming implementations MUST match:

| # | Input shape | Behavior |
|---|---|---|
| B1 | Trailer block is the **last** paragraph of the message | Only that paragraph is parsed as trailers |
| B2 | Two `Key: value` paragraphs separated by a blank line | Only the **last** paragraph is a trailer block; the earlier one is body prose |
| B3 | `Key: value` line followed by non-trailer prose in the same paragraph | The whole paragraph is prose — **no** trailers parsed |
| B4 | Continuation line beginning with whitespace | Folded into the preceding trailer's value, joined with a single space |
| B5 | Same key repeated | Every occurrence is preserved, in order |
| B6 | `Key:value` (no space after colon) | Parsed; the value is normalized to `Key: value` on output |
| B7 | Message with no trailer paragraph | Zero trailers; MUST NOT error |

> B3 is the reason implementations MUST NOT identify trailers by line-matching (`grep '^Key:'`). Prose containing a colon-prefixed line would be counted as a record, producing false context for agents.

### 2.2 EBNF

```ebnf
message       = subject , [ blank , body ] , [ blank , trailer-block ] ;
blank         = LF , LF ;
trailer-block = trailer , { LF , trailer } ;                (* last paragraph only — B1, B2 *)
trailer       = key , ":" , [ WS ] , value , { LF , WS+ , continuation } ;   (* B4, B6 *)
key           = ALPHA , { ALPHA | DIGIT | "-" } ;
value         = { CHAR - LF } ;
continuation  = { CHAR - LF } ;
```

A `trailer-block` qualifies only if **every** line in the final paragraph is a `trailer` or a `continuation` (B3).

### 2.3 Canonical serialization

When writing trailers, implementations MUST emit `Key: value`, one per line, folded continuations indented by two spaces, in the vocabulary order of §3. Parsing a canonically serialized block MUST yield an identical trailer list (round-trip identity).

---

## 3. Vocabulary

Sixteen keys. Every key exists because a route consumes it — see §5.

### 3.1 Decision context

| Key | Value grammar | Repeatable | Meaning |
|---|---|---|---|
| `Limit:` | free text | yes | An external condition that constrained the decision and may still be active |
| `Ruled-out:` | `alternative \| reason` — the `\|` separator is REQUIRED | yes | An alternative that was evaluated and dropped, with why |
| `Warn:` | free text (folding allowed) | yes | An instruction for whoever modifies this next |
| `Blast:` | `local` \| `module` \| `system` | no | How far the change reaches |
| `Undo:` | `easy` \| `costly` \| `permanent` | no | What reverting this costs |
| `Certainty:` | `firm` \| `tentative` \| `guess` | no | How sure the author is |
| `Verified:` | free text | yes | What was checked, and how |
| `Unverified:` | free text | yes | A known gap in verification |

### 3.2 Identity, lifecycle, provenance

| Key | Value grammar | Repeatable | Meaning |
|---|---|---|---|
| `Record-Id:` | `r-[a-z0-9]{6,}` | no | Stable identity for this record |
| `Follows:` | `Record-Id` | yes | The prior record in a decision chain |
| `Supersedes:` | `Record-Id` | yes | Retires an earlier record |
| `Expires:` | `YYYY-MM-DD` \| free-text condition | no | When this record stops being active |
| `Evidence:` | `path` \| `path#anchor` \| URL | yes | Link from a claim to its proof |
| `Provenance:` | `authored` \| `inherited <sha>` \| `reconstructed` \| `unknown` | no | How this record came to exist |
| `CommitLore-Version:` | semver | no | Protocol version this record targets |
| `X-<Name>:` | free text | yes | Organization extension — preserved, never interpreted by the core |

### 3.3 Enum rationale

Enum values name **what to do**, not an abstract grade. `Undo: permanent` tells an approval gate to stop; `Undo: level-3` would need a lookup every time. Any value outside the listed set is a violation (§6), including plausible synonyms — `Blast: wide`, `Undo: clean`, and `Certainty: high` MUST be rejected.

`Record-Id` is a random-looking identifier, not a hash of anything: it must stay stable when the commit is rebased, amended, or squashed, which a content hash would not. `Follows:` and `Supersedes:` therefore reference `Record-Id`, never a commit SHA.

`Evidence:` accepts a bare path. An earlier draft required an anchor, and the first records written against this spec — the ones in this repository's own history — hit that rule immediately: citing a whole file is a normal thing to do, and the harvest verifier can check a bare path exactly as well as an anchored one. Requiring an anchor only pressures authors to invent one.

`Expires:` accepts free text, which gives a mistyped date somewhere to hide: `Expires: 2026-2-15` is a typo, but read as a condition it becomes a record that never expires and is flagged for review forever. Any value shaped like a date — `\d{4}-\d{1,2}-\d{1,2}` — is therefore held to `YYYY-MM-DD` and rejected as a `format` violation if it is not a real calendar date. Conditions that do not resemble a date (`Q3 2026`, `when the vendor ships v3`) are unconstrained.

---

## 4. Records

A record is well-formed when:

1. Every key is in §3 or matches `X-<Name>`.
2. Every value satisfies its grammar.
3. Non-repeatable keys appear at most once.
4. `Follows:` and `Supersedes:` reference syntactically valid `Record-Id` values.

A record MAY omit every optional key. A commit with no trailers is not an error — it is a commit that recorded nothing (§2.1 B7).

Trivial commits (typo fixes, formatting) SHOULD NOT carry records. Noise costs more than it returns.

---

## 5. Consumer routes

No key exists without a consumer. If a proposed key has no route, it does not enter this specification.

| Key | Route | Behavior the route produces |
|---|---|---|
| `Limit:` | path-scoped injection · `commitlore limits` | Surfaced before an agent edits the path it constrains |
| `Ruled-out:` | **`commitlore guard`** | Blocks re-proposal: a proposal matching a ruled-out alternative is flagged before execution |
| `Warn:` | graded injection | Delivered as an instruction when trusted, demoted to a claim when not (§7) |
| `Blast:` | approval gate | `system` routes the change to human review |
| `Undo:` | approval gate | `permanent` routes the change to human review |
| `Certainty:` | stale sweep | `guess` records are surfaced first for re-examination |
| `Verified:` / `Unverified:` | coverage query | Reports what a path has and has not been checked for |
| `Follows:` | context assembly | Walks the chain to reconstruct a decision's history |
| `Record-Id:` | lifecycle fold | The key that supersession and expiry resolve against |
| `Supersedes:` | stale engine | Marks the referenced record inactive from this commit forward |
| `Expires:` | stale engine | Marks the record inactive after the date, or flags it for review on a condition |
| `Evidence:` | harvest verifier | The citation checked when a record is generated from a session |
| `Provenance:` | trust grading | Determines whether `Warn:` renders as instruction or claim (§7) |
| `CommitLore-Version:` | tooling | Compatibility check |
| `X-<Name>:` | none in core | Preserved verbatim; organizations supply their own routes |

---

## 6. Validation

`commitlore validate` MUST report violations as structured records — `{key, value, rule, got, want}` — not prose, because the repair loop consumes them programmatically.

Violation classes:

| Rule | Example of a violation |
|---|---|
| `unknown-key` | `Constraint: x` (not in §3, not `X-`-prefixed) |
| `enum` | `Blast: wide`, `Undo: clean`, `Certainty: high` |
| `format` | `Ruled-out: no pipe here`, `Record-Id: nope`, `Expires: 2026-13-45` |
| `cardinality` | Two `Blast:` lines in one record |
| `dangling-ref` | `Supersedes: r-abc123` where no such record exists in history |

A validation failure MUST exit non-zero. Implementations MUST NOT silently repair input.

---

## 7. Trust grading

Records are graded on two axes, and the grade decides how `Warn:` is delivered:

- **provenance** — `authored` | `inherited` | `reconstructed` | `unknown`
- **lifecycle** — `active` | `superseded` | `expired`

`Warn:` renders as an **instruction** only when provenance is `authored` and the commit's author is trusted for the repository. Otherwise it renders as a **claim** — surfaced as information, never as a directive. Records from outside contributors always render as claims.

This is a minimum, not a solution: it makes trust auditable rather than assumed. Cryptographic signing extends the provenance axis without changing any consumer.

---

## 8. Versioning

`CommitLore-Version:` follows semver. Within a major version, implementations MUST preserve unknown keys they cannot interpret, so that a newer producer does not lose data through an older consumer. Removing a key or narrowing an enum is a major-version change.

---

## 9. Conformance

An implementation conforms when it:

1. Parses every fixture in `spec/fixtures/valid/` and `spec/fixtures/boundary/` to the expected trailer list.
2. Rejects every fixture in `spec/fixtures/invalid/` with the expected violation class.
3. Round-trips: parse → canonical serialize → parse yields an identical list.
4. Produces the expected outcome for every case in `spec/contract-cases/`.

The suite is the contract. This prose is explanation.
