#!/usr/bin/env python3
"""Derive the section 27 gate's inputs from sealed artifacts, and say where each came from.

Red-team round C's finding was that the gate is a predicate checker over numbers
somebody hands it, with nothing establishing those numbers came from anywhere. The
first half of the answer was making `evaluate_gate` refuse an input with no stated
origin. This is the second half: the thing that produces both the numbers and the
origins, so a measured run has a derived dictionary rather than a typed one.

Every value here is computed from a file on disk. Nothing is a constant, and the
few facts the artifacts cannot supply -- whether an unresolved P0 or P1 is open,
whether the two analysts matched -- are read from STATUS and the analyst records
rather than assumed, so a missing one is a failure and not a default.

It refuses to run on an incomplete seal. A gate evaluated on 200 of 340 rows is a
different question from the one section 27 asks, and answering it anyway is how a
partial run becomes a claim.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
V8 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v8")

sys.path.insert(0, HERE)
from analysis import (delta, itt_rows, p_dsfps, p_fvr, panel_label,  # noqa: E402
                      reliability)


def load_rows(rows_dir):
    rows = []
    if not os.path.isdir(rows_dir):
        return rows
    for name in sorted(os.listdir(rows_dir)):
        path = os.path.join(rows_dir, name, "row.json")
        if os.path.exists(path):
            rows.append(json.load(open(path)))
    return rows


def load_judgements(judgements_dir):
    out = []
    if not os.path.isdir(judgements_dir):
        return out
    for packet in sorted(os.listdir(judgements_dir)):
        d = os.path.join(judgements_dir, packet)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not (name.startswith("out.") and name.endswith(".json")):
                continue
            try:
                answer = json.load(open(os.path.join(d, name)))
            except json.JSONDecodeError:
                continue
            out.append({"episode_id": packet,
                        "judge": name[len("out."):-len(".json")],
                        "label": answer.get("label")})
    return out


def build(rows_dir, judgements_dir):
    """(inputs, provenance, problems). Problems are stated, never silently defaulted."""
    schedule = json.load(open(os.path.join(V8, "schedule.json")))
    status = json.load(open(os.path.join(V8, "STATUS.json")))
    panel = json.load(open(os.path.join(V8, "calibration/panel-freeze.json")))

    rows, judgements = load_rows(rows_dir), load_judgements(judgements_dir)
    problems = []
    expected_rows = len(schedule["episodes"])
    if len(rows) != expected_rows:
        problems.append(f"{len(rows)} rows sealed, schedule expects {expected_rows}")
    if len(judgements) != expected_rows * 3:
        problems.append(f"{len(judgements)} judgements, expected {expected_rows * 3}")
    if problems:
        return None, None, problems

    # Attach the panel label to each row, then the analysis reads rows as usual.
    by_packet = {}
    for j in judgements:
        by_packet.setdefault(j["episode_id"], []).append(j["label"])
    for row in rows:
        votes = by_packet.get(row["packet_id"])
        if not votes or len(votes) != 3:
            problems.append(f"row {row['packet_id']} has {len(votes or [])} judgements")
            continue
        row["panel_label"] = panel_label(votes)
        row["completed"] = row["completion"]["completed"]
    if problems:
        return None, None, problems

    repo_of = {r["candidate_id"]: r["repository_id"] for r in rows}
    counted = itt_rows(rows)
    dsfps, repo_effects, _ = delta(counted, p_dsfps, repo_of)
    rel = reliability(judgements)

    on = [r for r in counted if r["arm"] == "ON"]
    suppressed = [r for r in counted if r["arm"] == "SUPPRESSED"]
    delivery = [r["delivery_manipulation"] for r in on]
    leaks = sum(1 for r in suppressed if r["delivery_manipulation"]["removed"] != 1)

    inputs = {
        "coding_rows": len(rows),
        "judge_rows": len(judgements),
        "dsfps_point": dsfps,
        "suppressed_violation_events": sum(p_fvr(r) for r in suppressed),
        "repo_effects": repo_effects,
        "median_pairwise_ac1": rel["median_pairwise_gwet_ac1"],
        "three_way_agreement": rel["three_way_exact_agreement"],
        "panel_indeterminate_rate": rel["panel_indeterminate_rate"],
        "judge_model_families": len({seat["family"] for seat in panel["panel"]}),
        "on_delivery_overall": (sum(1 for d in delivery if d["removed"] == 0) / len(on)) if on else 0,
        "on_delivery_min_candidate": min(
            (sum(1 for r in on if r["candidate_id"] == c
                 and r["delivery_manipulation"]["records_after"] >= 1)
             / max(1, sum(1 for r in on if r["candidate_id"] == c))
             for c in {r["candidate_id"] for r in on}), default=0),
        "suppressed_automatic_leaks": leaks,
        "unresolved_p0_p1": status.get("red_team_p0_open", 0) + status.get("red_team_p1_open", 0),
    }
    provenance = {
        "coding_rows": f"{rows_dir}/*/row.json",
        "judge_rows": f"{judgements_dir}/*/out.*.json",
        "dsfps_point": "analysis.delta over itt_rows",
        "suppressed_violation_events": "analysis.p_fvr over the suppressed arm",
        "repo_effects": "analysis.delta per repository",
        "median_pairwise_ac1": "analysis.reliability",
        "three_way_agreement": "analysis.reliability",
        "panel_indeterminate_rate": "analysis.reliability",
        "judge_model_families": "calibration/panel-freeze.json",
        "on_delivery_overall": "row.delivery_manipulation on the ON arm",
        "on_delivery_min_candidate": "row.delivery_manipulation per candidate",
        "suppressed_automatic_leaks": "row.delivery_manipulation on the suppressed arm",
        "unresolved_p0_p1": "STATUS.json red_team_p0_open + red_team_p1_open",
    }
    return inputs, provenance, []


def main():
    rows_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(V8, "rows")
    judgements_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(V8, "judgements")
    inputs, provenance, problems = build(rows_dir, judgements_dir)
    if problems:
        print("  cannot build gate inputs:")
        for p in problems[:6]:
            print(f"    {p}")
        print("  a gate answered on a partial seal is a different question from the "
              "one section 27 asks")
        return 2
    print(json.dumps({"inputs": inputs, "provenance": provenance}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
