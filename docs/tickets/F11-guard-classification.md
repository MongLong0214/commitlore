# F11 tickets — Guard experimental-advisory classification (M5)

> ADR: 0020 (guard is an experimental advisory)
> Extends: ADR-0019 (guard signal insufficiency)
> Modules: `src/mcp/server.ts`, `src/core/before-change.ts`, `src/commands/guard.ts`, `README.md`, `README.ko.md`, `README.ja.md`, `README.zh-CN.md`

---

## T-1020 MCP guard tool description: disclose measured limits (S) — #208 · depends on ADR-0020, and merges after T-1009

**Merge sequencing**: this ticket also edits `src/mcp/server.ts`. It merges
last, after T-1007, T-1008 and T-1009 — not in parallel with any of them. See
`docs/GATE-A-ACCEPTANCE.md` "Execution constraint".

**Owns**

- `src/mcp/server.ts` — the `GUARD_TOOL` description string (lines 248–258 at `dd6dfe2`)

**Depends on**

- ADR-0020 accepted (this document)

**Forbidden scope**

- Do not alter the tool's `inputSchema`, `name`, or `annotations` (`READS_ONLY` stays)
- Do not alter any other tool definition in `server.ts`
- Do not change guard's scoring logic, threshold, or exit codes
- Do not touch `src/commands/guard.ts`

**RED test**

- File: `test/mcp.test.ts` (new describe block or addition to existing guard describe)
- Reason: a test asserts the tool description contains "precision 44.8%" and "recall 22.0%" and does NOT contain the phrase "it is a verdict, not an absence". This test must fail on `dd6dfe2` because the current description contains the overclaiming sentence and discloses no measurement.

**Minimum GREEN**

- The `GUARD_TOOL` description:
  1. States "experimental advisory: precision 44.8%, recall 22.0% on the 417-decision corpus"
  2. States that an empty `matched` array does not guarantee the proposal avoids all ruled-out alternatives
  3. Removes the sentence: `An empty \`matched\` array means the check ran and found nothing — it is a verdict, not an absence.`
  4. Retains: "Check a proposal against the Ruled-out records for a path before acting on it. Returns every record whose alternative matches, with the reason it was rejected."
  5. `READS_ONLY` annotation unchanged

**AC <-> test**

| AC | Test assertion | Traces to |
|----|----------------|-----------|
| Description contains precision/recall | `expect(description).toContain('precision 44.8%')` | ADR-0020 §Decision item 2 |
| Overclaiming sentence removed | `expect(description).not.toContain('it is a verdict, not an absence')` | ADR-0020 §Decision item 3 |
| READS_ONLY preserved | `expect(annotations.readOnlyHint).toBe(true)` | ADR-0020 §Consequences |

**Commands**

| scope | command | expected |
|-------|---------|----------|
| focused | `npx vitest run test/mcp.test.ts` | pass, including new assertions |
| full | `npx vitest run` | 45 files, 1500+ passed, 1 skipped |
| release | `npx tsc --noEmit && npx tsc --noEmit -p bench/tsconfig.json` | both exit 0 |
| manual | `node dist/commitlore.mjs --help` | no crash; guard still listed |
| LIVE_NA | N/A — no network, no model, no external service involved | — |

**Evidence invalidation**

- Bound to HEAD `dd6dfe27ff295c497d73f3cf64fbbd4d75ad5d15`. If `src/mcp/server.ts` GUARD_TOOL description changes on a different branch first, rebase and re-verify line numbers.

**Stop / escalate**

- If the tool description format has changed upstream (different line numbers, refactored into a separate file), stop and re-read before editing
- If removing the sentence changes the JSON schema contract in any way, escalate — description is documentation, not contract

**Safety checks**

| check | response |
|-------|----------|
| fail-closed | If the new description cannot be constructed, the old one stays — never ship a blank description |
| wrong-target | Only `GUARD_TOOL` is touched; a diff touching `QUERY_TOOL` or `STALE_TOOL` is wrong |
| ambiguity | The exact sentence to remove is quoted in ADR-0020; no fuzzy matching |
| timeout | Single-file change; no build time risk |
| partial state | The description is a single string literal; it is atomic |
| privacy | No PII in tool descriptions |
| prompt injection | The description is a static string, not user input; no injection surface |

**Completion evidence**

- `git diff src/mcp/server.ts` shows exactly the description change
- `npx vitest run test/mcp.test.ts` passes with new assertions
- `npx tsc --noEmit` exits 0
- Full test suite: 45 files, 1500+ passed, 1 skipped

---

## T-1021 README Known limitations: disclose guard precision and recall (S) — #209 · depends on ADR-0020, ordering with T-1014/T-1015

**Owns**

- `README.md` — Known limitations section (line 281+ at `dd6dfe2`)
- `README.ko.md` — 알려진 제한 사항 section (line 281+ at `dd6dfe2`)
- `README.ja.md` — 既知の制限事項 section (line 281+ at `dd6dfe2`)
- `README.zh-CN.md` — 已知限制 section (line 281+ at `dd6dfe2`)

**Depends on**

- ADR-0020 accepted (this document)

**Depends on / ordering**

- T-1014 and T-1015 (from F10 README positioning, P0-6) also touch lines in these four README files. **This ticket adds a bullet to the Known limitations section; T-1014/T-1015 reorder sections.** Ordering constraint: if both land in the same cycle, T-1021 should merge first (it adds content to an existing section) or T-1014/T-1015 must carry the new bullet forward in their reorder. Record this in PR description to prevent merge conflicts.

**Forbidden scope**

- Do not reorder, rewrite, or delete any existing Known limitations bullet
- Do not touch any section outside Known limitations in any README file
- Do not alter the `BENCH:BEGIN`/`BENCH:END` block (byte-checked by `scripts/check-readme-numbers.mjs`)
- Do not change guard's code, scoring, or behaviour

**RED test**

- File: `test/readme.test.ts` (new file or addition to existing)
- Reason: a test reads all four README files and asserts each Known limitations section contains a bullet mentioning "guard" with "precision 44.8%" and "recall 22.0%". This test must fail on `dd6dfe2` because no README currently mentions guard's measured accuracy.

**Minimum GREEN**

- Each of the four README files has a new bullet in Known limitations:
  - English: `- Guard (ruled-out alternative matching) is an experimental advisory: precision 44.8%, recall 22.0% on the 417-decision corpus (ADR-0020). A match is a lead to inspect, not a verdict.`
  - Korean, Japanese, Chinese: equivalent translations with the same numbers and ADR citation

**AC <-> test**

| AC | Test assertion | Traces to |
|----|----------------|-----------|
| EN README mentions guard precision | `expect(readmeEn).toMatch(/guard.*precision 44\.8%/i)` | ADR-0020 §Decision item 2 |
| EN README mentions guard recall | `expect(readmeEn).toMatch(/recall 22\.0%/i)` | ADR-0020 §Decision item 2 |
| KO README mentions guard precision | same pattern on `README.ko.md` | ADR-0020 §Decision item 2 |
| JA README mentions guard precision | same pattern on `README.ja.md` | ADR-0020 §Decision item 2 |
| ZH README mentions guard precision | same pattern on `README.zh-CN.md` | ADR-0020 §Decision item 2 |
| Existing bullets unchanged | snapshot or line-count check | Forbidden scope |

**Commands**

| scope | command | expected |
|-------|---------|----------|
| focused | `npx vitest run test/readme.test.ts` | pass |
| full | `npx vitest run` | 45 files, 1500+ passed, 1 skipped |
| release | `npx tsc --noEmit && npx tsc --noEmit -p bench/tsconfig.json` | both exit 0 |
| manual | Visually inspect each README's Known limitations section | guard bullet present with correct numbers |
| LIVE_NA | N/A — static file edit, no network or model | — |

**Evidence invalidation**

- Bound to HEAD `dd6dfe27ff295c497d73f3cf64fbbd4d75ad5d15`. If any README's Known limitations section is edited on another branch first, rebase and carry the bullet forward.

**Stop / escalate**

- If `scripts/check-readme-numbers.mjs` fails after the edit, the change touched the BENCH block — revert and re-check line targeting
- If T-1014/T-1015 have already merged and moved the Known limitations section, re-read line numbers before applying

**Safety checks**

| check | response |
|-------|----------|
| fail-closed | If a README cannot be edited cleanly, do not force — stop and report |
| wrong-target | Only the Known limitations section in each file; a diff touching install, BENCH, or Contributing is wrong |
| ambiguity | The bullet text is specified exactly in Minimum GREEN |
| timeout | Four static file edits; no build time risk |
| partial state | All four files must be edited atomically in one commit; a PR with fewer than four is incomplete |
| privacy | No PII |
| prompt injection | Static content addition; no user-controlled input |

**Completion evidence**

- `git diff README.md README.ko.md README.ja.md README.zh-CN.md` shows exactly four new bullets
- `node scripts/check-readme-numbers.mjs` passes (BENCH block untouched)
- `npx vitest run` full suite passes
- Visual inspection: each Known limitations section contains the guard disclosure bullet

---

## T-1022 CLI guard surface: experimental-advisory wording (S) — #210 · depends on ADR-0020

**Owns**

- `src/commands/guard.ts` — `.description()` string, `formatMatches()` header, `--help` after-text
- No other command files

**Depends on**

- ADR-0020 accepted (this document)

**Forbidden scope**

- Do not change guard's scoring logic, threshold, signals, or exit codes
- Do not alter `--json` output schema (score stays in JSON)
- Do not add/remove CLI options beyond what is specified
- Do not touch `src/mcp/server.ts` (that is T-1020)
- Do not make guard blocking or add it to any default path

**RED test**

- File: `test/guard.test.ts` (additions to existing test file)
- Reason: tests assert that (a) `--help` output contains "experimental advisory", (b) text output for a match uses "possible match" (not just "matches"), (c) text output does NOT contain a numeric score (score is in `--json` only). These must fail on `dd6dfe2` because current help says "flag a proposal that revives an alternative already ruled out" with no experimental qualifier, `formatMatches` header says "alternatives match", and text output includes `(score X.XX; ...)`.

**Minimum GREEN**

1. `.description()` updated to: `'[experimental advisory] flag a proposal that may revive a ruled-out alternative (precision 44.8%, recall 22.0%)'`
2. `formatMatches()` header changed from "ruled-out alternatives match this proposal" to "possible matches against ruled-out alternatives (experimental — precision 44.8%, recall 22.0%)"
3. Default text output (`formatMatches`) no longer prints `(score X.XX; signals)` — the `recorded:` line omits the score and signal list
4. `--json` output retains the full `score` and `signals` fields unchanged
5. `--help` after-text unchanged (exit codes)

**AC <-> test**

| AC | Test assertion | Traces to |
|----|----------------|-----------|
| Help text says experimental | `expect(helpOutput).toContain('experimental advisory')` | ADR-0020 §Decision item 2 |
| Help text contains precision | `expect(helpOutput).toContain('precision 44.8%')` | ADR-0020 §Decision item 2 |
| Text output says "possible match" | `expect(stderr).toMatch(/possible match/)` | ADR-0020 §Decision item 1 |
| Text output omits numeric score | `expect(stderr).not.toMatch(/score \d+\.\d+/)` | ADR-0020 §Decision item 4 |
| JSON output retains score | `expect(json.matches[0].score).toBeTypeOf('number')` | ADR-0020 §Decision item 4 |
| Exit codes unchanged | existing exit-code tests still pass | Forbidden scope |

**Commands**

| scope | command | expected |
|-------|---------|----------|
| focused | `npx vitest run test/guard.test.ts` | pass, including new assertions |
| full | `npx vitest run` | 45 files, 1500+ passed, 1 skipped |
| release | `npx tsc --noEmit && npx tsc --noEmit -p bench/tsconfig.json` | both exit 0 |
| manual | `node dist/commitlore.mjs guard --help` | shows "[experimental advisory]" and precision/recall |
| manual | `echo '{"tool_input":{"new_string":"use stateless JWT"}}' \| node dist/commitlore.mjs guard --hook-input` | if match occurs, no numeric score in text; JSON mode shows score |
| LIVE_NA | N/A — local CLI, no network or model | — |

**Evidence invalidation**

- Bound to HEAD `dd6dfe27ff295c497d73f3cf64fbbd4d75ad5d15`. If `src/commands/guard.ts` `formatMatches` or `.description()` changes on another branch first, rebase and re-verify.

**Stop / escalate**

- If removing score from text output breaks any existing test that asserts on score format in stderr, update those tests (they are testing presentation, not logic)
- If any downstream consumer (hook protocol, MCP) parses stderr for score, escalate — but the hook output is JSON (`formatHookContext` does not include numeric score today)

**Safety checks**

| check | response |
|-------|----------|
| fail-closed | If the text format change cannot compile, revert — never ship a guard that crashes |
| wrong-target | Only `guard.ts` presentation functions; a diff touching `core/guard.ts` scoring is wrong |
| ambiguity | Exact new strings specified in Minimum GREEN |
| timeout | Single-file change; no build time risk |
| partial state | All three changes (description, header, score removal) ship together; partial is not acceptable |
| privacy | No PII in CLI output |
| prompt injection | CLI text is static; proposal content is not echoed into the header |

**Completion evidence**

- `git diff src/commands/guard.ts` shows description, header, and score-format changes only
- `npx vitest run test/guard.test.ts` passes with all new assertions
- `node dist/commitlore.mjs guard --help` shows experimental advisory wording
- Full test suite: 45 files, 1500+ passed, 1 skipped
- `npx tsc --noEmit` exits 0

---

## T-1024 Unified `commitlore_before_change` MCP tool (M) — #219 · depends on T-1007, T-1008, T-1009, T-1020

Ticketed to close acceptance row `P0-8`, which stays OPEN work until this ticket's acceptance
criteria are met. The source review asks for one tool an agent has to remember
instead of a separate context call and guard call. The reason this ticket is here rather than in
F9 is that its hard problem is not composition, it is **confidence separation**: it returns
path-scoped context, whose measured behaviour is trustworthy, in the same payload as a guard
result measured at 44.8% precision and 22.0% recall. ADR-0020 demoted that signal to an
experimental advisory in the same milestone.

The separation is **structural, not a second label**. The response carries exactly the five
fields the source review specifies — `active_decisions`, `verification_gaps`,
`possible_revival_matches`, `guard_confidence`, `cache_key` — and no others. `guard_confidence`
qualifies `possible_revival_matches` and nothing else. `active_decisions` and
`verification_gaps` are path-scoped context and never inherit it. No `context_confidence` field
is invented to make the asymmetry visible: the schema is the asymmetry, and a caller that reads
`guard_confidence` as applying to the context fields is reading a field that does not describe
them.

**Owns**: `src/core/before-change.ts` (new — composes the existing context projection and guard match; contains no new scoring logic of its own), `src/mcp/server.ts` (register one additional tool), `test/before-change.test.ts` (new).

**Depends on**: T-1020 (#208) — guard's measured limits must already be stated on the MCP surface before a second tool exposes the same signal, or this ticket ships the overclaim ADR-0020 removes. Also T-1007 (#199), T-1008 (#200), T-1009 (#201) for `src/mcp/server.ts` merge ordering only: this ticket is last in that queue and adds nothing to the capture pipeline.

**Forbidden scope**: No new scoring, weighting or threshold logic — ADR-0019 closed re-weighting, and this ticket must not reopen it by the back door. Do not change `src/core/guard.ts`, the context projection's own output, `src/commands/guard.ts`, the release gate, `bench/fixtures/`, `README*`, or any version string. Do not make the tool blocking, and do not give it a write side.

**RED test**: `test/before-change.test.ts` — "the response carries exactly `active_decisions`, `verification_gaps`, `possible_revival_matches`, `guard_confidence`, `cache_key`; `guard_confidence` is `\"experimental\"` when a proposal is supplied and `\"not-run\"` when none is; and the two context fields are byte-identical across both calls at one HEAD". It must fail before the change because `commitlore_before_change` is not registered and `src/core/before-change.ts` does not exist.

**Minimum GREEN**: Export `beforeChange({ path, proposal? })` from `src/core/before-change.ts` returning `{ active_decisions, verification_gaps, possible_revival_matches, guard_confidence, cache_key }`. The five fields are exactly those named above; adding a sixth is out of scope.

`guard_confidence` is an enum over that one field: `"not-run"` when no `proposal` was supplied, `"experimental"` when the guard ran, `"timed-out"` when it was cut short. `"not-run"` does not violate the context-only contract — it is the honest value of a field describing a list that is empty because nothing was asked, and it exists so that an empty `possible_revival_matches` is never readable as "checked and clear". The context fields are populated identically whether or not a proposal was supplied.

`cache_key` is a **full-response** key: when a `proposal` is supplied it is derived from HEAD, the resolved path **and the normalised proposal text**, so two different proposals at one HEAD cannot collide. When no proposal is supplied the same field is a context-snapshot key over HEAD and path only, and it must never be used to serve a proposal-bearing response — the key's two forms are distinguishable and a proposal-dependent result may only be served from a key that included a proposal. Register the tool in `src/mcp/server.ts` with `readOnlyHint: true`.

**AC ↔ test**:

| AC | Test | Source |
|---|---|---|
| Context-only call returns context and runs no guard | `no proposal returns empty matches and guard_confidence "not-run"` | Source review §8 P0-8 |
| Proposal call adds matches labelled experimental | `proposal returns matches with guard_confidence "experimental"` | Source review §8 P0-8; ADR-0020 |
| The response carries exactly the five source-specified fields | `response keys equal the five specified fields, no more` | Source review §8 P0-8 |
| `guard_confidence` qualifies only `possible_revival_matches` | `context fields are identical with and without a proposal at one HEAD` | ADR-0020 — context must not inherit the advisory grade |
| A proposal-bearing result is never served from a context-only cache key | `context-snapshot key does not serve a proposal response` | Determinism plus the cache-scope rule above |
| The resolved path selects that path's context and no other | `call for path A returns A's records, never B's` | Wrong-target check below — proven by selection, not by echoing the path |
| An unreadable repository or an out-of-tree path fails explicitly | `path outside the repository fails rather than returning empty context` | Fail-closed check below — an empty context must never read as "no constraints" |
| An empty match list is never presented as a verdict | `empty matches do not assert the proposal is safe` | ADR-0020, the sentence it removes from the guard tool |
| Identical input is byte-identical output | `two calls at one HEAD produce identical payloads` | The determinism guarantee the inject path already holds |
| The tool is annotated read-only | `tool annotation readOnlyHint is true` | It has no write side by design |

**Commands**:
- Focused: `npx vitest run test/before-change.test.ts`
- Full: `npx vitest run` — no regression against the baseline established at the branch head
- Release: `npx tsc -p tsconfig.json --noEmit` exit 0; `npx tsc -p bench/tsconfig.json --noEmit` exit 0
- Manual: one MCP round trip over stdio calling the tool with and without a proposal, both payloads pasted as completion evidence

**Evidence invalidation**: Bound to the exact head SHA. Void if T-1020 changes guard's disclosure wording after this lands, since the two surfaces must agree.

**Stop / escalate**: Stop if the confidence-separation rule cannot be expressed in the payload without a caller being able to read the guard result as authoritative — that is the failure this ticket exists to prevent, and shipping it anyway would contradict ADR-0020. Stop if T-1020 has not merged.

**Safety checks**: *Fail-closed* — when the repository cannot be read, or notes are unfetched, the tool reports the gap rather than returning an empty context that reads as "no constraints"; this is the project's oldest defect class. *Wrong-target* — no echo field is added; the schema stays at five. Instead the resolved input path is proven to select the right context: a call for one path must not return another path's records, and a path outside the repository, or a repository the process cannot read, must fail explicitly rather than return an empty context that reads as "no constraints". *Ambiguity* — `guard_confidence: "not-run"` exists precisely so an empty `possible_revival_matches` is never confused with a clean one, and the field is never omitted. *Timeout* — the guard leg is bounded, and on expiry the response returns context with `guard_confidence: "timed-out"` rather than dropping the field or emptying the context. *Partial state* — read-only; there is no state to leave partial. *Security and privacy* — no write side, no network, no model call, and free-text trailer content stays subject to the existing injection withholding rules.

**Completion evidence**: `npx vitest run test/before-change.test.ts`, both typecheck exits, the full-suite summary line at one exact head SHA, and the two manual MCP payloads.
