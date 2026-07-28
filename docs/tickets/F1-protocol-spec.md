# F1 tickets — Protocol v2 spec + conformance suite (M1)

> PRD: `docs/prd/PRD-F1-protocol-spec.md` · ADR: 0001, 0005, 0006
> Repository layout: `spec/SPEC.md`, `spec/schema/record.schema.json`, `spec/fixtures/`, `spec/contract-cases/`

---

## T-101 SPEC.md: canonical grammar + vocabulary + enums (M) — #1

**Purpose**: a single canonical source that produces the same behavior regardless of who implements it.

**Implementation outline**
- `spec/SPEC.md` structure: ①overview ②grammar (EBNF — git interpret-trailers-compatible subset, multiline folding = leading whitespace on continuation lines) ③vocabulary table ④canonical enums ⑤extensions (`X-`) ⑥consumer-route table ⑦versioning (`CommitLore-Version: 2.0`).
- 16 vocabulary types and their value grammar:
  - Decision context: `Limit` `Ruled-out` (`alt | reason` required) `Warn` `Certainty` (firm|tentative|guess) `Blast` (local|module|system) `Undo` (easy|costly|permanent) `Verified` `Unverified` `Follows` (Record-Id reference)
  - Identity, lifetime, and evidence: `CommitLore-Version` (semver) `Record-Id` (`r-[a-z0-9]{6,}`) `Supersedes` (Record-Id) `Expires` (`YYYY-MM-DD | condition description`) `Evidence` (path#anchor or URL) `Provenance` (authored|inherited <sha>|reconstructed|unknown)
- **Consumer-route table (no dead fields)**: for every vocabulary term, specify at least 1 {consumer route, resulting action}. Examples: `Blast=system ∧ Undo=permanent → approval-gate routing (F5/F6)`, `Ruled-out → commitlore guard match (F4)`, `Supersedes/Expires → stale fold (F2)`.

**Detailed work**
- [ ] Compare draft EBNF with actual `git interpret-trailers --parse` behavior (boundaries: whitespace after colon, folding, duplicate keys)
- [ ] Confirm enum values are words that direct behavior (ADR-0008 design decision 3)
- [ ] Write the route table + confirm 0 vocabulary terms without consumers

**Test/verification**: include every SPEC example block in T-102 fixtures for mechanical verification.
**AC**: PRD-F1 requirements 1~4. 0 blank route cells in the vocabulary table.

---

## T-102 JSON Schema + parser round-trip fixtures (M) — #2 · depends on T-101

**Purpose**: a mechanically verifiable form of the spec.

**Implementation outline**
- `spec/schema/record.schema.json` — schema for a record (parsed trailer set). draft 2020-12.
- `spec/fixtures/valid/*.txt` (10) `boundary/*.txt` (5) `invalid/*.txt` (5) + expected JSON `*.expected.json`.
- Required cases: multiline Warn folding / repeated Limit / `Ruled-out` pipe rule / trailer-like prose in the body (classified as non-trailer, D2) / reject D1 drift vocabulary (`wide`,`migration-needed`) / reject `Certainty: yes` / accept X- extension.
- Round-trip contract: parse→canonical serialize→parse results are identical (JSON comparison).

**AC**: 20 fixtures, including a script (`spec/verify.sh`) that passes schema validation with the `ajv` CLI.

---

## T-103 Define route-contract test cases (S) — #3 · depends on T-101

**Purpose**: guarantee behavioral equivalence between implementations with cases, not documentation.

**Implementation outline**
- `spec/contract-cases/*.yaml` — `{given: [records], when: <route>, expect: <output>}` format.
- 8+ cases:
  1. stale: a constraint retired by Supersedes is inactive
  2. stale: an Expires date in the past is inactive
  3. stale: prose-condition Expires remains active + flag
  4. stale: newest value wins for the same Record-Id
  5. demotion: Warn with `Provenance: unknown` → claim
  6. demotion: Warn in an external contribution commit → claim (even from a trusted committer)
  7. routing: `Blast: broad ∧ Undo: difficult` → `needs-approval` flag
  8. routing: a reconstructed record is always a claim when injected

**AC**: structure allows F2 (T-205) and F5 (T-501) to load this YAML directly and run it as tests.
