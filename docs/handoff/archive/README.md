# Superseded handoffs

These were current when written and are not now. They are kept because each one
records why a decision was made, and that reasoning survives the state it
described.

| file | was about | superseded by |
|---|---|---|
| `2026-08-14-cto.md` | the state before 0.9.0 | v1.0.0 shipped instead |
| `2026-08-14-release-0.9.0.md` | 0.9.0 scope and its conditions | v1.0.0 |
| `20260815-commitlore-state.md` | in-flight work on 8/15 | `../20260815-after-v1.md` |
| `20260815-gate-plan.md` | the Gate 1–5 plan to v1.0.0 | v1.0.0 and v1.0.1 shipped |
| `20260728-roadmap-to-done.md` | the road to v1.0.0, from `docs/` | v1.0.0 shipped |
| `20260731-handoff.md` | the state on 7/31, from the repository root | v1.0.0 shipped |
| `20260814-a-to-z-review.md` | a full review on 8/14, from the repository root | v1.1.x shipped; `docs/PRODUCTION-READINESS-SSOT.md` owns the contract |

The last three sat outside this directory — two at the repository root and one
in `docs/` — where nothing linked them and their names read as current guidance.
That is the shape this directory exists to prevent: a reader who opens
`HANDOFF.md` at the root has no way to tell it stopped being true in July.

`COMMITLORE_FULL_APPLY_ORDER_20260814.txt` was deleted rather than moved. It was
an ordered list of commands for one agent on one afternoon, and Git history is
the archive for that.

The current one is `docs/handoff/20260815-after-v1.md`. For what the product
claims today, read `docs/PRODUCTION-READINESS-SSOT.md` — a handoff describes a
moment, and that file describes the product.
