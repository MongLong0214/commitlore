#!/usr/bin/env python3
"""Section 18: fix all 340 episodes before the first one runs.

The point of freezing this is that arm order stops being a choice anyone can make
later. Every decision the schedule encodes -- which arm goes first in a pair, what
order the pairs run in -- comes out of one seed built from four artifacts that are
already frozen, so the schedule can be recomputed by anyone holding those four and
compared against the committed file.

Section 18.1 fixes the seed. Section 18.2 takes the first bit of a per-pair hash
for arm order, so roughly half the pairs start SUPPRESSED and no repetition index
carries a fixed meaning. Section 18.3 hash-sorts pairs inside each repository and
alternates the two repositories, which keeps the two from clustering in time; the
two episodes of a pair run adjacent so that whatever drifts between them is as
small as the design allows.

What this does not do: it does not make the arms independent of execution order,
because they still run one after the other on the same machine. Adjacency bounds
that; it does not remove it.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
V8 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v8")

REPEATS = 10
REPOSITORIES = ["agent-operator-score", "gitseed"]


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def h(*parts):
    return hashlib.sha256("".join(parts).encode()).hexdigest()


def main():
    prereg_sha = sys.argv[1] if len(sys.argv) > 1 else None
    if not prereg_sha:
        print("  usage: freeze-schedule.py <preregistration-commit-sha>")
        return 2

    task_population_sha = sha256_file(os.path.join(V8, "task-population.json"))
    panel_lock_sha = sha256_file(os.path.join(V8, "calibration/panel-freeze.json"))
    runtime_lock_sha = sha256_file(os.path.join(V8, "runtime-lock.json"))

    # Section 18.1, in the order the specification writes it.
    seed = h("CDEB-FRESH-V8", task_population_sha, panel_lock_sha,
             runtime_lock_sha, prereg_sha)

    population = json.load(open(os.path.join(V8, "task-population.json")))
    candidates = population["candidates"]
    repo_of = {c["candidate_id"]: c["repository_id"] for c in candidates}

    # Section 18.2: first bit of the pair hash decides which arm leads.
    pairs = []
    for c in candidates:
        cid = c["candidate_id"]
        for rep in range(REPEATS):
            digest = h(seed, cid, str(rep), "arm-order")
            first = "SUPPRESSED" if int(digest[0], 16) & 0x8 else "ON"
            pairs.append({
                "candidate_id": cid,
                "repository_id": repo_of[cid],
                "repetition": rep,
                "arm_order_digest": digest,
                "first_arm": first,
                "second_arm": "ON" if first == "SUPPRESSED" else "SUPPRESSED",
                "order_key": h(seed, cid, str(rep), "pair-order"),
            })

    # Section 18.3: hash-sort within each repository, then alternate.
    per_repo = {r: sorted((p for p in pairs if p["repository_id"] == r),
                          key=lambda p: p["order_key"]) for r in REPOSITORIES}
    merged, idx = [], {r: 0 for r in REPOSITORIES}
    turn = 0
    while len(merged) < len(pairs):
        r = REPOSITORIES[turn % len(REPOSITORIES)]
        turn += 1
        if idx[r] < len(per_repo[r]):
            merged.append(per_repo[r][idx[r]])
            idx[r] += 1
        elif all(idx[x] >= len(per_repo[x]) for x in REPOSITORIES):
            break

    episodes = []
    for position, p in enumerate(merged):
        for slot, arm in enumerate((p["first_arm"], p["second_arm"])):
            episodes.append({
                "episode_index": len(episodes),
                "pair_position": position,
                "slot_in_pair": slot,
                "candidate_id": p["candidate_id"],
                "repository_id": p["repository_id"],
                "repetition": p["repetition"],
                "arm": arm,
            })

    first_suppressed = sum(1 for p in merged if p["first_arm"] == "SUPPRESSED")
    assignments = {(e["candidate_id"], e["repetition"], e["arm"]) for e in episodes}

    schedule = {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-schedule",
        "seed": seed,
        "seed_inputs": {
            "literal": "CDEB-FRESH-V8",
            "task_population_sha256": task_population_sha,
            "judge_panel_lock_sha256": panel_lock_sha,
            "runtime_lock_sha256": runtime_lock_sha,
            "preregistration_commit_sha": prereg_sha,
        },
        "seed_recipe":
            'SHA256("CDEB-FRESH-V8" + task-population-sha + judge-panel-lock-sha + '
            "runtime-lock-sha + preregistration-commit-sha), concatenated in that order",
        "counts": {
            "candidates": len(candidates),
            "repeat_blocks_per_candidate": REPEATS,
            "paired_blocks": len(merged),
            "episodes": len(episodes),
            "unique_assignments": len(assignments),
            "pairs_leading_with_suppressed": first_suppressed,
        },
        "concurrency": {
            "max_active_coding_episodes": 2,
            "max_active_per_repository": 1,
            "same_pair_concurrent": False,
        },
        "adjacency_rule":
            "The two episodes of a pair run adjacent, in the recorded slot order.",
        "what_this_does_not_control":
            "Both arms of a pair still run in sequence on one machine, so anything "
            "that drifts with time is shared between them rather than eliminated. "
            "Adjacency bounds how much can drift; it does not make the arms "
            "independent of when they ran.",
        "pairs": merged,
        "episodes": episodes,
    }

    expected_rows = {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-expected-rows",
        "what_this_is":
            "The 340 rows the measured run must produce, one per scheduled episode. "
            "A run that seals a different set is not this study.",
        "expected_row_count": len(episodes),
        "expected_judgements": len(episodes) * 3,
        "rows": [{"episode_index": e["episode_index"],
                  "candidate_id": e["candidate_id"],
                  "repetition": e["repetition"],
                  "arm": e["arm"]} for e in episodes],
    }

    json.dump(schedule, open(os.path.join(V8, "schedule.json"), "w"),
              indent=2, sort_keys=True)
    open(os.path.join(V8, "schedule.json"), "a").write("\n")
    json.dump(expected_rows, open(os.path.join(V8, "expected-rows.json"), "w"),
              indent=2, sort_keys=True)
    open(os.path.join(V8, "expected-rows.json"), "a").write("\n")

    ok = (len(episodes) == 340 and len(assignments) == 340
          and len(merged) == 170 and population["import_valid"])
    print(f"  seed            {seed[:16]}...")
    print(f"  pairs           {len(merged)}  episodes {len(episodes)}  "
          f"unique {len(assignments)}")
    print(f"  arm order       {first_suppressed}/170 pairs lead with SUPPRESSED")
    print(f"  frozen          schedule.json, expected-rows.json")
    print(f"  consistent      {ok}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
