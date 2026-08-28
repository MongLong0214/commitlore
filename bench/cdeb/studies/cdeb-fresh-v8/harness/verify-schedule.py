#!/usr/bin/env python3
"""Check the committed schedule against section 18, without reusing its generator.

Rerunning freeze-schedule.py and comparing would only show the generator agrees
with itself. This reads schedule.json and expected-rows.json as files and checks
the properties the specification asks for, including recomputing the seed from the
four frozen artifacts on disk -- so a schedule generated from anything else fails
here even though it would look internally consistent.
"""
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
V8 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v8")

FAILED = []


def check(name, ok, why=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"  <- {why}"))
    if not ok:
        FAILED.append(name)


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for c in iter(lambda: fh.read(65536), b""):
            h.update(c)
    return h.hexdigest()


s = json.load(open(os.path.join(V8, "schedule.json")))
rows = json.load(open(os.path.join(V8, "expected-rows.json")))
eps = s["episodes"]

# --- the seed is the one the four frozen artifacts produce -------------------
si = s["seed_inputs"]
recomputed = hashlib.sha256("".join([
    "CDEB-FRESH-V8",
    sha256_file(os.path.join(V8, "task-population.json")),
    sha256_file(os.path.join(V8, "calibration/panel-freeze.json")),
    sha256_file(os.path.join(V8, "runtime-lock.json")),
    si["preregistration_commit_sha"],
]).encode()).hexdigest()
check("seed derives from the artifacts on disk", recomputed == s["seed"],
      f"recorded {s['seed'][:16]}, recomputed {recomputed[:16]} -- the schedule was "
      f"built from different inputs than the ones frozen here")
check("recorded seed inputs match the files",
      si["task_population_sha256"] == sha256_file(os.path.join(V8, "task-population.json"))
      and si["judge_panel_lock_sha256"] == sha256_file(os.path.join(V8, "calibration/panel-freeze.json"))
      and si["runtime_lock_sha256"] == sha256_file(os.path.join(V8, "runtime-lock.json")),
      "a recorded input digest does not match the file it names")

# --- counts ------------------------------------------------------------------
check("340 episodes", len(eps) == 340, f"got {len(eps)}")
assignments = {(e["candidate_id"], e["repetition"], e["arm"]) for e in eps}
check("340 unique assignments", len(assignments) == 340, f"got {len(assignments)}")
check("170 paired blocks", len(s["pairs"]) == 170, f"got {len(s['pairs'])}")
check("1,020 judgements expected", rows["expected_judgements"] == 1020,
      f"got {rows['expected_judgements']}")

per_candidate = defaultdict(Counter)
for e in eps:
    per_candidate[e["candidate_id"]][e["arm"]] += 1
check("17 candidates", len(per_candidate) == 17, f"got {len(per_candidate)}")
check("10 repeats per arm per task",
      all(c["ON"] == 10 and c["SUPPRESSED"] == 10 for c in per_candidate.values()),
      str({k: dict(v) for k, v in per_candidate.items() if v["ON"] != 10 or v["SUPPRESSED"] != 10}))

repo_counts = Counter(e["repository_id"] for e in eps)
check("repository split is 160/180",
      repo_counts["agent-operator-score"] == 160 and repo_counts["gitseed"] == 180,
      str(dict(repo_counts)))

# --- pairing and adjacency ---------------------------------------------------
adjacency_ok = True
for i in range(0, len(eps), 2):
    a, b = eps[i], eps[i + 1]
    if (a["candidate_id"] != b["candidate_id"] or a["repetition"] != b["repetition"]
            or {a["arm"], b["arm"]} != {"ON", "SUPPRESSED"}
            or a["slot_in_pair"] != 0 or b["slot_in_pair"] != 1
            or a["pair_position"] != b["pair_position"]):
        adjacency_ok = False
        break
check("both episodes of a pair are adjacent", adjacency_ok,
      f"pair broken at episode index {i}")

# --- arm order is decided by the hash, not by a constant ---------------------
lead = Counter(p["first_arm"] for p in s["pairs"])
check("arm order is not fixed", lead["ON"] > 0 and lead["SUPPRESSED"] > 0, str(dict(lead)))
check("arm order is near balanced", 60 <= lead["SUPPRESSED"] <= 110,
      f"{lead['SUPPRESSED']}/170 lead SUPPRESSED, which is far from half")
by_rep = defaultdict(Counter)
for p in s["pairs"]:
    by_rep[p["repetition"]][p["first_arm"]] += 1
check("no repetition index carries a fixed arm order",
      all(c["ON"] > 0 and c["SUPPRESSED"] > 0 for c in by_rep.values()),
      str({k: dict(v) for k, v in by_rep.items() if 0 in v.values() or len(v) < 2}))

# The first bit must actually come from the digest: recompute it for every pair.
bit_ok = all(
    p["first_arm"] == ("SUPPRESSED" if int(hashlib.sha256(
        (s["seed"] + p["candidate_id"] + str(p["repetition"]) + "arm-order").encode()
    ).hexdigest()[0], 16) & 0x8 else "ON")
    for p in s["pairs"])
check("arm order is the pair hash's first bit", bit_ok,
      "a pair's recorded first arm does not follow from its own digest")

# --- repository interleaving -------------------------------------------------
seq = [p["repository_id"] for p in s["pairs"]]
longest, run, prev = 1, 1, seq[0]
for r in seq[1:]:
    run = run + 1 if r == prev else 1
    longest = max(longest, run)
    prev = r
check("repositories interleave rather than cluster", longest <= 11,
      f"longest single-repository run is {longest} pairs; 9 vs 8 candidates leaves a "
      f"tail of 10 gitseed pairs once AOS is exhausted, but nothing longer is expected")

# --- concurrency limits are stated -------------------------------------------
c = s["concurrency"]
check("concurrency limits recorded",
      c["max_active_coding_episodes"] == 2 and c["max_active_per_repository"] == 1
      and c["same_pair_concurrent"] is False, str(c))

# --- expected-rows agrees with the schedule ----------------------------------
check("expected rows match the schedule exactly",
      [(r["candidate_id"], r["repetition"], r["arm"]) for r in rows["rows"]]
      == [(e["candidate_id"], e["repetition"], e["arm"]) for e in eps],
      "expected-rows.json and schedule.json describe different runs")

print(f"\n  {len(FAILED)} failing" if FAILED else "\n  all passing")
sys.exit(1 if FAILED else 0)
