# F4 tickets — Agent Fabric (M3)

> PRD: `docs/prd/PRD-F4-agent-fabric.md` · ADR: 0006
> Modules: `src/mcp/server.ts`, `src/hooks/{inject,harvest,verify,guard}.ts`, `skills/`

---

## T-401 commitlore-mcp server (M) — #12 · depends on T-204

**Implementation outline**
- `commitlore mcp` subcommand = stdio MCP server (`@modelcontextprotocol/sdk`).
- Resource: `commitlore://context/<path>` → `--json` result from T-204 context.
- Tools: `commitlore_query(kind, path?)`, `commitlore_stale()`, `commitlore_guard(proposal, path)`.
- 0 network access; repository root is the process cwd.

**Test**: manual round trip with MCP Inspector + automated resource/tool call snapshots with a JSON-RPC stub.
**AC**: PRD-F4 requirement 1.

---

## T-402 Injection hook (M) — #13 · depends on T-204, T-501

**Implementation outline**
- `commitlore inject --path <p> [--budget <tok>]` — deterministic projection: fold active records → fixed-template summary (grade routing: directive/claim/held, exclude stale) → when over budget, truncate by priority (Warn > Limit > Ruled-out > other).
- Claude Code integration: `commitlore hooks install --claude` creates a PreToolUse(Read|Edit|Write) hook entry in settings (extract path → call inject, output as additionalContext).
- **Determinism guarantee**: 0 LLM calls, same input → byte-identical output (cache key = HEAD sha + path).

**Test**: identity (diff 0 across 2 runs) / budget-truncation priority / stale and blocked records excluded / hook installation idempotence.
**AC**: PRD-F4 AC 1.

---

## T-403 Automatic harvest draft (L) — #14 · depends on T-201

**Implementation outline**
- `commitlore harvest --transcript <f> --diff <f> [--out <f>]` — generate draft records from transcript+diff.
- Executor: **the user's existing agent session** (a prompt contract through which the skill/hook delegates to the current session's model). The CLI itself has no LLM key — if no LLM is available, skip silently (exit 0, empty output).
- Draft format: each record must include an `evidence` field (transcript line range/diff hunk citation) → T-404 input.
- Pre-commit connection: simplify `commitlore hooks install --claude` so it is called from a **commit-time skill** (rewritten commitlore-commits) rather than Stop/PreCompact.

**Test**: fixed transcript fixture → draft-output contract (fields exist and include evidence) / no-LLM skip path.
**AC**: satisfy the prerequisite for the PRD-F4 AC (harvest pipeline).

---

## T-404 Harvest verifier (M) — #15 · depends on T-403

**Implementation outline**
- `commitlore harvest-verify --draft <f> --transcript <f> --diff <f>` — **mechanical verification**: ①evidence citation exists in the actual source (string/hash comparison) ②Ruled-out checks for a rejection-context marker ③enum is valid (reuse T-202). Discard failed records + log reason.
- Bounded repair: feed failure reason back to the draft generator ≤ 2 times → on final failure, proceed without a record (log only, do not block commit).
- Maker-checker separation: verify runs an LLM-independent deterministic check 1st and an (opt-in) adversarial verification prompt in the session 2nd.

**Test**: discard fabricated record (nonexistent citation) / repair loop terminates / all-failed case does not block.
**AC**: PRD-F4 AC 2.

---

## T-405 commitlore guard (M) — #16 · depends on T-204

**Implementation outline**
- `commitlore guard --proposal <text|file> -- <path>` — deterministically match against Ruled-out records for that path (normalized-token Jaccard + Record-Id/keyword hit); when over threshold, output a `{matched, sha, reason}` warning, exit 2 (warning-only code).
- PreToolUse hook mode: apply to proposed Edit text.

**Test**: share the F7 revisit fixture — emits on matching scenario / <1 false positive among 10 unrelated proposals.
**AC**: PRD-F4 AC 3.

---

## T-406 Clean-room rewrite of 3 skills (S) — #17 · depends on T-204

**Implementation outline**
- `skills/commitlore-commits|commitlore-query|commitlore-setup/SKILL.md` — **do not use text from the original repository (clean room)**; all internal behavior calls the CLI (`commitlore validate/context/harvest`); 0 marketing language such as star prompts (D10).
- commitlore-commits includes instructions for using the harvest pipeline (T-403→404).

**Test**: install with `npx skills add` (local path) → smoke-trigger all 3 in Claude Code.
**AC**: PRD-F4 AC 4.
