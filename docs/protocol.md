# The record protocol

A CommitLore record is an ordinary set of Git commit trailers. Nothing else is
stored: the authority is the trailer block on the commit and
`refs/notes/commitlore`. Indexes and reports are derived from those Git records
and can be rebuilt from them.

The normative definition is [`spec/SPEC.md`](../spec/SPEC.md) — §2 for parsing
and canonical form, §3 for the vocabulary, §6 for validation. This page is the
working summary the README used to carry.

## A record can be small

Include only the context that would otherwise be lost:

```text
Fix expired-token refresh

Ruled-out: Extend token TTL to 24h | security policy violation
Warn: Do not narrow the 4xx handler without verifying upstream behavior
```

Most records do not need every protocol field. Identity, lifecycle, risk,
provenance, and verification fields are available when the decision needs them.

Most commits should carry no record at all. Add one only for a decision the diff
cannot recover: an external constraint, a rejected alternative, a warning, or a
verification gap. How a record gets written is in [capture.md](capture.md).

## A complete record

A record can be much smaller than this; most need only a few fields. This one
uses the whole vocabulary because it is also a conformance fixture: `spec/verify.sh`
compares the block below byte for byte with
[`spec/fixtures/valid/11-readme-example.txt`](../spec/fixtures/valid/11-readme-example.txt)
and fails if the two drift apart. A document that violated the spec it teaches
would be this project's most expensive defect, and it has happened —
`Certainty: high`, `Blast: narrow` and `Undo: clean` shipped here once, and all
three are values our own rejection fixtures carry.

The marker below is what the checker finds. It is deliberately not "the last
`text` block in the file": a positional rule cannot say which block it owns, so
editing anything nearby silently moves the contract.

<!-- SPEC-FIXTURE:11-readme-example -->

```text
Prevent silent session drops during long-running operations

The auth service returns inconsistent status codes on token
expiry, so the interceptor catches all 4xx responses and
triggers an inline refresh.

Limit: Auth service does not support token introspection
Record-Id: r-4b7e21
Ruled-out: Extend token TTL to 24h | security policy violation
Ruled-out: Background refresh on timer | race condition
Certainty: firm
Blast: module
Undo: easy
Warn: 4xx handling is intentionally broad
  -- do not narrow without verifying upstream behavior
Verified: Single expired token refresh (unit)
Unverified: Auth service cold-start > 500ms behavior
CommitLore-Version: 2.0.0
```

## The vocabulary

Checked against SPEC §3 by `spec/schema/protocol-doc-vocab-check.mjs`: a key in
this table that the spec does not define is a key a user would write and the
validator would reject (`Decision-Id:` actually did that), and a key the spec
defines but this table omits is a field that effectively does not exist.

| Trailer | Meaning |
|---|---|
| `Limit:` | External condition that constrained the decision |
| `Record-Id:` | Stable identity across rewritten commit hashes |
| `Ruled-out:` | `alternative \| reason` — the first `\|` separates; there is no escape, so an alternative may not contain one |
| `Certainty:` | `firm` \| `tentative` \| `guess` |
| `Blast:` | `local` \| `module` \| `system` |
| `Undo:` | `easy` \| `costly` \| `permanent` |
| `Warn:` | Warning for a future modifier; trust-graded before delivery |
| `Verified:` / `Unverified:` | What was and was not checked |
| `Follows:` / `Supersedes:` | Decision-chain and lifecycle links |
| `Expires:` | Date or condition that ends a limit |
| `Evidence:` | Path, anchor, or URL supporting a claim |
| `Provenance:` | `authored` \| `drafted` \| `inherited <sha>` \| `reconstructed` \| `unknown` |
| `CommitLore-Version:` / `X-*:` | Protocol identity and extensions |

For the normative meaning, cardinality, and value grammar of each key, read
[SPEC §3](../spec/SPEC.md).

## Reading records without CommitLore

`commitlore context <path>` is the convenient route ([cli.md](cli.md)), but the
data is plain Git and stays readable without the tool:

```bash
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

Use Git's trailer parser, not a text search: prose containing `Key:` is not
necessarily a trailer.
