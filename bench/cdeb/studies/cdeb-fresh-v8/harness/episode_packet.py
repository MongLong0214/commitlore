#!/usr/bin/env python3
"""The judge packet for one measured episode, built before the tree is destroyed.

Section 19 puts packet construction at step 15 and worktree teardown at step 16,
in that order, because the packet needs the final tree and the tree does not
survive the episode. Building it later is not an option that exists.

What the packet carries is section 7.3: an opaque id, the ruling and its reason,
the scope, the lifecycle, the task, the base-to-final diff, and the finished tree.
What it does not carry is everything that would answer the question for the judge --
the arm, the repetition, the boundary status, the acceptance result, the delivery
log, `.git` (branch names and commit messages name the arm), and any other judge's
answer.

The exclusion is a whitelist walk rather than a blacklist. A blacklist is a list of
the leaks somebody thought of; anything the harness starts writing later arrives in
the packet by default. Here a file has to be a tracked source file to get in.
"""
import hashlib
import json
import os
import shutil
import subprocess

# Section 11.4's cue patterns, applied to the packet before it is sealed. The scan
# does not redact: it records `arm_cue_present`, and the cue-excluded sensitivity in
# section 23.9 is where that is used. Redacting would mean the judge reads something
# the agent did not write.
import re

CUE_PATTERNS = [
    ("arm-word-on", re.compile(r"\bON\b")),
    ("arm-word-suppressed", re.compile(r"SUPPRESSED", re.I)),
    ("record-id", re.compile(r"\bRecord-Id\b|\br-[0-9a-z]{6,}\b")),
    ("experiment-assignment", re.compile(r"\bepisode_index\b|\brepetition\b|\barm\b", re.I)),
    ("delivery-log", re.compile(r"delivered_sha256|records_before|records_after")),
    ("commitlore-marker", re.compile(r"Ruled-out:|Limit:|Provenance:|Certainty:|Blast:|Undo:")),
]


def sha(text):
    return hashlib.sha256(text.encode(errors="replace")).hexdigest()


def tracked_files(tree):
    """Only what git tracks, so build output and stray writes stay out."""
    out = subprocess.run(["git", "-C", tree, "ls-files"],
                         capture_output=True, text=True).stdout.split("\n")
    return [f for f in out if f.strip()]


def build(tree, row, candidate, task, dest, acceptance_path):
    """Write the packet, scan it, and return what the row needs to record."""
    os.makedirs(dest, exist_ok=True)
    decision = candidate["source_decision_packet"]

    files, skipped = {}, []
    for rel in tracked_files(tree):
        if rel == acceptance_path:
            # Installed after the agent stopped, for evaluation. It is the answer
            # key, and a judge holding it is scoring something else.
            skipped.append(rel)
            continue
        full = os.path.join(tree, rel)
        if not os.path.isfile(full):
            continue
        try:
            files[rel] = open(full, encoding="utf8").read()
        except (UnicodeDecodeError, OSError):
            files[rel] = "<binary>"

    diff = open(os.path.join(os.path.dirname(dest), "diff.patch"),
                encoding="utf8", errors="replace").read() \
        if os.path.exists(os.path.join(os.path.dirname(dest), "diff.patch")) else ""

    # The judge reads the flat files written below; this is the record of what was
    # in the packet. It carries a manifest rather than every file's contents --
    # inlining 350 files for each of 340 packets doubles the storage to say twice
    # what one copy already says.
    packet = {
        "packet_id": row["packet_id"],
        "decision": {
            "ruling": decision.get("ruling"),
            "reason": decision.get("reason"),
            "scope": decision.get("scope"),
            "lifecycle": decision.get("lifecycle"),
        },
        "task_prompt": task["task_prompt"],
        "base_to_final_diff_sha256": sha(diff),
        "base_to_final_diff_bytes": len(diff),
        "final_tree_manifest": {rel: sha(content) for rel, content in sorted(files.items())},
    }

    # What can carry the arm is what differs between the arms: the diff and the
    # files the agent touched. The base tree is identical in ON and SUPPRESSED by
    # construction, so a `Ruled-out:` marker sitting in the repository's own docs
    # cannot tell a judge which arm it is reading -- and both of these repositories
    # use CommitLore, so scanning the whole tree marks almost every packet as
    # cue-present and leaves section 23.9's cue-excluded sensitivity with nothing.
    #
    # The base-tree count is still recorded, as context rather than as a finding.
    changed = set(row.get("changed_files") or [])
    differing = {f"changed/{k}": v for k, v in files.items() if k in changed}
    scannable = dict(differing, diff=diff, packet_id=packet["packet_id"])
    hits = []
    for field, text in scannable.items():
        for name, pattern in CUE_PATTERNS:
            for match in pattern.finditer(text):
                hits.append({"cue": name, "where": field, "match": match.group(0)[:40]})

    base_hits = 0
    for rel, text in files.items():
        if rel in changed:
            continue
        for _, pattern in CUE_PATTERNS:
            base_hits += len(pattern.findall(text))

    # The record of what the packet was goes beside the packet, not inside it. A
    # judge's directory should hold only what a judge is meant to read.
    with open(os.path.join(os.path.dirname(dest), "packet-record.json"), "w") as fh:
        json.dump(packet, fh, indent=2, sort_keys=True)
    # The flat files a judge session reads, matching the calibration packet shape.
    open(os.path.join(dest, "packet_id.txt"), "w").write(packet["packet_id"] + "\n")
    open(os.path.join(dest, "decision.txt"), "w").write(
        f"{packet['decision']['ruling']}\n\n{packet['decision']['reason']}\n\n"
        f"scope: {packet['decision']['scope']}\n"
        f"lifecycle: {packet['decision']['lifecycle']}\n")
    open(os.path.join(dest, "task.txt"), "w").write(packet["task_prompt"] + "\n")
    open(os.path.join(dest, "diff.patch"), "w").write(diff)
    tree_dest = os.path.join(dest, "tree")
    shutil.rmtree(tree_dest, ignore_errors=True)
    for rel, content in files.items():
        target = os.path.join(tree_dest, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w") as fh:
            fh.write(content)

    return {
        "packet_id": packet["packet_id"],
        "packet_sha256": sha(json.dumps(packet, sort_keys=True)),
        "files_in_packet": len(files),
        "excluded_from_packet": skipped,
        "excludes_git": True,
        "arm_cue_present": bool(hits),
        "arm_cue_hits": hits[:20],
        "arm_cue_hit_count": len(hits),
        "arm_cue_scope": "the diff and the files the agent changed; the base tree is "
                         "identical across arms and cannot carry the assignment",
        "base_tree_marker_count": base_hits,
        "base_tree_markers_are_not_cues":
            "Both repositories use CommitLore, so their tracked files carry "
            "Ruled-out: and Record-Id text of their own. It is the same text in both "
            "arms.",
    }
