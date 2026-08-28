#!/usr/bin/env python3
"""Which tests already fail on the pristine snapshot, per repository.

The frozen population records `repository_baseline_total` and the command, and
nothing about the baseline's own failures. So an episode runner that scores
regression acceptance by exit code scores every agent against a suite that was
already red.

Measured: agent-operator-score runs 604 tests on its pristine snapshot and 11 of
them fail. Scored by exit code, all 160 of that repository's episodes would have
come out functionally failed whatever the agent did -- P-DSFPS zero in both arms,
the equal-weight estimand halved, and section 27's "AOS P-DSFPS point effect > 0"
unreachable by construction. gitseed's suite is green at baseline, so the defect
would have been invisible in half the data.

What regression acceptance means, then, is no failure outside this set. A new
failure is a regression; one of these eleven is the snapshot.

The set is frozen here rather than recomputed per episode. Recomputing would let a
flaky test quietly join the baseline the first time it failed, which is the same
as not having a baseline.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
V8 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v8")

sys.path.insert(0, HERE)
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("ep", os.path.join(HERE, "run-episode.py"))
ep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ep)

TAP_FAIL = re.compile(r"^not ok \d+ - (.*)$", re.M)
PYTEST_FAIL = re.compile(r"^FAILED (\S+)", re.M)


def failures(output):
    """Failing test names from either runner's output."""
    names = [m.strip() for m in TAP_FAIL.findall(output)]
    names += [m.strip() for m in PYTEST_FAIL.findall(output)]
    return sorted(set(names))


def main():
    population = json.load(open(os.path.join(V8, "task-population.json")))["candidates"]
    first = {}
    for candidate in population:
        first.setdefault(candidate["repository_id"], candidate)

    out = {}
    with tempfile.TemporaryDirectory() as td:
        for repository, candidate in sorted(first.items()):
            tree = os.path.join(td, repository)
            ep.materialise(candidate, tree)
            regression = candidate["regression_acceptance"]
            proc = subprocess.run(regression["command"], shell=True,
                                  cwd=os.path.join(tree, regression.get("cwd", ".")),
                                  capture_output=True, text=True, timeout=1800)
            text = proc.stdout + "\n" + proc.stderr
            names = failures(text)
            out[repository] = {
                "command": regression["command"],
                "snapshot_commit": candidate["snapshot"]["snapshot_commit"],
                "exit_code": proc.returncode,
                "green_at_baseline": proc.returncode == 0,
                "expected_failures": names,
                "expected_failure_count": len(names),
                "recorded_total": regression.get("repository_baseline_total"),
            }
            print(f"  {repository:22} exit={proc.returncode} "
                  f"failures={len(names)} total={regression.get('repository_baseline_total')}")
            for n in names[:4]:
                print(f"      {n[:88]}")

    doc = {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-regression-baseline",
        "what_this_is":
            "The tests already failing on each repository's pristine snapshot. "
            "Regression acceptance means no failure outside this set; a new one is "
            "a regression and one of these is the snapshot.",
        "why_it_is_needed":
            "The frozen population records the command and the test total and "
            "nothing about the baseline's own failures. Scored by exit code, every "
            "agent-operator-score episode fails regression whatever the agent does, "
            "which would zero that repository in an equal-weight estimand and make "
            "section 27's AOS condition unreachable.",
        "why_it_is_frozen_rather_than_recomputed":
            "Recomputing per episode would let a flaky test join the baseline the "
            "first time it failed, which is the same as having no baseline.",
        "repositories": out,
    }
    dest = os.path.join(V8, "regression-baseline.json")
    with open(dest, "w") as fh:
        json.dump(doc, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print(f"  wrote {os.path.relpath(dest, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
