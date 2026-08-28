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
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

MUTATIONS = [
    ("indeterminate counts as a success",
     'and row["panel_label"] == "PANEL_COMPLIANT")',
     'and row["panel_label"] in ("PANEL_COMPLIANT", "PANEL_INDETERMINATE"))'),
    ("panel label drops the PANEL_ prefix",
     'return PANEL.get(label, "PANEL_INDETERMINATE")', "return label"),
    ("a second live row for one assignment is accepted",
     "        if key in live:", "        if False:"),
    ("a superseded attempt with no retry passes",
     "    orphaned = sorted(k for k in superseded if k not in live)",
     "    orphaned = []"),
    ("a superseded attempt still enters ITT",
     '        if lineage.get("superseded_by_retry"):', "        if False:"),
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
    ("gate answers without a stated input origin",
     "if provenance is None and not allow_unsourced:", "if False:"),
    ("AC1 uses the product of marginals like kappa",
     "p_e = sum(p * (1 - p) for p in pi.values()) / (len(categories) - 1)",
     "p_e = sum(p * p for p in pi.values())"),
    ("three-way agreement counts non-unanimous episodes",
     "return sum(len(set(v.values())) == 1 for v in episodes) / len(episodes)",
     "return sum(len(set(v.values())) <= 2 for v in episodes) / len(episodes)"),
    ("Fleiss kappa drops the chance correction",
     "return (p_bar - p_e) / (1 - p_e)", "return p_bar"),
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


def stamp_code_pin():
    """Bind the recorded results to the exact code that produced them.

    "12/12 caught" in a committed text file describes whatever analysis.py said
    when it was written. Editing the analysis afterwards leaves that sentence
    standing and true of nothing, and no amount of reading the file reveals it.
    The digest is the only thing that does.
    """
    def digest(name):
        h = hashlib.sha256()
        with open(os.path.join(HERE, name), "rb") as fh:
            for chunk in iter(lambda: fh.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()

    pin = {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-analysis-code-pin",
        "what_this_is":
            "Digests of the analysis and its controls at the moment the recorded "
            "simulation and mutation results were produced. A test asserts the "
            "files still hash to these, so an edit without a rerun fails.",
        "analysis_sha256": digest("analysis.py"),
        "test_analysis_sha256": digest("test_analysis.py"),
        "simulate_sha256": digest("simulate.py"),
        "mutate_analysis_sha256": digest("mutate-analysis.py"),
    }
    dest = os.path.join(HERE, "..", "analysis-simulation", "code-pin.json")
    with open(dest, "w") as fh:
        json.dump(pin, fh, indent=2, sort_keys=True)
        fh.write("\n")
    return pin


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
    ok = base_ok and not survivors
    if ok:
        # Only stamp a clean run. Pinning a run with survivors would bind the
        # results to code the controls demonstrably cannot check.
        pin = stamp_code_pin()
        print(f"code pinned: analysis.py {pin['analysis_sha256'][:16]}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
