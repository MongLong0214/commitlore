# What this repository caught in itself

CommitLore exists because coding agents re-propose decisions a team already
settled. The obvious question is whether the tool's own repository is any
better, and the honest answer is that it is not — it is just written down.

This page is the written-down part. Every entry is a real issue in this
repository, filed against this project, most of them by the agents working on
it. Nothing here is hypothetical and nothing is redacted, including the entries
where the thing that turned out to be false was something this project had
already published.

Read it as the demo. A tool that preserves engineering judgment should be able
to show what preserving it caught.

---

## 1. Claims that turned out to be false

The uncomfortable category, and the reason this page leads with it.

**[#415](https://github.com/MongLong0214/commitlore/issues/415) — no install could produce the trust tier the README's claims rested on.**
Records reach an agent graded `directive`, `claim` or `blocked`. `directive`
means "treat this as a constraint" and is where the security model lives. It
turned out that no installed surface configured a directive author string,
grading failed closed to `claim` for everything, and **the `[directive]` path had never been
delivered to a single user or measured by a single benchmark arm** — while the
injected legend went on advertising it. Both prior benchmarks measured
`claim`-graded delivery. Fixed in 0.7.0; the earlier numbers stay labelled for
what they were.

**[#343](https://github.com/MongLong0214/commitlore/issues/343) — no evidence that a fresh agent recovers the decisions a repository holds.**
Filed from an external review of v0.5.0, against the absence of evidence for the
product's central premise: the review granted that lifecycle, attachment,
grading and rebase-survival were proved, and said the thing the product is *for*
was not. The behaviour study it asked for is the one still running.

**[#341](https://github.com/MongLong0214/commitlore/issues/341) — the `suggest` policy named an approval that nothing could enforce.**
A configuration value implied a human consent step the code had no way to check.

**[#342](https://github.com/MongLong0214/commitlore/issues/342) — anti-entropy review was claimed nowhere and implemented nowhere.**
The issue's own instruction was "decide which" rather than "add it".

**[#323](https://github.com/MongLong0214/commitlore/issues/323) — the READMEs called musl unsupported; the executed evidence said otherwise.**

**[#359](https://github.com/MongLong0214/commitlore/issues/359) — `capture --help` said `--diff` defaults to empty. It defaults to the staged diff.**

---

## 2. The product shipped broken, and the repository caught it

**[#422](https://github.com/MongLong0214/commitlore/issues/422) — the pre-push hook hung every `git push`.**
`sync`'s push re-triggered the hook that called it. 1,240 hook invocations in
40 seconds. It shipped because the function had been tested eleven times and
the hook path zero times.

**[#428](https://github.com/MongLong0214/commitlore/issues/428) — a non-executable `COMMITLORE_BIN` killed the git operation sitting next to it.**
A tool whose failure mode is "your commit does not happen" is worse than no
tool.

**[#409](https://github.com/MongLong0214/commitlore/issues/409) — anyone who could write `refs/notes` could forge a `directive`.**
Notes-sourced records inherited the annotated commit's author trust rather than
the note writer's. The first fix was incomplete and left the forgery open one
merge later; it was caught by testing against git instead of shipping a caveat.

**[#408](https://github.com/MongLong0214/commitlore/issues/408) — the injection guard matched a literal phrase**, so an attack paraphrase was served as `directive` while a benign paraphrase was blocked.

**[#420](https://github.com/MongLong0214/commitlore/issues/420) — concurrent hooks made half the injections fall back to a full scan**, because the index had no SQLite busy timeout.

**[#417](https://github.com/MongLong0214/commitlore/issues/417) — the notes refspec `doctor --fix` wrote was forced**, so an ordinary `git fetch` silently destroyed unpushed records.

**[#352](https://github.com/MongLong0214/commitlore/issues/352) — the commit-msg hook blocked commits in a shallow clone.**

**[#321](https://github.com/MongLong0214/commitlore/issues/321) — on Windows the commit-msg hook hung instead of returning.**

---

## 3. The evidence measured the wrong thing

**[#441](https://github.com/MongLong0214/commitlore/issues/441) — the analyser read every `.jsonl` in the results directory.**
The registered M5 analysis would have run over **1,835 rows from four different
experiments** — including one file explicitly marked non-citable and two from
withdrawn studies. Worse, the stopping rule was `rows >= 1160`, so *the
contamination would have made the study pass its own completeness gate* under a
line reading "1835 of the registered 1160". Analysis inputs are now a named
list from the freeze manifest, never a directory scan.

**[#392](https://github.com/MongLong0214/commitlore/issues/392) — the result-schema gate was not run by anything.**
No npm script, no CI step. The schema drifted five fields behind the runner and
a failing results file sat in the tree for two days. *A gate nobody can check is
a slogan.*

**[#335](https://github.com/MongLong0214/commitlore/issues/335) — the index ingested any `key: value` line as a trailer**, so `doctor` reported 106 records where git had 0.

**[#403](https://github.com/MongLong0214/commitlore/issues/403) — `backfill` printed "0 note trailers" for a gap and then selected its targets from that same index.**

---

## 4. The first screen lied

**[#402](https://github.com/MongLong0214/commitlore/issues/402) — `init` reported ready on an unfetched mirror without saying so.**
The first screen a new user meets.

**[#527](https://github.com/MongLong0214/commitlore/issues/527) — unattended capture was reported as enabled even though an ordinary Git commit could never start it.**
The policy authorised an agent host to stage a verified record, but the hooks
only applied and finalised a transaction that already existed. They cannot
obtain the host transcript capture requires. `init`, `auto status` and `doctor`
now name that prerequisite instead of treating the policy or pre-edit hook as
an initiator.

**[#400](https://github.com/MongLong0214/commitlore/issues/400) — `index --rebuild` reported unqualified success on a mirror it could not read**, and the docs said it always would.

**[#345](https://github.com/MongLong0214/commitlore/issues/345) — a first-time visitor landed on `dev`, not on the released product.**

**[#433](https://github.com/MongLong0214/commitlore/issues/433) — the installed plugin was pinned three releases behind**, so no fix had reached the user who installed it.

**[#354](https://github.com/MongLong0214/commitlore/issues/354) — `hooks uninstall` removed one of the three hooks `init` installs**, leaving two behind.

---

## What this costs to maintain

Every entry above is a `Ruled-out:`, `Warn:` or `Limit:` line in a commit
trailer, validated by the same hook this project asks you to install, and
readable with the same command:

```bash
commitlore context <path>
```

The discipline is not free. It has produced several rounds of "the fix was
incomplete and the second attempt found why", and at least one case where the
remedy for a broken rule was itself broken and had to be recorded a second
time. Those are in the history too.

What it buys is that none of the above is a surprise waiting in the code. It is
a list, with reasons, that the next agent to touch these files is handed before
it starts.

---

*This page is written by hand from real issues. If an entry no longer matches
the code, that is a defect in this page and worth an issue of its own.*

*It has already had one. The first version of this page claimed #343 "became
M1". It did not — M1 predates it by weeks, and #343 came out of an external
review of v0.5.0. Caught by checking the claim against the milestone rather
than against memory, which is the same check this page is about.*
