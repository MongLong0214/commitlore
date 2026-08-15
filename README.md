<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="CommitLore: a coding agent must not revive a decision the repository already reversed.">
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3f6b52"></a>
  <a href="package.json"><img alt="Node.js 22.23.2 or newer" src="https://img.shields.io/badge/Node.js-%3E%3D22.23.2-3f6b52"></a>
</p>

<p align="center">
  <strong>English</strong> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

# CommitLore

**Your coding agent keeps re-proposing things your team already rejected.**
CommitLore keeps those decisions in Git and hands the agent the ones still in
force, before it edits the file.

CommitLore has no hosted service; it keeps its records in Git. Once its MCP
server or hook returns context, the host handles that context under its own
policy; CommitLore does not control that data flow.

**Two halves, and only one of them is automatic.** *Delivery* — handing the
agent the decisions that still apply, before it edits a path — happens on its
own once installed. *Capture* — writing a new decision down — is something the
agent does when a change carries a reason the diff cannot show; an ordinary
`git commit` cannot start it, because a hook has the diff and a capture needs
the session. [What happens automatically](#what-happens-automatically-and-what-does-not)
says exactly which hosts do which.

<p align="center">
  <img src="./assets/readme/commitlore-demo.svg" width="100%" alt="commitlore demo: lifecycle filtering shows only active decisions">
</p>

<details>
<summary><strong>Contents</strong></summary>

- [Install](#install)
- [What the agent receives](#see-it-work)
- [What happens automatically](#what-happens-automatically-and-what-does-not)
- [When this will not help you](#when-this-will-not-help-you)
- [The problem, in one example](#the-code-survived-the-decision-didnt)
- [What it is, in full](#what-it-is-in-full)
- [A path query](#see-a-path-query)
- [This repository as its own demo](#the-repository-is-the-demo)
- [Path scope vs. retrieval](#retrieval-can-find-records-path-scope-keeps-reversed-decisions-out)
- [How it works](#how-it-works)
- [A field report from another repository](#what-it-looks-like-on-a-real-repository)
- [What makes it different](#what-makes-it-different)
- [Where it pays off](#where-it-pays-off)
- [How records get created](#how-records-get-created)
- [A complete record](#a-complete-record)
- [What the repository proves](#what-the-repository-proves)
- [Evidence](#evidence-a-narrower-product-claim)
- [Uninstall](#uninstall) · [Documentation](#documentation) · [Contributing](#contributing)

</details>

## Install

Install once. Install the host integration and initialise the repository where
you want it to work.

**Claude Code** — one plugin registers the MCP server, the pre-edit context hook and the skills:

```
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

That is the whole plugin: the MCP server, the pre-edit hook and the skills. It puts no `commitlore` on `PATH`, so the `commitlore …` commands below come from `install.sh` / `install.ps1` and need that install as well.

**Codex** — install the native plugin with one command:

```bash
commitlore plugin install-codex
```

It registers the marketplace and plugin through Codex's own CLI, never by
editing its configuration or cache, and the install script below runs the same
command when it finds Codex. Start a new Codex session afterwards: the plugin's
skill and MCP server are loaded at session start, not on install. The CLI below
provides the repository commands.

Prerequisites for either path: Node.js 22.23.2+ and Git. The script checks both before it writes anything.

**Any other coding agent** — install the CLI:

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v1.0.0/install.sh | sh -s v1.0.0
```

**Windows** — the same install, in PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/MongLong0214/commitlore/v1.0.0/install.ps1))) v1.0.0
```

**Hermes** — after installing the CLI, configure its host integration:

```bash
commitlore hermes install
```

Which hosts are supported, and what each install path requires: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

**Give your next agent the judgment your last one earned.**

### Then, in each repository

Then run `commitlore init` in each repository where you want validation hooks,
a local index, and the repository-owned agent procedure. The installer detects
supported coding agents and registers the local MCP server where it can do so
safely.

```bash
cd your-repository
commitlore init
commitlore context .
```

After that:

- Commit normally. Most commits carry no record.
- If a record is present, the commit-msg hook validates it; it never creates one.
- Delivery and capture are different layers; the next section says exactly
  which hosts have each one.

Keep working through your coding agent. When a change contains decision context the diff cannot preserve, ask the agent to include a CommitLore record in the commit.

<details>
<summary>Prefer to inspect or pin the installation?</summary>

The one-liner is for convenience. For a reviewed or pinned install, download and inspect `install.sh` first, or clone the repository. The script installs a pinned source checkout and a thin wrapper that runs `node <checkout>/dist/commitlore.mjs` — it downloads no compiled artifact and runs no build step, so what it puts on your machine is the source you can read.

```bash
# Pin and inspect the installer before executing it.
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v1.0.0/install.sh
sh install.sh v1.0.0

# Or skip the script entirely: the checkout it makes is one you can make yourself.
git clone --depth 1 --branch v1.0.0 https://github.com/MongLong0214/commitlore
node commitlore/dist/commitlore.mjs --version
```

</details>

## See it work

Before editing `src/pricing.ts`, the agent receives this payload — the record,
not a description of one:

```
commitlore: active records for src/pricing.ts

Limit
  [claim]      r-price01  87e36511  calculatePrice owns final checkout pricing only

Ruled-out
  [claim]      r-price01  87e36511  Reuse checkout pricing for admin quotes | eligibility
                                    and rounding semantics differ between the two flows
```

`[claim]` matters: its author string did not match one this repository
configured for directives, so the agent is told to weigh it as information, not
obey it as an order. In the default author-string mode, `[directive]` means the
commit's author header matched a string this repository configured — not that a
trusted author recorded it, and not that the identity is proven. Anyone who can
write a commit can set that header. A repository can opt into Git's authenticated
boundary with `git config --local commitlore.requireSignedDirective true`. In
that mode, `[directive]` requires Git to verify the signature against this
verifier's trust store **and** the exact signing-key fingerprint Git reports
(`%GF`) must be listed in the repository-local allowlist:

```bash
git config --local --add commitlore.trustedSigner <Git-%GF-fingerprint>
```

An absent, empty, or unreadable signer allowlist authorizes nobody, so every
record remains `[claim]`; it never means every valid signer is authorized.
Signature mode remains opt-in, so existing author-string policy is unchanged
until a repository enables it. A signature proves that a key accepted by this
verifier signed the commit. It does not prove that the key has authority for
this repository, which is what the local allowlist supplies, nor does it prove
the record's truth. Delivery gives the agent context; it does not block the edit.

## What happens automatically — and what does not

**Delivery** means the record reaches the agent before it edits a path.
**Capture** means a decision can enter the verified commit-time flow. They are
separate layers:

| Host | Delivery | Capture |
|---|---|---|
| Claude Code | **Yes — automatic through the plugin.** | **Yes — through the plugin.** |
| Codex | **Yes — automatic through the plugin.** | **Yes — through the plugin.** |
| Hermes | **Yes — `commitlore hermes install`.** | **Yes — `commitlore hermes install`.** |
| Gemini CLI, Cursor, Windsurf, opencode | **Yes — the MCP server is wired by `install.sh`.** | **Procedure, not automatic.** The server states the prepare → verify → stage procedure in its `instructions` on every connection. The host may or may not act on it. |
| Any other `AGENTS.md`-convention host | **Procedure, not automatic.** `commitlore init --agents-md` writes it into the repository. | **Procedure, not automatic.** Same file, same caveat. |

“Yes” in the Capture column means the workflow is installed and available — the
prepare → verify → stage path exists for that host. It does not mean every
eligible commit reaches a terminal assessment on its own. **That stronger
property, deterministic autocapture, is not certified on any host yet**, so
treat capture as available rather than guaranteed. Most commits should carry no
record in any case.

The first three rows install a skill that drives capture; the fourth receives
the same procedure over MCP, which is what a host that loads no skills has to
work from — verified with the plugin disabled, and it captured. Whether a given
host surfaces those instructions to its model is the host's choice, and nothing
here detects it. A host still has to start capture, and the candidate must pass
verification before the commit hook attaches it. The commit-msg hook validates
a record when present; it never invents one.

## When this will not help you

Read this before installing, not after.

- **The measurement is of the weaker tier.** Every record in the 1,160-run study
  rendered `[claim]`, which tells the agent to weigh the record rather than obey
  it. The `[directive]` tier became reachable only afterwards, and nothing here
  measured it — the study's own verdict says this number "does not transfer to
  the stronger one". Whether a directive does better, worse, or the same is
  unmeasured in both directions.
- **One model, one harness, ten constructed fixtures.** The oracle reads the
  final implementation state, so it shows that agents which received records
  re-proposed less often. It does not show that any of them read anything.
- **Guard is an experimental advisory**, not a safety net: precision 44.8%
  (95% Wilson CI 32.7%–57.5%), recall 22.0% on the 417-decision corpus
  ([ADR-0020](docs/adr/ADR-0020-guard-is-an-experimental-advisory.md)). An empty
  guard result does not mean a proposal avoids every ruled-out alternative — at
  22% recall, a miss is the common case.
- **Signature verification is opt-in, not key distribution.** Default mode
  matches a forgeable author string. Setting
  `commitlore.requireSignedDirective=true` also requires Git's verified
  signature status from this verifier's trust store and an exact `%GF`
  fingerprint in repository-local `commitlore.trustedSigner`; a missing,
  empty, or unreadable allowlist authorizes nobody. That verifies neither a
  person's authority nor the record's truth. Repository-wide coverage, symbol anchors,
  and an interactive record builder remain open:
  [#32](https://github.com/MongLong0214/commitlore/issues/32),
  [#33](https://github.com/MongLong0214/commitlore/issues/33),
  [#34](https://github.com/MongLong0214/commitlore/issues/34).
- **M4 did not test a guard effect**: its rows carry no `guard_exposure`, so
  treatment exposure there is unverifiable
  ([#122](https://github.com/MongLong0214/commitlore/issues/122)).

The full method, the exclusions and the per-arm truncation split are in
[bench/VERDICT-M5.md](bench/VERDICT-M5.md) and
[what it does not show](docs/evidence.md). Delivery methodology and the
retrieval evidence are in [bench/DECISION-DELIVERY.md](bench/DECISION-DELIVERY.md).

## The code survived. The decision didn't.

*Stop re-reviewing the same bad idea.*

**Without CommitLore.** A new session sees two functions with similar inputs and
reuses one.

```ts
calculatePrice(input, { isAdminPreview: true, skipCoupon: true });
```

The team now has another flag, another wrapper, and another compatibility branch
protecting a use case the function was never meant to own. The reviewer writes
"we already rejected this" for the second time.

**With CommitLore.** Before editing, the agent receives the active record shown
above, rather than an instruction reconstructed from a review comment.

The module boundary is in front of the agent before it proposes the change,
rather than in a review comment after.

**Whether it acts on that is now measured.** Across 1,160 registered runs, an
agent handed the repository's active records re-proposed a ruled-out approach in
**2.8%** of them (16/580). Without them: **18.8%** (109/579).

| arm | re-proposed a ruled-out approach |
|---|---:|
| the agent alone | **18.8%** (109/579) |
| **with CommitLore** | **2.8%** (16/580) |

**The threshold was registered before the run**, and the preregistration
predicted a *smaller* effect than it got — that prediction, with its stated
probabilities, is in
[bench/PREREGISTRATION-M5.md](bench/PREREGISTRATION-M5.md) §A.2, and it was
wrong. The significance test, the interval and the registered threshold are in
[bench/VERDICT-M5.md](bench/VERDICT-M5.md) rather than here: a statistic
retyped into prose drifts from the log that produced it, and this repository
gates against exactly that (`scripts/check-readme-numbers.mjs`).

## What it is, in full

**The Git-native decision layer for coding agents.**

Every fresh agent inherits the implementation. None of them inherit the
constraints, the alternatives your team rejected, the warnings, or the
verification gaps — those do not travel with the code unless something carries
them.

CommitLore preserves that engineering judgment in Git, and surfaces only the
decisions still in force before the next edit. A decision that was later
superseded or expired does not reach the agent as if it still stood.

**Repository-owned · Lifecycle-aware · Quote-checked · Agent-independent**

Claude Code · Codex · Cursor · Gemini CLI · OpenCode · Windsurf

No hosted memory service. No vendor-specific chat history. Just reviewable
decision context, owned by the repository. Commit trailers travel with their
commits; notes-backed records need the notes fetch configured after a clone.

## See a path query

**A fresh agent. Zero chat history. It is still handed why the obvious fix was rejected.** Query a path before changing it:

```bash
commitlore context install.sh
```

The output includes the active record that ruled out publishing a `-musl` target as the fix for the installer defect, including its reason. The hook returns context; it does not claim to block the edit.

```console
context for install.sh as of <timestamp> — 0 limits, 1 ruled-out, 1 warnings, 2 other in 1 record (no index, 1 commit record(s) scanned)

ruled-out
  r-instci99a  <commit>  [claim]  Publish a -musl release target | a release.yml/build-matrix change, not an install.sh or CI-verification fix

warnings
  r-instci99a  <commit>  [claim]  Revisit this wording if a musl target ships
```

Reproducing that exact `PreToolUse` hook path, and every other command: [docs/cli.md](docs/cli.md).

## The repository is the demo

A tool that claims to stop agents re-deciding settled questions should be able
to show what it caught in itself. This one keeps that list in public, including
the entries where the thing that turned out to be false was something this
project had already published:

- **No install could produce the trust tier the README's claims rested on.** Records reach an agent graded `directive` or `claim`. It turned out no installed surface configured a directive author string, so grading failed closed to `claim` for everyone — while the injected legend advertised the tier nobody could reach. Both prior benchmarks had measured `claim`-graded delivery ([#415](https://github.com/MongLong0214/commitlore/issues/415)).
- **The registered benchmark analysis would have read four different experiments at once** — and because its stopping rule was a row count, the contamination would have made the study *pass* its own completeness gate ([#441](https://github.com/MongLong0214/commitlore/issues/441)).
- **The result-schema gate was not run by anything**, so the schema drifted five fields behind the runner and nobody noticed for two days ([#392](https://github.com/MongLong0214/commitlore/issues/392)).
- **A shipped pre-push hook hung every `git push`** — 1,240 hook invocations in 40 seconds — because the function had been tested eleven times and the hook path zero times ([#422](https://github.com/MongLong0214/commitlore/issues/422)).

Every one of those is a `Ruled-out:`, `Warn:` or `Limit:` line in a commit
trailer, validated by the hook this project asks you to install, and readable
with the same `commitlore context` you would run anywhere else.

**The full list, with what each one cost: [docs/SELF-AUDIT.md](docs/SELF-AUDIT.md).**

## Retrieval can find records. Path scope keeps reversed decisions out.

Before an agent's first edit, how much of a repository's still-active decision set actually reaches it? On this repository, at the 800-token budget the hook ships with:

| route | budget | active decisions delivered | reversed ones delivered | tokens |
|---|---:|---:|---:|---:|
| the code alone | — | 0.0% | 0 | 0 |
| `git log` for the path | 800 | 42.0% | 7 | 673,134 |
| **CommitLore path scope** | **800** | **81.7%** | **0** | **511,412** |
| CommitLore, cap removed | none | 92.3% | 0 | 741,429 |

With the cap removed, path scope recovers exactly what a whole-repository dump recovers — 2,047 of 2,217 — for a fraction of its 92,175,612 tokens and none of its 7,322 reversed records. The scope costs nothing. The cap costs 10.6 points. The remaining 170 are records the trust grader withholds.

**This measures delivery, not effect.** No agent ran, so it bounds what one could recover, not what one does — and a retrieval number can climb while the outcome it is meant to predict falls. SWE-bench measured BM25 recall rising from 29.58 to 51.06 across its context budgets and reported that "even when increasing the maximum context size for BM25 would increase recall with respect to the oracle files, performance drops … as models are simply ineffective at localizing problematic code" ([arXiv:2310.06770](https://arxiv.org/abs/2310.06770)). One corpus, one repository. Seven superseded records and no expired ones, so zero-reversed-delivered says nothing yet about expiry. Method and full tables: [bench/DECISION-DELIVERY.md](bench/DECISION-DELIVERY.md).

**The `git log` baseline is not an artifact of measuring ourselves.** The same measurement on four repositories this project did not write — Django, SymPy, scikit-learn and Requests, at pinned commits — puts the share of a path's history that survives an 800-token cut between **37.4% and 55.6%**. The 42.0% above sits inside that band. Losing something close to half a file's history to a fixed budget is what `git log` does on large, long-lived repositories generally, not something peculiar to this one. What did *not* transfer is the mechanism: our paths carry a median of one commit at 687 tokens where Django's carry eight at 213, so long commit messages make the ordinary-Git baseline worse at a fixed budget — a cost of this project's own practice. [bench/EXTERNAL-CORPUS.md](bench/EXTERNAL-CORPUS.md) also reports a delivery figure on those repositories; read §9.0 and §9.5 first, because the records there were generated from revert commits by a program and the headline number is one the attachment predicate forces rather than a retrieval result.

Missing a record costs the model context. Handing it a decision that was already reversed costs it correctness. In this [retrieval measurement](bench/retrieval/result.md), at every size from 0 to 10,000 distractors, BM25, embedding top-k, hybrid RRF, and embedding with a path filter each returned one superseded record. CommitLore path scope with lifecycle returned zero stale records and both current records (2/2).

Recall is the supporting result: retrieval finds broadly the same records either way, but only one route knows which are still current. The advantage appears when decisions have been reversed—the case this product exists for.

The separate #167 exposure run still matters: only 2 of 10,002 records reached the model.

| route | model-visible records | relevant records | model-visible tokens |
|---|---:|---:|---:|
| inject everything | 10,002 | 2/2 | 1,004,554 |
| top-k lexical | 2 | 1/2 | 190 |
| CommitLore path scope | 2 | 2/2 | 335 |

This measures exposure and recall at a fixed two-record output budget—not token cost, billed cost, accuracy, or agent behaviour. It is one corpus, one query, and one pinned embedding model. Where recall ties, and what else has and has not been measured: [docs/evidence.md](docs/evidence.md).

## How it works

1. **Capture** — the agent drafts only the decision context a diff cannot show.
2. **Verify** — CommitLore checks that draft against the session and the staged diff.
3. **Preserve** — the verified record lives in Git, with identity and a lifecycle.
4. **Deliver** — before editing a path, the next agent receives only the decisions still in force.

## What it looks like on a real repository

From a field report on a ~768-commit Swift MCP server, one day after installing.
Naming one file path surfaced a merged pull request the engineer did not know
existed, and it changed what the surviving code meant.

> **I did not know that commit existed.** It is a merged PR from two weeks
> earlier that had already removed eight of these sites and replaced each with
> an accessibility-native equivalent, every one fail-closed and live-verified.
>
> None of this was in any chat history. It was in the repository, and I got it
> by naming a file path.

The alternative was reading two weeks of merged pull requests to find it. That is
not something an agent does spontaneously, and not something a person does before
every edit. Adoption cost, from the same report: one command, and 7.4 seconds to
index 768 commits. Nothing touched history or the working tree. The console
output and the full report are in [docs/evidence.md](docs/evidence.md).

That was a 768-commit repository. At **100,000 commits an indexed `context` query
answers in 496 ms at p50**, and the hooks behind it cost 185.85 ms p50 for
`commit-msg` and 102.40 ms p50 for the injection hook. Those are the numbers that
decide whether this stays installed on a large repository, and they are measured
rather than asserted. The same run carries the figure that looks bad: without the
index, that query at 100,000 commits takes 86,673 ms. The index is not an
optimisation on top of a working query — it is what makes the query possible at
that size, which is why `init` builds one and `doctor` checks it.

**Three properties no hosted chat-history product can offer**, and the reason the
authority is Git rather than a service:

- **Reviewable.** A decision arrives as a commit trailer in a pull request, where
  it can be argued with before it becomes authority.
- **Owned by the repository.** No account, no vendor, nothing to lose access to.
- **Commit trailers travel with a clone.** A record in
  `refs/notes/commitlore` does not arrive in an ordinary clone: Git does not
  fetch `refs/notes/*` by default. `commitlore init` configures that mirror;
  [the sharing documentation](docs/cli.md#sharing-records-with-a-team) explains
  the remaining fetch and push boundary.

## What makes it different

| Tool | What it remembers |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | how the agent should work |
| ADRs | large architecture decisions, as documents |
| Chat memory / RAG | related text from the past |
| [Lore](https://arxiv.org/abs/2603.15566) | the same idea, published first — decision records in git trailers |
| **CommitLore** | **which decisions still apply to this code path** |

Similarity search can find a related decision. CommitLore also knows whether that
decision is still active, superseded, or expired — and shows only the first.

**On that third row.** [Lore](https://arxiv.org/abs/2603.15566) (March 2026)
proposed decision records in native git trailers four months before this
repository existed, with a vocabulary that maps almost one-to-one onto this one.
The protocol idea is not novel here and saying otherwise would not survive anyone
reading the paper. What Lore has no counterpart for is the lifecycle —
`Supersedes:` and `Expires:`, and the filtering that makes the row above true —
or the trust grading; and it states that it "outlines an empirical validation
path" rather than running one. That validation, including the parts that failed,
is what this project has that the paper does not
([ADR-0029](docs/adr/ADR-0029-lore-is-prior-art-and-this-is-what-differs.md)).

The authority is ordinary commit trailers and `refs/notes/commitlore`. Indexes and reports are derived and rebuildable from those Git records.

## Where it pays off

**Protect a module boundary.** *"`calculatePrice` owns final checkout pricing only. Do not reuse it for admin previews."*

**Preserve a rejected workaround.** *"Raising the timeout hides the connection leak. Fix the cleanup path instead."*

**Mark temporary compatibility code.** *"This caller is temporary and is not part of the supported contract."*

**Carry a verification gap.** *"Single-user behaviour was tested. Concurrent refresh remains unverified."*

Each is a sentence a diff cannot carry and a reviewer would otherwise have to say twice.

## How records get created

You do not hand-write a trailer for every commit. Most commits should carry no record at all. Add one only for a decision the diff cannot recover: an external constraint, a rejected alternative, a warning, or a verification gap.

Ask the agent to commit normally and preserve only the decision context the diff cannot explain:

> Commit this change. Add a CommitLore record only if the diff cannot recover an important constraint, rejected alternative, warning, or verification gap.

The agent instructions live in `skills/commitlore-commits/`, and the commit-msg hook validates any record the agent adds — it never invents or silently adds one. The `harvest` route, the `capture` transaction, and the escape hatch of writing trailers by hand are all in [docs/capture.md](docs/capture.md).

## A complete record

A record can be much smaller than this; most need only a few fields. This one uses the whole vocabulary because it is also a conformance fixture — Git's trailer parser reads the code block identically in every translated README.

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

### Protocol vocabulary

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

Read a path's history with `commitlore context <path>`. Smaller examples, and how to read records with plain Git instead, are in [docs/protocol.md](docs/protocol.md); the normative definitions are in [SPEC §3](spec/SPEC.md).

## What the repository proves

- Decision history survives rebase, remote transfer, and path renames in the tested Git workflows. Squash-merge discards the trailer block, as any ordinary trailer would be: `commitlore squash-preserve` or its GitHub Action carries the records across, and the tested workflows cover that route.
- Routes share one grading core, so untrusted text is information rather than an instruction — but the index caches a signature status, and a signature status is not a property of the repository. The same record can therefore grade `directive` on one route and `claim` on another from a single installation, if the index was built where the signing keys were not reachable. Comparing a route against `--no-index` tells you whether you are reading a stale verdict ([#653](https://github.com/MongLong0214/commitlore/issues/653), [#631](https://github.com/MongLong0214/commitlore/issues/631), [#635](https://github.com/MongLong0214/commitlore/issues/635)).
- Injection-like text in free-form trailers is withheld from model-readable routes.
- A readable repository with no records is distinct from incomplete history or an unfetched notes mirror.

These are product claims about Git-bound, human-verifiable decision history. They do not depend on a claim that CommitLore improves agent performance.

## Evidence: a narrower product claim

112 experiments were recorded, but M4 recorded no per-run guard exposure. Whether the treatment was present is unverifiable, so it does not test, support, or refute the agent-behavior claim. The narrower product claim above rests on independently testable behavior; read the [M4 verdict](bench/VERDICT-M4.md) for the clean dataset and withdrawal.

What is measured — retrieval, exposure, latency and scaling, hook overhead — and what is not — break-even, and any effect on agent behaviour — is set out in [docs/evidence.md](docs/evidence.md).

<details>
<summary>Full benchmark record (112 experiments)</summary>

<!-- BENCH:BEGIN -->
<!-- Generated by `node bench/report.ts --section` from the result logs named below. Do not edit by hand:
     CI regenerates this block and fails if a single byte differs (scripts/check-readme-numbers.mjs). -->

**1160 measurements across 1240 rows.** 80 row(s) are superseded by a re-run of the same task, arm and seed, and the analysis counts the survivor. No manifest declares how many runs the matrix was meant to produce, so completeness cannot be checked from the logs alone.

| Where it comes from | |
|---|---|
| Results | `bench/results/m5-seeds-1-10-rerun.jsonl` (200 rows), `bench/results/m5-seeds-11-20-rerun.jsonl` (200 rows), `bench/results/m5-seeds-21-30.jsonl` (200 rows), `bench/results/m5-seeds-31-40.jsonl` (200 rows), `bench/results/m5-seeds-41-50.jsonl` (200 rows), `bench/results/m5-seeds-51-58.jsonl` (160 rows), `bench/results/m5-seeds-55-58-rerun.jsonl` (80 rows) |
| Run id | `20260802T124657Z-ae3ba0`, `20260802T230855Z-00da79`, `20260803T100356Z-aeb38a`, `20260803T203631Z-77df15`, `20260806T230824Z-60e31e`, `20260807T095937Z-bf2b05`, `20260807T234037Z-6dd0a2` |
| Driver | `claude-headless` |
| Model | `sonnet` |
| Matrix | 10 tasks, seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58 |
| Status | final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-1-10-rerun.jsonl`), final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-11-20-rerun.jsonl`), final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-21-30.jsonl`), final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-31-40.jsonl`), final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-41-50.jsonl`), final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-51-58.jsonl`), final (declared in `bench/report.ts`, pending a manifest field) (`bench/results/m5-seeds-55-58-rerun.jsonl`) |

**Re-proposal and violation rates, every recorded run:**

| Condition | n | Re-proposed | Re-proposal rate | Runs with violations | Violation rate | Mean turns | Mean tokens |
|---|---|---|---|---|---|---|---|
| `commitlore-off` | 620 | 110 | 0.177 | 58 | 0.094 | 19.3 | 38488 |
| `commitlore-on` | 620 | 16 | 0.026 | 7 | 0.011 | 16.2 | 39265 |

**Analysis set — 1169 of 1240 rows** (71 excluded: error = 71). A row that failed carries `reproposed: false` because the field is required, not because the agent declined to re-propose; leaving it in the denominator would let the arm that crashed more often look like the arm that behaved better. The excluded runs are counted here, never dropped silently.

| Condition | n | Re-proposed | Re-proposal rate | Runs with violations | Violation rate | Mean turns | Mean tokens |
|---|---|---|---|---|---|---|---|
| `commitlore-off` | 584 | 110 | 0.188 | 58 | 0.099 | 20.4 | 40842 |
| `commitlore-on` | 585 | 16 | 0.027 | 7 | 0.012 | 17.1 | 41568 |

**Significance:**

| Quantity | Value |
|---|---|
| Arms | `commitlore-on` (treatment) vs `commitlore-off` (baseline) |
| Re-proposed / did not | `commitlore-on` 16/569, `commitlore-off` 110/474 |
| Fisher exact, two-tailed | p = 1.52e-20 |
| Rate difference, treatment minus baseline | -16.1pp, 95% CI [-19.6pp, -12.7pp] |
| Odds ratio | 0.1212 |
| Paired (task, seed) cells | 579 |
| Rows excluded from the analysis set | 71 |

**How the runs ended** — failures are reported, not filtered:

| Condition | completed | timeout | over-turns | over-tokens | error |
|---|---|---|---|---|---|
| `commitlore-off` | 414 | 3 | 157 | 10 | 36 |
| `commitlore-on` | 459 | 2 | 109 | 15 | 35 |

**Read these numbers with their limits:**

- Every rate here is conditional on the model that produced it. Re-proposal is a behaviour, and behaviours differ between models, so these figures are not evidence about any other model.
- 585 and 584 runs per arm: this matrix is only powered to detect a large effect, so a non-significant result from it is a statement about the sample size, not about CommitLore. The exact power table is in [`bench/README.md`](bench/README.md).
- Fisher exact treats the runs as independent while the design is paired by (task, seed). It is the pre-registered result, but it is not a valid paired-data test. See the correction in [`docs/VERDICT-M4.md`](docs/VERDICT-M4.md).
<!-- BENCH:END -->

</details>

## Uninstall

```bash
commitlore uninstall
```

Removes what `install.sh` or `install.ps1` wrote — the wrapper, the pinned
checkout, and the MCP entry it added to each agent config. It removes nothing it
did not write, and names what it leaves: the per-repository hooks, the agent
hook, and the Claude Code plugin. `--dry-run` reports without changing anything.
What removes each of those, and how to run from a source checkout instead:
[docs/install.md](docs/install.md).

## Documentation

- [docs/install.md](docs/install.md) — the install paths, what each one writes, and how to undo it
- [docs/cli.md](docs/cli.md) — every command, with its flags
- [docs/capture.md](docs/capture.md) — how a record gets written
- [docs/protocol.md](docs/protocol.md) — the record format, and reading it with plain Git
- [docs/evidence.md](docs/evidence.md) — what is measured, and what is not
- [spec/SPEC.md](spec/SPEC.md) — the normative protocol

## Contributing

Read the [spec](spec/SPEC.md), the [ADRs](docs/adr/), and [`CONTRIBUTING.md`](CONTRIBUTING.md). CommitLore is free forever and open source under the [MIT License](LICENSE).
