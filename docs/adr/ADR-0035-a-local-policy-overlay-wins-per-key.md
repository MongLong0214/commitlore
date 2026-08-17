# ADR-0035: a local policy overlay wins per key

- Status: Accepted (2026-08-17)
- Owner: CTO
- Issue: [#709](https://github.com/MongLong0214/commitlore/issues/709)
- Supersedes: the single-location choice recorded against PRD-F13 requirement
  11 and pinned by `r-t1110policy` ("only a repository-local policy file is
  read … an ambiguous precedence is worse than a missing feature"). The rest of
  that record — the key order in `POLICY_DEFAULTS` being the hash input —
  stands.

## Context

`.commitlore-policy.json` is committed with the repository, which is right for
a policy: `commitlore auto on` authorises an agent host to prepare, verify and
stage records with nobody in the loop, and that is a decision a repository
makes for everyone who clones it (ADR-0030, #511).

PRD-F13 requirement 11 allowed either one location or a stated precedence
between locations. One location was chosen, on the grounds that an ambiguous
precedence is worse than a missing feature.

What that choice did not prevent was divergence. A contributor who needs a
different answer than the committed one has exactly one route: edit the tracked
file. Their worktree is then permanently modified, and #709 reports the
consequence — in `MongLong0214/logic-pro-mcp`, a release script that refuses to
tag a dirty tree stopped working, and the workaround was to move the file
outside the repository for the duration of the tag.

So the choice did not remove the ambiguity about which policy ran. It converted
it into a modified tracked file, which is the worse of the two.

Every tool that keeps a shared config in the tree gives the operator a layer
that wins: `.git/config` beside a distributed `.gitattributes`, a user `.npmrc`
beside the project one, `~/.ssh/config` beside a distributed one. The reason is
the same in each case — the committed file expresses what the project wants,
and the operator's machine is not the project's to command.

## Decision

A second file may sit beside the committed one:

```
.commitlore-policy.local.json     per key, wins
.commitlore-policy.json           repository default
built-in defaults
```

**Per key, not per file.** An overlay that sets only `unattended` leaves `mode`
and `max_records_per_commit` as the repository set them, so a later change to
the committed file still applies. This is what makes the overlay an expression
of "this machine differs about that" rather than a fork of the policy.

**In both directions.** An overlay may raise `unattended` as well as lower it.
`r-unattended511` records that the committed switch is the repository
consenting to unattended capture, and allowing an overlay to widen appears to
break that. It does not, because the consent that record is about is expressed
at commit time by a person on their own machine, and what keeps an unattended
record from directing is the `drafted` stamp and the claim cap in grading — not
this switch. A narrowing-only rule would also be unenforceable: the contributor
who wants more edits the tracked file, which is the problem being removed.

**Untracked by convention, and nothing writes a `.gitignore` entry.** A tool
that hides a file on a repository's behalf has decided for the repository what
it may not see.

## Conditions

The ambiguity the single-location choice was avoiding is paid for, not
inherited:

1. **The identity hash is computed over the effective policy** whenever an
   overlay is present. A pending transaction stamps `policy_identity_hash`;
   without this, a record prepared under an overlay would carry provenance
   naming a policy that did not produce it — a record misreporting the
   conditions of its own capture, which is worse than the gap being closed.
   `unattended` is an input to that digest, unlike the defaults digest of #511:
   the exclusion there rests on a file's identity being its own bytes, and an
   overlay can turn the setting on from a file whose bytes are not the digest
   input.

2. **A repository without an overlay keeps exactly the digest it had.** No
   file, or the committed file alone, hashes as it did before this ADR — so no
   capture in flight is refused by the upgrade. Adding an overlay does move the
   digest, including an empty one, and that is correct: it is a policy change,
   and a capture in flight across it is refused with "policy identity changed
   since prepare", because it was.

3. **`doctor` reports the disagreement.** The `policy-overlay` check names both
   files, the value beneath, the value in the overlay and the one in force. A
   stated precedence nobody can see is the ambiguous case in disguise. It
   reports `ok` when the two disagree — the operator wrote the overlay on
   purpose — and warns only when a file cannot be used, because then neither
   file's values are in force.

## Consequences

- `commitlore auto on|off --local` writes the overlay, creating it. Once it
  exists it is the file `commitlore auto` writes, so opting in or out never
  touches the tracked file again. Existence is the signal because creating the
  overlay is a decision: an `auto off` that silently created one would stop the
  tracked file being the answer without anyone choosing that.
- A file the resolver cannot use still falls back to the built-in defaults with
  a named reason, as before. A broken overlay does not fall back to the
  committed file: layering onto — or substituting for — a policy nobody could
  read produces an effective policy that no file states.
- `unattended: true` still requires `mode: "auto"`. Split across two files, the
  error names where each of the two values came from rather than blaming a file
  that is coherent on its own.
- PRD-F13 requirement 11 is now satisfied by its second option. The ticket's
  fallback ("if they cannot be given an unambiguous precedence, ship only one
  location") no longer applies: the precedence is stated here, asserted by
  `test/capture-policy-overlay.test.ts`, and visible in `doctor`.
