<!-- README:BRAND -->
<p align="center">
  <img src="./assets/readme/commitlore-logo.svg" width="440" alt="CommitLore">
</p>

<h1 align="center">CommitLore</h1>

<h3 align="center">Stop re-reviewing the same bad idea.</h3>

<p align="center">
  <strong>Decision authority for coding agents, owned by Git.</strong><br>
  Keep constraints, rejected alternatives, and warnings in Git — then deliver
  only what is still in force, so an agent is not handed a decision the
  repository already reversed.
</p>

<p align="center">
  <strong>No hosted memory. The repository owns the record.</strong>
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml/badge.svg">
  </a>
  <a href="https://github.com/MongLong0214/commitlore/releases">
    <img alt="Latest release" src="https://img.shields.io/github/v/release/MongLong0214/commitlore?display_name=tag">
  </a>
  <a href="spec/SPEC.md">
    <img alt="Protocol 2.0 Stable" src="https://img.shields.io/badge/protocol-2.0%20stable-3FB950">
  </a>
  <a href="package.json">
    <img alt="Node.js 22.23.2 or newer" src="https://img.shields.io/badge/node-22.23.2%2B-3FB950">
  </a>
  <a href="LICENSE">
    <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3FB950">
  </a>
</p>

<p align="center">
  <strong>English</strong> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>Install once.</strong> Then initialise each repository where you want it to work.
</p>

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.sh | sh -s v1.2.0
```

<details>
<summary>Prefer to read the installer first?</summary>

```bash
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.sh
sh install.sh v1.2.0

# Or skip the script: the checkout it makes is one you can make yourself.
git clone --depth 1 --branch v1.2.0 https://github.com/MongLong0214/commitlore
node commitlore/dist/commitlore.mjs --version
```

It installs a pinned source checkout and a wrapper that runs
`node <checkout>/dist/commitlore.mjs` — no compiled download, no build step.

</details>

<p align="center">
  <img
    src="./assets/readme/demo.gif"
    width="900"
    alt="commitlore demo prints two recorded decisions for src/pricing.ts, delivers only the active one with its limit and the alternative it ruled out, and says the superseded decision remains in Git without being delivered as current guidance."
  >
</p>

---

> **The code survives. The judgment doesn't.**

An agent proposes an approach. Your team rejects it because of a non-obvious
constraint. The final code preserves the outcome, but usually not why the
alternative was rejected. A later agent sees only the code and proposes the
same idea again.

CommitLore keeps that judgment beside the code.

## What CommitLore does

| | Behavior | Product path |
|---|---|---|
| **Captures** | Preserves constraints, rejected alternatives, and warnings that a diff cannot show. Candidates are checked against the session transcript and the staged diff. | `commitlore capture` |
| **Preserves** | Stores accepted records in Git trailers or notes instead of a hosted memory database. | commit hooks · `refs/notes/commitlore` |
| **Tracks lifecycle** | Keeps active, superseded, and expired decisions distinct. | `commitlore stale` |
| **Scopes** | Selects decisions for the path an agent is about to edit. | `commitlore context` |
| **Grades trust** | Delivers records as directives, claims, or withheld content. | default / signed mode |
| **Delivers** | Gives supported agents current context before an edit. | plugin hook · MCP |

Most commits should carry no record. CommitLore is for judgment the code cannot
preserve, not for narrating every change.

<!-- README:QUICKSTART -->
## 60 seconds to decision-aware agents

### 1. Install the CLI

macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.sh | sh -s v1.2.0
```

Windows:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.ps1))) v1.2.0
```

Requires Node.js 22.23.2+ and Git. The script checks both before it writes anything.

### 2. Connect your agent

Claude Code:

```text
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

Codex:

```bash
commitlore plugin install-codex
```

The plugin puts no `commitlore` on `PATH`, so the commands below need the CLI
install as well. The installers also detect and wire supported MCP hosts where
they can do so safely; the exact matrix is below.

### 3. Initialize a repository

```bash
cd your-repository
commitlore init
commitlore context .
```

Start a new agent session after installing or updating a plugin: a running
session keeps the runtime it loaded.

Then work and commit normally. On supported skill integrations, CommitLore is
considered during ordinary commit requests and stays silent when there is
nothing worth preserving. You do not need to name CommitLore on every commit.

Want accepted records to stage without a per-record prompt? The repository can
opt in once with `commitlore auto on`. That policy is repository-owned and
applies to the team, so it is not silently enabled by this page.

<!-- README:PAYLOAD -->
## What the agent receives

Before editing `src/pricing.ts`:

```text
commitlore: active records for src/pricing.ts

Limit
  [claim] r-price01  calculatePrice owns final checkout pricing only

Ruled-out
  [claim] r-price01  Reuse it for admin quotes |
                     eligibility and rounding semantics differ
```

`[claim]` means "weigh this as information." A repository can opt into the
stronger signed-authority mode. Delivery gives the agent context; it does not
block the edit.

[Security model →](SECURITY.md)

## Why Git?

**The repository should own the judgment behind its code.**

CommitLore stores records in ordinary Git trailers and notes, so they branch,
merge, clone, review, and survive provider changes with the code they explain.

SQLite is only a rebuildable index. Delete it and Git still holds the record.

## Finding an old decision is not enough

A general memory or retrieval system asks:

> Which old text looks related?

CommitLore asks:

> Which recorded decisions still apply to this path now?

A superseded decision can be highly relevant and still be wrong as current
guidance. Relevance and authority are different questions.

## How it works

<p align="center">
  <img src="./assets/readme/hero.svg" width="720" alt="For src/pricing.ts, the active decision in Git history moves into the context delivered before the next edit, carrying its limit and the alternative it ruled out. An earlier decision that also covered admin quotes has been superseded and stays in history without moving forward as current guidance."
  >
</p>

1. **Capture** — an agent drafts only decision context the diff cannot show.
2. **Verify** — CommitLore checks the draft against the session and staged diff.
3. **Preserve** — the accepted record lives in Git with identity and lifecycle.
4. **Deliver** — before a later edit, only active records for that path are returned.

Most commits carry no record. The commit hook validates a record when one is
present; it does not invent one.

<!-- README:CAPABILITY -->
## What happens automatically

| Host | Pre-edit delivery | Verified capture workflow | Deterministic every-commit capture |
|---|---|---|---|
| Claude Code | Automatic through the plugin | Available through the plugin skill | **Not certified** |
| Codex | Automatic through the plugin | Available through the plugin skill | **Not certified** |
| Hermes | Available after `commitlore hermes install` | Available after host install | **Not certified** |
| Gemini CLI, Cursor, Windsurf, opencode | MCP delivery where the host uses the registration | Procedure exposed over MCP | No |
| `AGENTS.md` hosts | Procedure only | Procedure only | No |

"Available" means the prepare → verify → stage workflow exists. It does not mean
every eligible commit is assessed automatically.

Users on supported skill hosts do not need to say "record this in CommitLore" on
every commit. The remaining limitation is host initiation, not a required
per-record user command.


## Unlike memory storage

| | General memory / RAG | **CommitLore** |
|---|---|---|
| Primary question | What old text is related? | Which decisions still apply here now? |
| Authority | Memory store or provider | Git |
| Scope | Semantic similarity | Repository paths |
| Lifecycle | Often append-first | Active · superseded · expired |
| Trust | Retrieved text | Directive · claim · blocked |
| Capture | Transcript or note storage | Evidence-checked decision record |
| Portability | Backend-dependent | Ordinary Git |

CommitLore is intentionally narrower. It is not a general user-memory system,
conversation archive, or vector database replacement.

<!-- README:EVIDENCE -->
## Evidence

| Question | Measured result | Boundary |
|---|---|---|
| Did claim-grade context change re-proposal in the registered study? | **2.8%** (16/580) with CommitLore vs **18.8%** (109/579) without | one model, one harness, constructed tasks |
| Did lifecycle filtering deliver retired records in the measured active projection? | **0 retired records** | superseded records were present; expiry was not |
| Does indexed lookup scale? | **496 ms p50 at 100k commits** | the no-index fallback is much slower |

Path scope is what keeps a large history from reaching the model. On the #167
corpus, only 2 of 10,002 records did:

| route | model-visible records | relevant records | model-visible tokens |
|---|---:|---:|---:|
| inject everything | 10,002 | 2/2 | 1,004,554 |
| top-k lexical | 2 | 1/2 | 190 |
| CommitLore path scope | 2 | 2/2 | 335 |

That measures exposure and recall at a fixed two-record budget — not token cost,
billed cost, accuracy, or agent behaviour. One corpus, one query, one pinned
embedding model.

The agent study does not establish a universal model effect. Delivery is not
proof that a model read or followed a record.

[Methods, full tables, exclusions, and negative results →](docs/evidence.md)

<!-- README:LIMITS -->
## Limits, trust and privacy

- **Capture is assisted, not deterministic.** Supported skills consider ordinary
  commit requests, but no host is certified to assess every eligible commit.
- **Default directive mode is not authentication.** It matches the commit
  author header, and anyone who can write a commit can set that header — so a
  `[directive]` in default mode is policy metadata, not proof of identity.
  Signature mode additionally requires Git's own verified status and a match in
  the repository-local `commitlore.trustedSigner` allowlist; an absent, empty, or unreadable signer allowlist authorizes nobody, so the mode fails closed.
- **Guard is an experimental advisory**, not a safety net: precision 44.8% (95% Wilson CI 32.7%–57.5%), recall 22.0% on the 417-decision corpus. An empty guard result is not a safety verdict.
- **An answer may be partial.** Coverage is disclosed; absence from a partial
  result is not proof that no record exists. Repository-wide coverage, symbol anchors,
  and an interactive record builder remain open:
  [#32](https://github.com/MongLong0214/commitlore/issues/32),
  [#33](https://github.com/MongLong0214/commitlore/issues/33).
- **Commit trailers travel with a clone; notes do not.** Git does not fetch
  `refs/notes/*` by default, so a record in `refs/notes/commitlore` is absent
  from an ordinary clone until `commitlore init` configures that mirror.
- **There is no hosted backend.** But once the server or hook returns context,
  the host handles that context under its own policy; CommitLore does not
  control that data flow.

[Security](SECURITY.md) ·
[Compatibility](docs/COMPATIBILITY.md) ·
[Evidence](docs/evidence.md)

<details>
<summary><strong>Security and trust model</strong></summary>

Records are untrusted until graded. Default author matching is policy metadata,
not authentication. Signed directive mode requires Git verification and a
repository-local signer allowlist; an absent or unreadable allowlist authorizes
nobody. Injection-shaped payload is withheld from model-readable routes.

[Full security model →](SECURITY.md)

</details>

<details>
<summary><strong>Installation, upgrades, and old hook generations</strong></summary>

The CLI installer cannot rewrite hooks inside repositories it does not know
about, and running host sessions retain the runtime they loaded. `commitlore
doctor` names both states and their repair, and `commitlore upgrade` reports
whether a newer release exists.

[Installation and upgrades →](docs/install.md)

</details>

<details>
<summary><strong>Protocol and Git storage</strong></summary>

Records are ordinary Git trailers or notes. Protocol 2.0 defines lifecycle,
trust grades, validation, and compatibility.

[Human guide →](docs/protocol.md) ·
[Normative specification →](spec/SPEC.md)

</details>

<details>
<summary><strong>Evidence and negative results</strong></summary>

The repository publishes the methods, exclusions, unsuccessful measurements,
and the cases where the original benchmark or diagnosis was wrong.

[Evidence →](docs/evidence.md) ·
[Self-audit →](docs/SELF-AUDIT.md)

</details>

<hr>

<p align="center">
  <strong>Try it on a repository with history.</strong><br>
  <sub>Tell us where path scope, lifecycle, capture, or installation breaks.</sub>
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/issues/new">Report a failure case</a>
  ·
  <a href="docs/SELF-AUDIT.md">Read the self-audit</a>
</p>

<hr>

<!-- README:DOCS -->
## Documentation

- [Install, upgrade, and uninstall](docs/install.md)
- [CLI reference](docs/cli.md)
- [Capture workflow](docs/capture.md)
- [Record protocol](docs/protocol.md)
- [Security model](SECURITY.md)
- [Evidence and limitations](docs/evidence.md)
- [Production contract](docs/PRODUCTION-READINESS-SSOT.md)
- [Documentation index](docs/README.md)

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers the record protocol this repository
holds itself to, the release gate, and how to reproduce the evidence.

## License

MIT — see [LICENSE](LICENSE).
