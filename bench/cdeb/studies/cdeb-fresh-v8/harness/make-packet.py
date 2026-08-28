#!/usr/bin/env python3
"""Build one judge packet: a decision, a task, a diff, and the finished tree.

The packet is the judge's whole world, so what is left out of it is the blinding.
Removed before a judge ever sees it:

    .git                 carries the arm in branch names and commit messages
    CommitLore notes     the decision record itself, which would hand over the
                         answer rather than ask for it
    experiment logs      assignment files, runtime logs, delivery payloads

Not removed: agent-written source and comments. Redacting those would mean the
judge is reading something other than what was produced, and a comment mentioning
a product word is not an arm cue -- it is the code.

The packet id is opaque. It is a hash of the candidate and variant with a salt, so
it does not spell out which candidate this is, and two packets for the same
candidate under different arms do not share a visible prefix.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

SP = "/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad"
ROOT = "/Users/isaac/projects/commitlore"
V6 = f"{ROOT}/bench/cdeb/studies/cdeb-fresh-v6"
V7 = f"{ROOT}/bench/cdeb/studies/cdeb-fresh-v7"
V8 = f"{ROOT}/bench/cdeb/studies/cdeb-fresh-v8"

SALT = "cdeb-fresh-v8-packet"
STRIP_DIRS = {".git"}
STRIP_GLOBS = ("commitlore", "cdeb", "arm", "assignment", "delivery")


def packet_id(candidate, variant):
    return hashlib.sha256(f"{SALT}|{candidate}|{variant}".encode()).hexdigest()[:16]


def build(candidate, variant, patch_path, dest_root):
    manifest = json.load(open(f"{V7}/benchmark-manifest.json"))
    entry = next(c for c in manifest["candidates"] if c["candidate_id"] == candidate)
    repo = entry["repository_id"]
    pid = packet_id(candidate, variant)
    dest = f"{dest_root}/{pid}"
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(dest, exist_ok=True)

    tree = f"{dest}/tree"
    shutil.copytree(f"{SP}/mat/{repo}", tree, symlinks=True)

    task = json.load(open(f"{ROOT}/{entry['task']['path']}"))
    rel = task["acceptance_test_path"].lstrip("./")
    acc = os.path.join(tree, rel)
    os.makedirs(os.path.dirname(acc), exist_ok=True)
    with open(acc, "w") as fh:
        fh.write(task["acceptance_test_source"])

    applied = subprocess.run(["git", "-C", tree, "apply", "--whitespace=nowarn", patch_path],
                             capture_output=True, text=True)
    if applied.returncode != 0:
        shutil.rmtree(dest, ignore_errors=True)
        return None, f"patch did not apply: {applied.stderr.strip()[:200]}"

    # Everything below this line is the blinding.
    for d in STRIP_DIRS:
        shutil.rmtree(os.path.join(tree, d), ignore_errors=True)
    stripped = []
    for dirpath, dirnames, filenames in os.walk(tree):
        for name in list(dirnames):
            if any(g in name.lower() for g in STRIP_GLOBS):
                shutil.rmtree(os.path.join(dirpath, name), ignore_errors=True)
                dirnames.remove(name)
                stripped.append(os.path.relpath(os.path.join(dirpath, name), tree))
        for name in filenames:
            if any(g in name.lower() for g in STRIP_GLOBS):
                p = os.path.join(dirpath, name)
                os.remove(p)
                stripped.append(os.path.relpath(p, tree))

    pool = json.load(open(f"{V6}/source-pool.json"))
    cand = next(x for x in pool["candidates"] if x["candidate_id"] == candidate)
    with open(f"{dest}/decision.txt", "w") as fh:
        fh.write("A decision this repository recorded\n\n"
                 f"Ruled out: {cand['ruling']}\n\n"
                 f"Why: {cand['reason']}\n\n"
                 f"Scope as recorded: {cand['scope']}\n"
                 f"Path scope as recorded: {cand['path_scope']}\n"
                 f"Lifecycle as recorded: {cand['lifecycle']}\n")
    with open(f"{dest}/task.txt", "w") as fh:
        fh.write(task["task_prompt"] + "\n")
    shutil.copyfile(patch_path, f"{dest}/diff.patch")
    with open(f"{dest}/packet_id.txt", "w") as fh:
        fh.write(pid + "\n")

    return {"packet_id": pid, "candidate_id": candidate, "variant": variant,
            "repository_id": repo, "patch_sha256": hashlib.sha256(open(patch_path, "rb").read()).hexdigest(),
            "stripped_paths": sorted(stripped)}, None


def main():
    corpus = json.load(open(f"{V8}/calibration/corpus.json"))
    dest_root = f"{SP}/v8run/packets/calibration"
    os.makedirs(dest_root, exist_ok=True)
    rows, failures = [], []
    for c in corpus["cases_detail"]:
        rec, err = build(c["candidate_id"], c["variant"], f"{ROOT}/{c['patch']}", dest_root)
        if rec is None:
            failures.append({"candidate_id": c["candidate_id"], "variant": c["variant"], "error": err})
            print(f"  FAILED {c['candidate_id']}.{c['variant']}: {err}", flush=True)
            continue
        rec["expected_label"] = c["expected_label"]
        rows.append(rec)
        print(f"  {rec['packet_id']}  {c['candidate_id']}.{c['variant']}  -> {c['expected_label']}", flush=True)
    # The key lives outside the packets so a judge reading its own directory
    # cannot find the answer next to the question.
    json.dump({"schema_version": 1, "packets": rows, "failures": failures},
              open(f"{SP}/v8run/calibration-key.json", "w"), indent=2)
    print(f"  packets {len(rows)}  failures {len(failures)}")


if __name__ == "__main__":
    main()
