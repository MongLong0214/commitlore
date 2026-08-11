# CLI reference

`commitlore --help` is authoritative and always current; this page is the map.
Every command prints its own exit codes under `--help`, following SPEC §10: `0`
ran, `2` a usage error, and where a command can tell the difference, `3` for an
unfetched notes mirror.

Installing the CLI is in [install.md](install.md). Without the wrapper on
`PATH`, every command below also works as
`node <checkout>/dist/commitlore.mjs <command>`.

## Reading decisions

| Command | What it answers |
|---|---|
| `commitlore context [paths...]` | every active record for a path: limits, ruled-out alternatives and warnings |
| `commitlore limits [paths...]` | the active `Limit:` records for a path |
| `commitlore ruled-out [paths...]` | the active `Ruled-out:` records for a path |
| `commitlore warnings [paths...]` | the active `Warn:` records for a path |
| `commitlore stale` | records that are superseded, expired, or flagged for review |
| `commitlore guard [paths...]` | *experimental advisory* — flags a proposal that may revive a ruled-out alternative |

`context`, `limits`, `ruled-out` and `warnings` take the same flags: `--json`
for structured output, `--all-history` to include superseded and expired records
(each labelled), `--at <instant>` to evaluate as of an ISO 8601 instant,
`--limit <n>`, `--no-index` to answer from Git alone, and `--trusted-author
<author>` (repeatable) to name an author whose records may render as
instructions rather than as claims. `stale` takes `--json`, `--at` and
`--all-history`, which there means scanning the whole history rather than the
most recent 1000 commits.

`guard` is a lead to inspect, not evidence that a proposal is wrong: precision
44.8%, recall 22.0%. See [evidence.md](evidence.md).

## Delivering decisions to an agent

| Command | What it does |
|---|---|
| `commitlore inject` | the deterministic, path-scoped projection an agent is given before it edits |
| `commitlore mcp` | serves CommitLore over stdio MCP: `commitlore://context/<path>` and query tools |

`inject --path <path> --budget <tokens>` produces the projection directly.
`inject --hook-input` reads a `PreToolUse` payload on stdin and answers as hook
JSON — which is exactly how the Claude Code hook calls it, and how to reproduce
that path by hand:

```bash
printf '%s\n' '{"tool_name":"Edit","tool_input":{"file_path":"install.sh"}}' \
  | node dist/commitlore.mjs inject --hook-input --budget 5000
```

`inject install-claude-hook`, `inject uninstall-claude-hook` and
`inject claude-hook-status` manage that hook in a Claude Code `settings.json`,
leaving every other setting untouched.

## Writing decisions

| Command | What it does |
|---|---|
| `commitlore harvest` | builds the harvest prompt contract, or checks a draft a session produced |
| `commitlore harvest-verify` | checks a harvested draft against the transcript and diff it claims to quote |
| `commitlore capture` | prepare → verify → stage a record from a transcript and draft, with no trailer syntax to write |
| `commitlore pending` | inspects capture transactions that have not reached a commit yet |
| `commitlore backfill` | reconstructs records for past commits that have none (all `Provenance: reconstructed`) |

The workflow these belong to is in [capture.md](capture.md); the trailer grammar
is in [protocol.md](protocol.md).

## Validating and maintaining

| Command | What it does |
|---|---|
| `commitlore init` | one-command onboarding: `hooks install`, trusted author, `index --rebuild`, claude hook install, capture policy, `doctor --fix` |
| `commitlore auto` | read and write the unattended-capture setting (`.commitlore-policy.json`): `status`, `on`, `off` |
| `commitlore doctor` | checks that this repository can carry and share records |
| `commitlore hooks` | `install`, `uninstall`, `status` for the Git hooks |
| `commitlore index` | builds or refreshes the derived record index (`.git/commitlore/index.db`) |
| `commitlore parse` | parses a commit message into its CommitLore trailers (SPEC §2) |
| `commitlore validate` | checks commit trailers against the protocol (SPEC §6) |
| `commitlore sync` | publishes and collects the notes mirror — the `pre-push` hook runs it for you |
| `commitlore squash-preserve <range>` | carries the records of a squashed branch onto the merge commit (ADR-0004) |
| `commitlore demo` | runs a self-contained lifecycle demo in a temporary repository (no network, no model) |
| `commitlore uninstall` | removes what `install.sh` or `install.ps1` wrote — see [install.md](install.md) |

`hooks install` preserves and chains any existing `commit-msg` hook.
`hooks uninstall` removes every CommitLore hook — `commit-msg`,
`prepare-commit-msg`, `post-commit`, `pre-push` — and restores any they replaced.

`prepare-commit-msg`, `post-commit` and `pre-push` are internal hook commands.
Git invokes them; you do not.

### `doctor --json` envelope

`commitlore doctor --json` emits the versioned `commitlore_doctor.v2` envelope.
Consumers should pin `schema`, then read only the fields they need: the contract
is additive within that schema. New fields may appear, but existing fields keep
their names, types, and meanings; removing or repurposing one requires a new
schema id.

The envelope contains the producing CLI `version`; aggregate `status`
(`ok`, `degraded`, or `failed`); offline-detected `installSource` (`plugin`,
`npm`, `npx`, `source`, or `unknown`); a human `headline`; ordered `fixPlan`;
and the registry-ordered `checks` rows. `summary` has `total`, one count for
each check status (`ok`, `warn`, `fail`, `skipped`), and `durationMs`, the sum
of the check durations. Those counts always add up to `total`, which equals
`checks.length`.

`status` and `exitCode` answer different questions. Any non-optional failed
check makes the status `failed` and exits 1. Otherwise any non-optional warning
or skipped check makes it `degraded`, which exits 0; only an all-`ok`
non-optional run is `ok`. `selection` is reserved for filtered reports. It is
absent (never `null`) from the current unfiltered report.

## Sharing records with a team

A record in a commit message travels with the commit. A record in
`refs/notes/commitlore` — what `backfill` writes, and what squash inheritance
carries — does not, because Git neither fetches nor pushes notes by default.

Both directions are handled after `commitlore init`, and neither needs a command:

- **Collecting.** `doctor --fix` configures the fetch refspec, so any `git fetch`
  brings the mirror with it.
- **Publishing.** The `pre-push` hook runs `commitlore sync`, so `git push`
  carries your records with the code they describe. It cannot fail your push:
  every path in it exits 0, and anything worth knowing goes to stderr.

`commitlore sync` is there for what the hook cannot cover — a repository whose
hooks were never installed, collecting without pushing (`--fetch-only`), and
seeing what would happen first (`--dry-run`).

When two clones have both written records, `sync` merges the union rather than
picking a winner, because concatenating two sets of records loses nothing.
**A merged note is graded `claim` until every identity that has written it is a
trusted author** — a note two people wrote is attributed to both, and trust takes
the floor (SPEC §7).

The fetch refspec is deliberately **not** forced. A forced one overwrites this
clone's mirror on every fetch, which destroys a record written here and not yet
pushed. The cost of unforcing is that a diverged fetch prints
`! [rejected] (non-fast-forward)` instead of silently discarding your work;
`commitlore sync` resolves it. `doctor` reports a forced refspec left over from
an older version, and `--fix` rewrites it.

## The index is derived

`.git/commitlore/index.db` is a cache. The authority is the commit trailers and
`refs/notes/commitlore`, so `commitlore index --rebuild` reconstructs it from
whatever Git holds here — and says so on stderr when `refs/notes/commitlore` was
never fetched, because then it rebuilds from one source of the two. `--no-index`
answers the same questions from Git alone — more slowly. The gap between the two
at scale is measured in [evidence.md](evidence.md).
