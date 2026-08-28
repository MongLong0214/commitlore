#!/usr/bin/env python3
"""A runnable, verified acceptance command for each of the seventeen.

The v6 tasks record `how_to_run` as a human instruction, and four of the seventeen
are not commands a shell can execute:

    v4-c61d7c943edd8cff   "From the repository root: `node --test ...`"
    v4-0ecd7426eebc1cab   pytest ...        (pytest is not on PATH here)
    v4-ed878960135ff45a   pytest ...
    v4-cadfb63755c3f504   python -m pytest  (python is not on PATH here)

Passed to a shell, each exits 127 -- command not found. That is not a failing test.
Scored as one, those four candidates lose all twenty of their episodes in both
arms, and four of seventeen candidates become structural zeros in an equal-weight
estimand.

Normalising changes what is executed, so every change is recorded here per
candidate with its before and after, and every command is then verified twice on a
freshly materialised tree:

    it runs        exit is not 126 or 127
    it fails       exit is non-zero with the acceptance installed on the base tree

The second is the registered precondition -- a task whose acceptance already passes
on the base tree is not a task -- and checking it here re-establishes on this
machine what v6 recorded rather than trusting the record.
"""
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

# Only these two rewrites, and only at the start of the command. Anything broader
# would be editing the task rather than making it runnable.
INTERPRETER = [(re.compile(r"^pytest\b"), "python3 -m pytest"),
               (re.compile(r"^python\b(?!3)"), "python3")]


def normalise(raw):
    """Strip a prose wrapper, then fix an interpreter that is not on PATH."""
    command, changes = raw.strip(), []

    backticked = re.search(r"`([^`]+)`", command)
    if backticked and not command.startswith(backticked.group(1)):
        command = backticked.group(1).strip()
        changes.append("took the backticked command out of its prose wrapper")

    for pattern, replacement in INTERPRETER:
        if pattern.search(command):
            command = pattern.sub(replacement, command, count=1)
            changes.append(f"interpreter -> {replacement}")
    return command, changes


def main():
    population = json.load(open(os.path.join(V8, "task-population.json")))["candidates"]
    entries, problems = [], []

    with tempfile.TemporaryDirectory() as td:
        for candidate in population:
            cid = candidate["candidate_id"]
            task = json.load(open(os.path.join(ROOT, candidate["task"]["path"])))
            raw = task["how_to_run"]
            command, changes = normalise(raw)

            tree = os.path.join(td, cid)
            ep.materialise(candidate, tree)
            acceptance_path = candidate["task_acceptance"]["path_in_repository"]
            ep.install_acceptance(tree, acceptance_path, task["acceptance_test_source"])
            proc = subprocess.run(command, shell=True, cwd=tree,
                                  capture_output=True, text=True, timeout=900)
            runnable = proc.returncode not in (126, 127)
            fails_on_base = runnable and proc.returncode != 0

            entry = {
                "candidate_id": cid,
                "repository_id": candidate["repository_id"],
                "recorded_how_to_run": raw,
                "command": command,
                "normalisation": changes,
                "exit_code_on_base": proc.returncode,
                "runnable": runnable,
                "fails_on_base": fails_on_base,
                "recorded_verified_fails_on_base":
                    candidate["baseline_evidence"].get("verified_fails_on_base"),
            }
            if not runnable:
                entry["why"] = "exit 126 or 127: the command did not run"
                problems.append(cid)
            elif not fails_on_base:
                entry["why"] = ("the acceptance already passes on the base tree, so "
                                "this is not a task")
                problems.append(cid)
            entries.append(entry)
            print(f"  {'ok ' if entry.get('why') is None else 'BAD'} {cid}  "
                  f"exit={proc.returncode}  {'/'.join(changes) or 'unchanged'}")

    out = {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-acceptance-commands",
        "what_this_is":
            "The command each episode runs to score task acceptance, normalised from "
            "the v6 task's human-readable how_to_run and verified on a freshly "
            "materialised tree.",
        "why_normalisation_was_needed":
            "Four of the seventeen how_to_run strings are not shell commands: one is "
            "prose wrapping a backticked command, and three name an interpreter that "
            "is not on PATH. Each exits 127, which is not a failing test -- and "
            "scored as one, those four candidates lose all twenty of their episodes "
            "in both arms.",
        "what_normalisation_may_do":
            "Take a backticked command out of a prose wrapper, and replace a leading "
            "`pytest` or `python` with `python3 -m pytest` or `python3`. Nothing "
            "else. A broader rewrite would be editing the task.",
        "counts": {
            "total": len(entries),
            "normalised": sum(1 for e in entries if e["normalisation"]),
            "runnable": sum(1 for e in entries if e["runnable"]),
            "fails_on_base": sum(1 for e in entries if e["fails_on_base"]),
        },
        "all_verified": not problems,
        "problems": problems,
        "commands": entries,
    }
    dest = os.path.join(V8, "acceptance-commands.json")
    with open(dest, "w") as fh:
        json.dump(out, fh, indent=2, sort_keys=True)
        fh.write("\n")
    print(f"\n  normalised {out['counts']['normalised']}, runnable "
          f"{out['counts']['runnable']}/{out['counts']['total']}, "
          f"fails on base {out['counts']['fails_on_base']}/{out['counts']['total']}")
    print(f"  wrote {os.path.relpath(dest, ROOT)}")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
