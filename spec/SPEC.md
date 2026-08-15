# CommitLore Protocol Specification

**Version 2.0** · Status: **Stable** · Canonical source for all implementations

Stable means the vocabulary and grammar below do not change incompatibly within
2.x. See `docs/COMPATIBILITY.md` for what may still change and how anything is
retired.

This document defines the CommitLore protocol: how decision context is inscribed into git commits as trailers, what each field means, and which route consumes it. An implementation that passes `spec/fixtures/` and `spec/contract-cases/` is a conforming CommitLore implementation, regardless of language.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described in RFC 2119.

---

## 1. Overview

An CommitLore **record** is a set of trailers forming one record block (§2.4). A commit message or a mirrored note MAY carry more than one — most carry at most one, but a message that inherited several decisions across a squash, or that concatenates more than one commit's message, carries one block per record. A record captures what the diff cannot show: the external conditions that shaped a decision, the alternatives that were ruled out, and the warnings that the next modifier needs.

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
| B8 | Message whose **only** paragraph is a trailer block (no subject) | Zero trailers — the block is read as the subject |

> B3 is the reason implementations MUST NOT identify trailers by line-matching (`grep '^Key:'`). Prose containing a colon-prefixed line would be counted as a record, producing false context for agents.
>
> B8 follows from the grammar — `message = subject , [ blank , body ] , [ blank , trailer-block ]` puts a subject before any trailer block — but it surfaces as a surprise, so it is stated. A tool that serializes a record and feeds the block straight back through a parser gets nothing back. Round-tripping a canonical block therefore requires a subject line in front of it; `spec/schema/roundtrip.mjs` prepends one for exactly this reason.

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

### 2.4 Multi-record grammar

§2.1–2.3 describe one record block: the message's own trailer block, exactly as B1 defines it — the last paragraph, and only when every line in it is a trailer or a continuation (B3). A message MAY carry additional, **earlier** record blocks. This does not relax B1–B8 for the message's own last paragraph — that recognition is unconditional and unchanged — it only says how to recover records that arrived earlier in the same message, which the pre-2.4 grammar had no way to represent at all.

A **record block** is a contiguous run of trailer lines terminated by `Record-Id:`. Concretely: for every paragraph other than the message's own last one, test the paragraph in isolation, exactly as B1 tests a message's last paragraph (a synthetic one-line subject in front of it is sufficient). It is an additional record block if and only if both hold:

1. Every line in the paragraph is a trailer or a continuation (B3, applied to the paragraph alone).
2. The paragraph declares a `Record-Id:`.

Rule 2 is the reason this does not conflict with B2's own example (`Context:` / `Source:` — individually well-formed `Key: value` lines, declaring no identity, correctly read as body prose): a paragraph that is merely trailer-shaped is not promoted to a record. Only one that also names an identity is — the same principle that makes `Record-Id` "a stable identity for this record" (§3.2) rather than incidental payload.

Two consequences follow directly from this rule, both load-bearing:

- **A single-record message parses identically under §2.4 as under §2.1–2.3 alone.** With zero or one `Record-Id` anywhere in the message, there is nothing for rule 2 to promote — the message's own last paragraph is the only block, exactly as before. Backward compatibility is a property of the grammar, not a compatibility shim bolted onto it.
- **A record MAY still omit `Record-Id:` (§4).** Only a *non-final* block needs one to be told apart from body prose; the message's own last paragraph needs none, the same as always.

Implementations parsing record blocks MUST NOT identify a non-final block by scanning for `Record-Id:` as a line pattern across the whole message — that repeats B3's mistake at a larger grain. The isolation test above still delegates every trailer-or-prose judgement to git (or an equivalent parser), paragraph by paragraph; only the decision of *which paragraphs to test in isolation*, and *whether to accept the result*, is added.

`Follows:` and `Supersedes:` resolve against `Record-Id`s regardless of which block declared them (§3.2); the grammar does not scope identity resolution to one block or one message.

---

## 3. Vocabulary

Sixteen keys. Every key exists because a route consumes it — see §5.

### 3.1 Decision context

| Key | Value grammar | Repeatable | Meaning |
|---|---|---|---|
| `Limit:` | free text | yes | An external condition that constrained the decision and may still be active |
| `Ruled-out:` | `alternative \| reason` — the `\|` separator is REQUIRED, and the **first** one separates | yes | An alternative that was evaluated and dropped, with why |
| `Warn:` | free text (folding allowed) | yes | An instruction for whoever modifies this next |
| `Blast:` | `local` \| `module` \| `system` | no | How far the change reaches |
| `Undo:` | `easy` \| `costly` \| `permanent` | no | What reverting this costs |
| `Certainty:` | `firm` \| `tentative` \| `guess` | no | How sure the author is |
| `Verified:` | free text | yes | What was checked, and how |
| `Unverified:` | free text | yes | A known gap in verification |

#### The `Ruled-out:` separator

The **first** `|` separates, and there is **no escape**: a backslash in front of one is two literal characters, not an escape sequence. An alternative therefore MUST NOT contain a `|`; a reason MAY, because everything after the first separator is the reason.

Splitting from the front rather than the back is not arbitrary. Both ends lose something, and which end loses less is a question about real records rather than about taste. In this specification's own repository, of 620 distinct `Ruled-out:` values three carry more than one `|` — and two of those three carry it in the *reason*: `||` quoted from shell prose, `.mjs|.js` quoted from a filename alternation. Splitting on the last `|` would destroy those two to rescue the third.

That leaves the third: an author who wrote a pipe into the alternative and got a fragment. Two rules keep that from failing silently, which is the outcome this vocabulary exists to prevent.

- A value whose alternative half opens a code span the separator closes outside of — an odd number of `` ` `` before the first `|` — is a `format` violation (§6). This is not an inference about intent: the span crosses the separator, so the separator was taken out of quoted text and the alternative is a fragment ending mid-span.
- A value carrying more than one `|` MUST be reported by `commitlore validate` and by the consumer routes of §5, naming the alternative the split produced. It is **not** a violation: the extra `|` is usually in the reason, where it is well formed, and rejecting the class would refuse correct records in order to catch incorrect ones. Only the author knows which split was meant, so the report reaches the author while the record can still be changed.

### 3.2 Identity, lifecycle, provenance

| Key | Value grammar | Repeatable | Meaning |
|---|---|---|---|
| `Record-Id:` | `r-[a-z0-9]{6,}` | no | Stable identity for this record |
| `Follows:` | `Record-Id` | yes | The prior record in a decision chain |
| `Supersedes:` | `Record-Id` | yes | Retires an earlier record |
| `Expires:` | `YYYY-MM-DD` \| free-text condition | no | When this record stops being active |
| `Evidence:` | `path` \| `path#anchor` \| URL | yes | Link from a claim to its proof |
| `Provenance:` | `authored` \| `drafted` \| `inherited <sha>` \| `reconstructed` \| `unknown` | no | How this record came to exist |
| `CommitLore-Version:` | semver | no | Protocol version this record targets |
| `X-<Name>:` | free text | yes | Organization extension — preserved, never interpreted by the core |

### 3.3 Enum rationale

Enum values name **what to do**, not an abstract grade. `Undo: permanent` tells an approval gate to stop; `Undo: level-3` would need a lookup every time. Any value outside the listed set is a violation (§6), including plausible synonyms — `Blast: wide`, `Undo: clean`, and `Certainty: high` MUST be rejected.

`Record-Id` is a random-looking identifier, not a hash of anything: it must stay stable when the commit is rebased, amended, or squashed, which a content hash would not. `Follows:` and `Supersedes:` therefore reference `Record-Id`, never a commit SHA.

A `Record-Id` MUST resolve to exactly one logical record. Re-declaring that
record in later commits is a lifecycle update, and an exact notes mirror is a
second transport channel for the same record. A note MUST NOT add or replace
content under an id declared by a commit message; that is an identity collision,
not an update, and consumer routes MUST withhold the colliding payload.

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

### 6.1 Check classes

Checks are classified by the information required to answer them, not by
strictness:

| Class | Question | Needs | Can run at |
|---|---|---|---|
| **Shape** | Is this trailer well-formed? | The message alone | Anywhere, including stdin |
| **Reference** | Does this id resolve, and to exactly one record? | The repository | `--commit <sha>`, a repository-backed commit-msg hook, CI |
| **Conservation** | Did records survive this transformation? | A before state and an after state | CI / pre-merge only |

Every check MUST declare its class. A check that cannot state its information
requirement has not been designed. A class that cannot run MUST be reported as
not checked; it MUST NOT be presented as passing. That report does not by itself
change exit status.

Reference checks resolve `Follows:` and `Supersedes:` only against earlier
history. A later declaration cannot repair a reference that was invalid when
written. `validate` has no before state and therefore does not perform
conservation checks.

### 6.2 Violations

`commitlore validate` MUST report violations as structured records — `{key, value, rule, got, want}` — not prose, because the repair loop consumes them programmatically.

Violation classes:

| Rule | Example of a violation |
|---|---|
| `unknown-key` | `Constraint: x` (not in §3, not `X-`-prefixed) |
| `enum` | `Blast: wide`, `Undo: clean`, `Certainty: high` |
| `format` | `Ruled-out: no pipe here`, ``Ruled-out: shelling out to `grep \| head` \| it hides the exit status`` (the alternative's code span does not close before the separator — §3.1), `Record-Id: nope`, `Expires: 2026-13-45` |
| `cardinality` | Two `Blast:` lines in one record |
| `dangling-ref` | `Supersedes: r-abc123` where no such record exists in history |
| `duplicate-id` | A note adds different content under a `Record-Id` already declared by a commit |

A validation failure MUST exit non-zero. Implementations MUST NOT silently repair input.

---

## 7. Trust grading

Records are graded on two axes, and the grade decides how `Warn:` is delivered:

- **provenance** — `authored` | `drafted` | `inherited` | `reconstructed` | `unknown`
- **lifecycle** — `active` | `superseded` | `expired`

`Warn:` renders as an **instruction** only when provenance is `authored`, the record is active, and the commit's author string matches a string this repository configured for directives. Otherwise it renders as a **claim** — surfaced as information, never as a directive. In the default mode this is an unauthenticated, forgeable string match: the commit author chooses the string, so anyone able to write a commit can choose a configured one. A record from a contributor whose chosen string does not match renders as a claim; the match itself does not prove who wrote it.

`commitlore.requireSignedDirective=true` adds an opt-in authenticated boundary: an otherwise eligible directive additionally needs Git's `G` signature status — meaning Git verified it against the verifier's own trust store — **and** the exact signing-key fingerprint Git reports as `%GF` must appear in the repository-local `commitlore.trustedSigner` allowlist. Every other signature status — untrusted, bad, absent, expired, revoked or unable to check — is unverified and renders as a claim, as does any fingerprint the allowlist does not list. An absent, empty, or unreadable allowlist authorizes nobody, so every record renders as a claim; it never means every valid signer is authorized. A verified signature establishes that a key this verifier accepts signed the commit; the allowlist is what supplies authority for this repository, and neither establishes the truth or safety of the record's content.

This is a minimum, not a solution: the default makes a repository's policy auditable rather than silently assumed, while signature mode uses Git's existing verifier trust store and a repository-local allowlist without inventing key distribution.

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
5. Follows the exit code contract of §10 in every command it exposes.

The suite is the contract. This prose is explanation.

---

## 10. Process contract

An implementation is invoked as a process, and its exit code is part of the
protocol — not a detail one command is free to pick for itself. A caller that
scripts against `commitlore` (a hook, a CI job, another tool shelling out)
branches on the number, and it must mean the same thing regardless of which
command produced it. Every command MUST draw from these four codes, and MUST
NOT give a code a meaning another command does not also give it:

| Code | Meaning |
|---|---|
| `0` | Ran, nothing to report |
| `1` | Ran, found what the caller asked about — a violation, a match, a block |
| `2` | Could not run — a usage error, an unresolvable reference, a missing dependency, a missing input file, or no repository |
| `3` | Ran and answered, but could not see everything — an unfetched notes mirror, shallow history |

A command need not use every code. `stale`, `inject`, and the query routes
(`context`, `limits`, `ruled-out`, `warnings`) hand every finding back through
their structured output and exit `0` regardless of what they found, on
purpose: a route consumed by an agent must not turn "here is what I found"
into a failed tool call (§4). That is a command choosing not to speak through
its exit code, and it is documented at each command that makes the choice. It
is not license to reuse a code: `1` MUST NOT mean anything but a finding, and
`2` MUST NOT mean anything a finding could also mean, in any command that does
use them.

Every command MUST document its exit codes in `--help`.
