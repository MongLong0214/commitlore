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

The worked example that uses the full vocabulary stays in the README, in every
language, because it is also a conformance fixture: `spec/verify.sh` compares it
byte for byte with
[`spec/fixtures/valid/11-readme-example.txt`](../spec/fixtures/valid/11-readme-example.txt)
and fails if the two drift apart. See [A complete record](../README.md).

## The vocabulary

The summary table of every trailer key also stays in the README, in every
language, and is checked against SPEC §3 by
`spec/schema/readme-vocab-check.mjs`: a key in the table that the spec does not
define is a key a user would write and the validator would reject, and a key or
`Provenance:` value grammar the table omits is a field that effectively does not
exist.

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
