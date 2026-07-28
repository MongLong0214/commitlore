# ADR-0011: distribution — registry-free git distribution, agent-neutral integration

- Status: Accepted (2026-07-26)
- Supersedes: ADR-0002's **distribution channel** clause (`npm publish` + `npx commitlore`). The language (TypeScript strict), runtime (Node, ADR-0010 floor ≥22), and single-package decisions **remain valid.**

## Context

ADR-0002 chose npm as the distribution channel based on the 4-week schedule and owner's stack. Its assumption was "the person using the CLI installs it." The actual user is not a person but an **agent**, and there is more than one agent — Claude Code, Codex, Gemini CLI, Cursor, Cline, Windsurf, Zed, Qwen Coder, and Kimi each use different integration surfaces.

Using npm as the channel brings three consequences.

1. **The owner acquires a release ritual.** The first distribution attempt actually stopped at a 2FA OTP. Registry accounts, tokens, and publish steps repeat for every release.
2. **Users inherit an ecosystem bias.** Requiring `npm install -g` from an agent working in a Python or Go repository conflicts with the fact that the protocol is a git trailer.
3. **It is disconnected from the agent ecosystem.** No agent discovers tools in the npm registry. They discover them through MCP configuration and plugin marketplaces.

## Decision

**Distribution is git clone. Do not use a registry.**

- Commit `dist/` to the repository. There is no build step.

> ✅ **Closed** (2026-07-26, #38). `dist/commitlore.mjs` is an esbuild bundle, so it
> includes its dependencies. In a clone with no dependencies, `--version`·`validate`·`ruled-out`·`guard`·
> `doctor`·`mcp` (3 tools) were all measured directly. Only `better-sqlite3` is external;
> when absent, the tool degrades to `--no-index`.
- For Claude Code, the repository itself is both plugin and marketplace (`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`, `source: "./"`).
- The 1st-class surface for every other agent is the **MCP server** (`commitlore mcp`, stdio, protocol 2024-11-05, 3 tools). Every client receives the same single JSON configuration block.
- Provide `AGENTS.md` for agents that can use only a shell. `AGENTS.md` is a de facto standard shared by Codex, Qwen, Kimi, Gemini, and Cursor.
- Preserve the path that requires no tool at all: records are git trailers, so any language can read them with `git log --format='%(trailers:...)'`.

## Ruled-out

- **Keep npm alongside the plugin** | two channels split versions and preserve the OTP ritual for every release. A registry provides version resolution and discovery; the plugin marketplace provides both
- **Do not commit `dist/` + run npm install during installation** | spends a network round trip at the start of every session and retains the registry dependency. Fails silently offline and behind corporate proxies
- **Do not commit `dist/` + require a source build** | requiring a toolchain during installation breaks the "one clone and done" promise
- **Include automatic commit-hook installation in the plugin** | installation must not touch a user's `.git/hooks` without consent. Keep `commitlore hooks install` as an explicit choice

## Consequences

- **Release = tag push.** There is no publish account or token. The plugin version resolves from `version` in `plugin.json`, or from the git commit SHA when omitted.
- **`dist/` drift is a new risk.** If committed build output diverges from `src/`, stale code gets distributed. The build was confirmed deterministic (same input → same hash), and CI rebuilds it and fails on any byte difference. `.gitattributes` marks `dist/**` as generated so it does not pollute review diffs.
- **The Node runtime dependency remains.** This ADR removes the registry, not the runtime. The index, guard, grades, and MCP are TypeScript. ADR-0002 rejected a single static binary because of the schedule; #39 reevaluates it.

  > ✅ **Addressed** (2026-07-28, #39, [ADR-0015](ADR-0015-single-executable-binary.md)). A compiled
  > Node SEA binary (`npm run build:binary`) now covers the no-Node-runtime case for a machine that
  > wants one. It changes nothing here: `git clone` remains the canonical, zero-build distribution,
  > `dist/commitlore.mjs` stays committed and byte-diffed by CI exactly as this ADR describes, and the
  > binary is an additional, uncommitted, reproducible build artifact rather than a second registry or
  > a replacement channel.
- **`package.json` remains.** It is a development artifact required for builds, dependencies, and type checking, not a distribution channel. The `files`/`bin` fields have no effect without a registry.
- The path for implementations in other languages gets stronger — `spec/fixtures/` and `spec/contract-cases/` are the conformance suite, and obtaining them now requires no package manager.
