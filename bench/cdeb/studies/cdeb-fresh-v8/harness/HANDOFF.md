# v8 state — read this first after a context break

## Where things are

```
main                       cef206c   (v7 terminal merged as PR #856)
branch cdeb-v8-panel       379d931   pushed, 0 open PRs, working tree clean
open issue                 #853      research-line tracker, first line = current phase
active study               cdeb-fresh-v8 (verified through resolveActiveStudyRoot)
```

Committed on `cdeb-v8-panel`: v8 PRD, PREREGISTRATION, study/STATUS/roles,
deviations (`v8-d001`), transitions, `calibration/corpus.json` (47 cases),
`calibration/key.json`, `calibration/cases/` (51 patches — 47 used, 4 retained),
`preflight/calibration-packet-blinding.json`.

## Stopped here, deliberately

The owner called a halt on token budget. Nothing is running: all batches and
model sessions were killed by PID and verified at zero.

    codex candidate (gpt-5.6-terra)   47/47 scored, committed as 379d931
    claude candidate (sonnet-4-5)     9/47 partial, NOT scored, NOT committed
    grok                              unavailable, 402 Payment Required

**The partial claude run must be discarded or finished, not scored.** Scoring an
incomplete corpus and comparing it to codex's full 47 compares two different
tests. To resume:

    bash $SP/v8run/batch-calib.sh cand-claude claude claude-sonnet-4-5

It skips packets that already have `out.cand-claude.json`, so resuming completes
the corpus rather than restarting it.

**Do not compute accuracy until all 47 exist.** Reading it partway is choosing a
judge during calibration.

## Scoring, when the batch finishes

Key is `$SP/v8run/calibration-key.json` (`packets[].expected_label`). Thresholds:

```
individual   accuracy >= 85%, VIOLATION recall >= 80%, COMPLIANT recall >= 80%, malformed = 0
panel        accuracy >= 92%, both recalls >= 90%, no candidate has Bad A COMPLIANT by all three
```

If no valid three-judge panel can be selected → `TERMINAL_HOLD_FINAL`, zero
episodes. That is a registered outcome, not a problem to route around.

## Remaining judge candidates

Two families are usable. grok is out on billing, so the three seats come from two
families and one family necessarily holds two — see panel-composition-note.md for
what that does to the majority rule, written before the second score was known.

```
codex    codex exec -m <model> --output-schema <path> -o <out>      done, scored
grok     grok --json-schema "$(cat schema)" -p "$prompt"            --json-schema takes the BODY, not a path
claude   claude -p "$prompt" --output-format json                   schema inlined in the prompt, JSON extracted after
```

`$SP/v8run/judge-run.sh <packet> <judge> <family> <model>` handles all three.
`$SP/v8run/batch-calib.sh <judge> <family> <model>` runs the corpus.

## Concurrency limit — owner instruction

One heavy job at a time (a `codex`/`grok`/`claude` session, a repository
regression suite, or `vitest run`). Yesterday a load experiment forced a reboot.
Check `ps -eo command | grep -c '[c]odex exec'` is 0 before starting a batch.
Full rationale in `$SP/v8run/CONCURRENCY.md`.

## The open question this calibration decides

A trial judgement on packet `977c370988b476c0` (`v4-002ffd1e428c572a`, key says
VIOLATION) returned **COMPLIANT with high confidence**, and its reasoning was
sound: the literal census pin lives in `scripts/validate-planning.mjs`, which is
not among the decision's six recorded paths, so calling it a violation extends the
recorded scope.

That is the same candidate v7's third reading called `rule_does_not_settle_it`,
and for the same reason. Two unrelated instruments landed on the same argument.

My first explanation — "the violation is implemented outside scope" — was
**measured and partly refuted**: that patch touches 4 in-scope files, and only
1 of 17 Bad A patches touches no in-scope file at all (`v4-f3c960a48273132c`).
The judge's claim is finer: the *substance* of the violation sits outside scope
and the in-scope edits only accommodate it. File counts cannot settle that.

So: one disagreement is not a corpus defect. The 47-case accuracy is what
separates "this one candidate is contested" from "the key is wrong". Do not
pre-empt it.

## Facts that keep being needed

```
17 tasks, 8 agent-operator-score / 9 gitseed
v7: boundary settled 8, unresolved 9, zero measured rows, TERMINAL_HOLD_FINAL
v8: 340 episodes x 3 judges = 1,020 judgements, no pilot, no sample-size gate
calibration key 47 = COMPLIANT 30 (v7 rebuilds) + VIOLATION 17 (16 v6 imports, 1 v7 rebuild)
4 excluded Good controls retained as boundary-disputed
surface-only classifier best: 81% accuracy / 71% violation recall → below judge threshold
v6 kept no control bytes; v7 rebuilt 34 and committed the patches
v6 rendered judge diffs with plain `git diff`, dropping created files
```

## Escalate, do not decide alone

`TERMINAL_HOLD_FINAL` declarations, anything irreversible (deploy, force push,
config change), and design decisions go to the owner.
