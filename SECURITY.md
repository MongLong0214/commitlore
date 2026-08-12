# Security

## Reporting a vulnerability

Report privately through GitHub:
**[Report a vulnerability](https://github.com/MongLong0214/commitlore/security/advisories/new)**
(Security → Advisories → Report a vulnerability).

Please do not open a public issue for a vulnerability. Private reporting is
enabled on this repository, so the draft advisory stays between you and the
maintainer until there is a fix to ship.

Expect an acknowledgement within a week. If you have not heard back in two,
assume the notification was missed and open a public issue saying only that you
are waiting on a security report — no details.

## Supported versions

The latest published release only. CommitLore is pre-1.0 and fixes ship
forward; there are no backport branches.

## What is worth reporting

CommitLore reads git history and writes commit trailers, and agents read what it
serves. The parts where that matters:

- **Injection through served records.** Records are graded before they reach an
  agent: content matching an injection pattern is withheld and served as
  `[blocked]`. A record that reaches an agent as `[directive]` while carrying
  instructions aimed at that agent is a vulnerability. So is any path that
  restores withheld content — a field that escapes redaction, a command that
  prints the raw trailer.
- **Trust grading that overstates.** `[directive]` means a trusted author of the
  repository recorded it. Anything that lets an untrusted commit be served at
  that grade — a forged signature check, a spoofed author, an unverified
  provenance value promoted to `authored` — is a vulnerability.
- **Capture writing what it was not given.** `verify_capture` exists so that a
  record is checked against the diff it claims to describe. A route that stages
  a record without that check, or that accepts evidence the transaction never
  saw, is a vulnerability.
- **Secrets reaching a commit.** Captured content is scanned before staging. A
  credential shape that gets through the scan and into a trailer is worth
  reporting.
- **The install path.** `install.sh` and `install.ps1` write host configuration
  files and register an MCP server. Anything that makes them write outside their
  documented targets, execute a downloaded payload, or hand a host a command
  other than the CommitLore binary is a vulnerability.

## What is not

- A record you disagree with. CommitLore records what an author wrote; judging
  the content is the reader's job, which is what the trust grades are for.
- `[claim]` content being wrong. That grade means the provenance is unverified —
  it is the label for exactly this.
- The SQLite index being stale, corrupt, or deleted. It is a derived cache
  (ADR-0003); git is the source of truth and the index rebuilds.
- Anything requiring an attacker who can already write to the repository or run
  as your user. At that point they can commit directly.
