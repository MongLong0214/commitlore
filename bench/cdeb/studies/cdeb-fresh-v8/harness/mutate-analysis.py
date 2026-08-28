#!/usr/bin/env python3
"""Break the analysis on purpose and check the controls notice.

A passing test suite is not evidence that the suite can fail. Each entry below is
a defect that would corrupt the study's answer; the control set is only worth
running if every one of them turns it red.

Two of these were written after the controls had already gone green and did not
turn red -- the bootstrap resampling candidates instead of blocks, and the
bootstrap not resampling at all. The second is the worse of the two: it collapses
the interval onto the point estimate, which makes the section 27 condition "CI
lower > 0" true for free whenever the estimate is positive. Both controls were
rewritten until they caught it. That is what this file is for.

Runs each mutation in a throwaway copy so the real analysis is never edited.
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

MUTATIONS = [
    ("indeterminate counts as a success",
     'and row["panel_label"] == "COMPLIANT")',
     'and row["panel_label"] in ("COMPLIANT", "PANEL_INDETERMINATE"))'),
    ("incomplete episodes dropped from ITT",
     'return bool(row["completed"] and row["functional_pass"]',
     'return bool(row["functional_pass"]'),
    ("one judge decides the panel",
     "if n >= 2:", "if n >= 1:"),
    ("repositories weighted by candidate count",
     "overall = sum(repo_effects.values()) / len(repo_effects)",
     "overall = sum(d for v in per_repo.values() for d in v) / "
     "sum(len(v) for v in per_repo.values())"),
    ("bootstrap resamples candidates",
     "for cand, blocks in cand_blocks.items():",
     "_n = list(cand_blocks)\n"
     "        for cand in [_n[rng.randrange(len(_n))] for _ in _n]:\n"
     "            blocks = cand_blocks[cand]"),
    ("bootstrap does not resample at all",
     "drawn = [blocks[rng.randrange(len(blocks))] for _ in blocks]",
     "drawn = list(blocks)"),
    ("interval uses the extremes, not percentiles",
     "lo = out[int(0.025 * len(out))]", "lo = out[0]"),
    ("randomization never swaps labels",
     "if rng.random() < 0.5:", "if False:"),
    ("randomization always swaps labels",
     "if rng.random() < 0.5:", "if True:"),
    ("RBDR divides by a zero denominator",
     "if fvr_off == 0:", "if False:"),
    ("gate passes when any condition holds",
     'return {"strong_claim_allowed": not failed',
     'return {"strong_claim_allowed": len(failed) < len(GATE)'),
    ("gate treats a missing input as a pass",
     "results[name] = False", "results[name] = True"),
]


def run(where):
    p = subprocess.run([sys.executable, os.path.join(where, "test_analysis.py")],
                       capture_output=True, text=True)
    named = [ln.split("FAIL ", 1)[1].split("  <-")[0].strip()
             for ln in p.stdout.splitlines() if ln.strip().startswith("FAIL")]
    if named:
        return "caught", named
    if p.returncode != 0:
        # A mutation can also be caught by making the controls throw -- a divide by
        # zero is a detection, not a survivor, even though it prints no FAIL line.
        last = (p.stderr.strip().splitlines() or ["nonzero exit"])[-1]
        return "caught", [f"crashed: {last[:60]}"]
    return "survived", []


def main():
    src = open(os.path.join(HERE, "analysis.py")).read()
    survivors, lines = [], []

    with tempfile.TemporaryDirectory() as td:
        shutil.copy(os.path.join(HERE, "test_analysis.py"), td)
        shutil.copy(os.path.join(HERE, "analysis.py"), td)
        status, named = run(td)
        base_ok = status == "survived"
        lines.append(f"baseline unmutated: {'all controls pass' if base_ok else 'ALREADY RED ' + str(named)}")

        for name, old, new in MUTATIONS:
            if old not in src:
                lines.append(f"  NOT APPLIED  {name}  <- pattern absent; the mutation tests nothing")
                survivors.append(name)
                continue
            open(os.path.join(td, "analysis.py"), "w").write(src.replace(old, new, 1))
            status, named = run(td)
            if status == "survived":
                survivors.append(name)
                lines.append(f"  SURVIVED     {name}")
            else:
                lines.append(f"  caught       {name}  <- {', '.join(named)[:70]}")

    lines.append("")
    lines.append(f"{len(MUTATIONS) - len(survivors)}/{len(MUTATIONS)} mutations caught")
    if survivors:
        lines.append("survivors (each is a defect the controls cannot see):")
        lines += [f"  {s}" for s in survivors]
    out = "\n".join(lines)
    print(out)
    return 0 if base_ok and not survivors else 1


if __name__ == "__main__":
    sys.exit(main())
