# ADR-0012 — Drop the native dependency: `better-sqlite3` → `node:sqlite`

Status: accepted, implemented ([#64](https://github.com/MongLong0214/commitlore/issues/64)) · Supersedes nothing · Enables [#39](https://github.com/MongLong0214/commitlore/issues/39)

> ⚠️ **Implemented.** `src/core/index-db.ts` now opens `node:sqlite`'s
> `DatabaseSync`, `better-sqlite3` and `@types/better-sqlite3` are gone from
> `package.json`, and `--external:better-sqlite3` is gone from the bundle
> script. The nested-transaction risk this ADR flagged in "API surface to
> adapt" was real, not hypothetical: the call-graph check found `rebuildIndex`
> nesting into `insertRecords`, and `indexNotes` nesting into both
> `deleteNoteRows` and `insertRecords`. The migration replaced
> `db.transaction()` with a savepoint-based helper (`runInTransaction`) rather
> than assuming a flat depth. The performance figure this ADR's Consequences
> section required to be "re-measured and republished, or withdrawn" was
> withdrawn before this migration (enforced by `scripts/check-readme-numbers.mjs`)
> and was never republished — the README's benchmark section now carries the
> M4 CommitLoreBench measurement (`bench/VERDICT-M4.md`), a different figure
> entirely. Republishing an index-performance number is a separate,
> provenance-checked benchmark run, not part of this change.
>
> The rest of this document is preserved as decision history.

## Context

`better-sqlite3` is the only native module this package depends on. That single
fact costs more than the index it powers:

- **Install requires a compiler.** `npm install` runs `node-gyp` unless a
  prebuilt binary exists for the exact platform, architecture and Node ABI. When
  one does not, installation fails on a machine that has no toolchain — which is
  most machines an agent runs on.
- **A single static binary is impossible.** Node's SEA cannot embed a `.node`
  addon. #39 is blocked on this and on nothing else.
- **It is the layer that keeps breaking.** Of the six defects found in the last
  session, three were in installation and distribution. Removing an entire class
  of installation failure is worth more than any feature on the backlog.

`index-db.ts` already degrades to `--no-index` when the module cannot be loaded,
so the failure has been survivable — but "your index silently does not exist" is
not a state a production tool should ship into.

## Decision

Migrate the index to `node:sqlite` (`DatabaseSync`), which ships inside Node.
The package then has **no native dependency and no compile step**, and #39
becomes reachable.

## Evidence

Measured, not assumed, on both ends of the supported range:

| | Node 22.23.1 | Node 24.18.0 |
|---|---|---|
| `require('node:sqlite')` without a flag | works | works |
| `CREATE VIRTUAL TABLE … USING fts5` | works | works |
| bytes written to **stdout** | 0 | 0 |
| stderr | one `ExperimentalWarning` | silent |

The stdout column is the one that decides it. The MCP server speaks
newline-delimited JSON-RPC on stdout, and one stray byte disconnects the client
with a parse error that names nothing. `node:sqlite` writes none.

**The Node floor stays at 22** (ADR-0010). The expectation before measuring was
that this would force 22 → 24; it does not. The warning on 22 is suppressible
with `--no-warnings` on the bin shebang line, and it goes to stderr, where this
project already sends every diagnostic.

## API surface to adapt

`node:sqlite` is not a drop-in. Four call shapes differ, and all four are
bounded:

| `better-sqlite3` | `node:sqlite` |
|---|---|
| `db.prepare(sql).run/get/all()` | same |
| `db.exec(sql)` | same |
| `db.pragma('journal_mode = WAL')` | `db.exec('PRAGMA journal_mode = WAL')` |
| `db.pragma('quick_check(1)', {simple: true})` | `db.prepare('PRAGMA quick_check(1)').get()` |
| `db.transaction(fn)` | no equivalent — wrap `BEGIN`/`COMMIT`/`ROLLBACK` |

`transaction()` is the only one that is not a rename. `better-sqlite3` gives it
savepoint semantics for nesting; the migration must either preserve that or prove
no call site nests. A transaction helper that silently flattens a nested call
would turn a partial failure into a partial write, which is the failure mode the
index exists to avoid.

There are four call sites (`index-db.ts` lines 613, 751, 784, 843) and none
contains another `transaction(` textually. That is necessary and not sufficient —
a body could call a function that opens one — so the migration owes a call-graph
check before the helper may assume a flat depth, and a test that a nested call
either nests correctly or throws rather than flattening silently.

## Consequences

**Gained.** No compiler at install. A single binary becomes possible (#39). One
fewer dependency whose ABI must track Node's.

**Lost.** `better-sqlite3` is faster on large batch inserts, and the 100k-commit
index build is exactly a large batch insert. The measured p50 query figure in
the README is published from a run against `better-sqlite3`; it must be
re-measured after the migration and republished, or withdrawn. **A performance
claim that survives a change to the engine it measured is not a measurement.**

**Risked.** `node:sqlite` is marked experimental on Node 22. Experimental means
the API may change between minors, and this package would follow it. The
mitigation is the adapter above: every call goes through one module, so a
breaking change has one place to be absorbed.

## Ruled out

**Keeping `better-sqlite3` and shipping platform binaries.** A build matrix of
(platform × arch × Node ABI) is a release process, not a dependency, and it puts
this project in the business of publishing binaries for machines it cannot test
on.

**Dropping the index entirely and always scanning.** The scan path exists and is
correct, but the 100k-commit criterion in PRD-F5 is a query-latency criterion,
and a full scan does not meet it.

**`sql.js` (SQLite compiled to WASM).** Portable and native-free, but it holds
the database in memory and writes it back whole. The index is incremental by
design; a whole-file rewrite on every commit is the opposite of that.
