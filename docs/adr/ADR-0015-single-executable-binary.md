# ADR-0015: single executable binary via Node SEA — git clone stays canonical

- Status: Accepted (2026-07-28)
- Supersedes: nothing. Amends ADR-0011 (adds a second, optional distribution
  artifact; the registry-free git-clone channel it established remains the
  default and the only one required). Enabled by ADR-0012 (`node:sqlite`
  removed the one native dependency that made a single-file binary
  impossible). Resolves [#39](https://github.com/MongLong0214/commitlore/issues/39).

## Context

Two separate facts point at the same fix.

**Latency.** `bench/results/deterministic-*.md` §5 measures the PreToolUse
inject hook at **+102.40 ms p50** against a 0.04 ms baseline — the hook is not
adding overhead to the edit, it *is* the edit's overhead, and it is almost
entirely Node process startup. An agent session with 100 edits spends roughly
ten seconds inside it.

**Distribution.** ADR-0011 made the git repository the whole install — no
registry, no publish step, `dist/commitlore.mjs` committed and dependency-free.
It also named what that ADR did *not* remove: "The Node runtime dependency
remains... ADR-0002 rejected a single static binary because of the schedule;
#39 reevaluates it." Requiring an installed Node runtime is the one thing left
between this project and its stated goal — a free, open protocol any agent can
use regardless of stack. ADR-0012 then removed the reason a static binary
could not be built at all: `better-sqlite3` was the one dependency that could
not travel inside a Node SEA blob, and it is gone.

Issue #39 lists three options: Node SEA, a Go/Rust reimplementation against the
existing conformance suite (`spec/fixtures/`, `spec/contract-cases/`), or
platform binaries via some other packer. This ADR picks the first and records
why.

## Decision

**Build a Node Single Executable Application from the same `src/cli.ts` entry
point, using Node's own `--experimental-sea-config` and `postject`.**

- `npm run build:binary` (`scripts/build-binary.mjs`) runs after `npm run
  build`. It bundles `src/cli.ts` a second time — CommonJS this time, to a
  temporary file, never committed — generates a SEA blob from it, copies the
  running `node` binary, and injects the blob with `postject`, following
  Node's own documented procedure (sentinel fuse
  `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, `--macho-segment-name
  NODE_SEA` and a `codesign` remove/re-sign pair on macOS).
- `postject` is a **devDependency**, not a dependency: it runs at build time
  only, is the tool Node's own SEA documentation names for this exact
  purpose, and never ships inside anything a user runs. No third-party
  *runtime* dependency is added — the binary's only "dependency" is the copy
  of `node` it is built from, which becomes part of the binary itself.
- `core/paths.ts#readInstalledFile` embeds `package.json`, `spec/SPEC.md` and
  `spec/schema/record.schema.json` as SEA `assets` and reads them back with
  `sea.getAsset` when `sea.isSea()` is true, instead of walking the
  filesystem — Node's own docs: inside an SEA, `import.meta.url`/`__dirname`
  resolve to the *executable's own path*, not a directory that contains
  `spec/`.
- The output, `dist/commitlore` (`dist/commitlore.exe` on Windows — not built
  here, see Ruled-out), is **not committed**. `.gitignore` excludes it.

## How this fits ADR-0011

ADR-0011's decision — "distribution is git clone, do not use a registry" —
does not change. `dist/commitlore.mjs` stays exactly what it was: committed,
dependency-free, rebuilt and byte-diffed by CI on every push. Cloning the
repository remains a complete, working installation with zero extra steps.

The binary is a **second, optional artifact for one specific gap**: a machine
with no Node runtime on `PATH` at all. It is not committed for the same reason
`dist/commitlore.mjs` *is*: ADR-0011's CI check ("Committed dist/ matches
src/") only works because that comparison is a byte-for-byte diff against a
small, deterministic text bundle. A ~115 MiB, platform- and
architecture-specific executable is neither small nor meaningfully diffable —
committing it would either break that invariant or require carving out an
exception to it, and every rebuild would rewrite the whole blob in history
forever. Instead it is a **reproducible build artifact**: `npm run
build:binary` from a clean checkout produces it locally, and CI builds and
smoke-tests it on every push without ever committing it — the same role a
release asset plays, which is exactly where issue #39's own acceptance
criteria pointed ("attach platform binaries to the release"). Nothing about
`git clone` as the *source* channel changes; a binary is something you can
additionally *build* from that source, or download from a release once CI
publishes one.

## Ruled-out

- **`mainFormat: "module"` (an ESM SEA main script)** — tried first, so that
  `dist/commitlore.mjs` could feed the SEA blob unmodified with no second
  build. Verified, not merely read from a doc, against this Node line
  (22/24): blob generation fails on an ESM main with "Cannot use import
  statement outside a module" (and, with `useCodeCache: true`, "Cannot
  generate V8 code cache" first); the same file run directly as an SEA main
  fails identically at runtime with the same error. Node's shipped
  `@types/node` doc for `node:sea` is explicit and matches: "the single
  executable application feature currently only supports running a single
  embedded script using the CommonJS module system." `scripts/build-binary.mjs`
  instead bundles `src/cli.ts` a second time to CommonJS, as a build
  intermediate that is generated fresh every build and never committed —
  `dist/commitlore.mjs` never changes format or content because of this.
- **`pkg` / `nexe`** — third-party bundlers that embed a *separate, forked*
  Node runtime, one this project does not control the version or security
  patch cadence of, and `pkg` is archived upstream. That trades the Node
  runtime dependency this ADR removes for a different, less-maintained one —
  worse trust story, not a better one, for a project whose own Node floor
  (ADR-0010) exists specifically to track EOL and security support.
- **Deno `compile` / Bun `compile`** — real single-binary compilers, but for a
  *different* runtime. `node:sqlite` (ADR-0012), the CLI's TypeScript, and its
  `NodeNext` module resolution are all Node-specific; retargeting them is a
  second runtime port, not a build step, and issue #39's own first option
  ("Node SEA — no source rewrite") is preferable exactly because it needs
  none.
- **Reimplement in Go or Rust** — issue #39's second option, and a real one:
  `spec/fixtures/` (25) and `spec/contract-cases/` (14) exist precisely so a
  conforming implementation can be verified in any language. It is also a
  second codebase to maintain in lockstep forever, an order of magnitude more
  work than this ticket's scope, and not needed to solve either problem this
  ADR opens with (SEA solves both the latency figure and the no-Node-on-PATH
  gap without one). Left as a future option if SEA's "Active development"
  status (Node's own docs) ever proves disqualifying — see Consequences.
- **Committing `dist/commitlore` next to `dist/commitlore.mjs`** — see "How
  this fits ADR-0011" above.
- **Windows in this PR** — Node's own docs describe a Windows path
  (`.exe` output, optional `signtool` signing) that `scripts/build-binary.mjs`
  does not exercise: this repository's CI has no Windows runner behind it yet,
  and shipping a claim this project cannot itself verify is exactly the kind
  of unmeasured figure `docs/RELEASE-GATE.md`'s discipline exists to refuse.
  `core/hook-target.ts#classifyBinTarget` and the shell stub's resolution
  order are written so a `commitlore.exe` branch is a small, additive follow-up
  rather than a redesign — not built here because it is not built or tested
  here.

## Consequences

**Gained.** `doctor`, `validate`, `context`, `guard`, `inject`, and `index
--rebuild` all run against a real machine with `PATH=/usr/bin:/bin` and no
Node — verified directly, not inferred (see the PR this ADR ships with for the
transcript). `node:sqlite` works inside the binary exactly as ADR-0012's
"single static binary becomes possible" predicted: it is a Node builtin, not a
`.node` addon, so nothing about being embedded in a SEA blob changes how it
loads. The commit-msg hook (`hooks.ts#recordBinPath`, `hooks/commit-msg.ts`)
and the Claude Code plugin hook (`scripts/commitlore-run.sh`) can both target
the binary now, and `scripts/commitlore-run.sh` tries it *before* falling back
to a Node-based path — on the hot path this ADR exists for, the binary is not
merely the option that still works without Node, it is also the faster one:
`bench/binary-hook-overhead.ts` re-measured the PreToolUse inject hook
same-session against `dist/cli.js` and the binary on the same machine that
produced the +102.40 ms figure above, and the binary's p50 overhead came in
**lower, not merely present** — see `bench/results/binary-hook-overhead-*.md`
and the PR for the exact numbers and the machine's contention state at
measurement time. It does not go to zero — SEA still pays V8 startup and blob
decompression, just not a second process's worth of module resolution on top
of it — so this is reported as a real, bounded reduction, not elimination.

**Lost.** The binary is roughly 115 MiB (a full copy of `node` plus the
blob) per platform and architecture — not committed, so it does not bloat the
repository, but it is a real download or local-build cost wherever it is
used, unlike the kilobyte-scale `dist/commitlore.mjs`. Two build outputs now
exist from the same `src/cli.ts` (the committed ESM bundle and the
uncommitted, freshly-regenerated CJS one `build-binary.mjs` builds each run)
— kept from drifting apart by compiling both from the identical source and by
CI now running the shipped conformance/fresh-install checks against the
binary as well as the script path.

**Risked.** Node's own SEA docs describe the feature as under active
development; its config schema or CommonJS-only constraint could change
between Node versions. `core/paths.ts`'s `readInstalledFile`/`isSea` split and
`scripts/build-binary.mjs`'s asset map are the one place that assumption is
absorbed, the same posture ADR-0012 already committed to for `node:sqlite`'s
own experimental status. If SEA is ever discontinued or made impractical
upstream, the Go/Rust path ruled out above — backed by the same conformance
suite — is the documented fallback, not a redesign from nothing.
