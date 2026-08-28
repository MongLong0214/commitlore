#!/usr/bin/env python3
"""Assemble what ANALYST-B is given, and prove it carries no reference implementation.

Section 24 wants a second analysis of the same sealed data, written by a fresh
session in a different model family, from the frozen plan alone. The dry run on
synthetic data established that the comparison works and found two specification
gaps. This builds the packet for the real thing.

The whole value of a second analysis is that it did not see the first, so the
packet is checked for leakage rather than assumed clean: every file it contains is
scanned for the names of ANALYST-A's functions and for any Python at all. The one
overlap the check tolerates is the specification's own vocabulary -- section 10
says "pairwise Gwet AC1", so asking for `median_pairwise_gwet_ac1` in the report is
quoting the plan, not handing over an implementation.

It also refuses to build from an incomplete seal. An analysis of 200 rows is not
the analysis section 23 registers, and a packet that quietly contained fewer would
produce a second opinion about a different study.
"""
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
V8 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v8")

# Names that exist only in ANALYST-A's implementation. If one appears in the packet,
# the second analysis is being told how the first one was written.
ANALYST_A_NAMES = [
    "p_dsfps", "p_fvr", "p_ind", "itt_rows", "by_candidate", "candidate_effect",
    "randomization_p", "median_pairwise_ac1", "evaluate_gate", "GATE",
    "PANEL =", "def panel_label", "def bootstrap", "def reliability",
]


def sap_extract():
    prd = open(os.path.join(V8, "PRD.md")).read()

    def section(number):
        start = prd.index(f"\n## {number}.")
        return prd[start:prd.index("\n## ", start + 1)].strip()

    return ("# The frozen statistical analysis plan\n\n"
            "Sections 9, 10 and 23 of the study's specification, verbatim. This is "
            "the whole specification of what to compute.\n\n---\n\n"
            + "\n\n---\n\n".join(section(n) for n in (9, 10, 23)) + "\n")


def main():
    dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.environ.get("V8_SCRATCH", "/tmp"), "analyst-b-real")
    rows_dir = os.path.join(V8, "rows")
    judgements_dir = os.path.join(
        os.environ.get("V8_SCRATCH", "/tmp"), "v8run/judgements")

    rows = [os.path.join(rows_dir, e, "row.json") for e in sorted(os.listdir(rows_dir))
            if os.path.exists(os.path.join(rows_dir, e, "row.json"))]
    judgements = []
    if os.path.isdir(judgements_dir):
        for packet in sorted(os.listdir(judgements_dir)):
            judgements += [os.path.join(judgements_dir, packet, f)
                           for f in sorted(os.listdir(os.path.join(judgements_dir, packet)))
                           if f.startswith("out.") and f.endswith(".json")]

    if len(rows) != 340 or len(judgements) != 1020:
        print(f"  refusing: {len(rows)} rows and {len(judgements)} judgements; "
              f"section 21.1 expects 340 and 1,020")
        print("  a second opinion on a partial seal is a second opinion about a "
              "different study")
        return 2

    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(os.path.join(dest, "sealed/rows"))
    os.makedirs(os.path.join(dest, "sealed/judgements"))

    for path in rows:
        row = json.load(open(path))
        # The analyst gets the fields the plan names and nothing that would let it
        # reconstruct the arm from anything but the `arm` field itself.
        keep = {k: row[k] for k in ("candidate_id", "repository_id", "repetition",
                                    "arm", "episode_index", "packet_id",
                                    "functional_pass", "retry_lineage")}
        keep["completion"] = {"completed": row["completion"]["completed"]}
        out = os.path.join(dest, "sealed/rows", f"{row['episode_index']:03d}")
        os.makedirs(out)
        json.dump(keep, open(os.path.join(out, "row.json"), "w"),
                  indent=2, sort_keys=True)

    for path in judgements:
        answer = json.load(open(path))
        packet = os.path.basename(os.path.dirname(path))
        out = os.path.join(dest, "sealed/judgements", packet)
        os.makedirs(out, exist_ok=True)
        json.dump({"packet_id": answer["packet_id"], "label": answer["label"]},
                  open(os.path.join(out, os.path.basename(path)), "w"), indent=2)

    open(os.path.join(dest, "SAP.md"), "w").write(sap_extract())
    open(os.path.join(dest, "README.md"), "w").write(
        open(os.path.join(HERE, "analyst-brief.md")).read())

    # Leakage check. Every byte the analyst can read, scanned for the first
    # analysis's vocabulary.
    leaks = []
    for dirpath, _, filenames in os.walk(dest):
        for name in filenames:
            path = os.path.join(dirpath, name)
            if name.endswith(".py"):
                leaks.append({"path": os.path.relpath(path, dest),
                              "why": "python in the packet"})
                continue
            try:
                text = open(path, encoding="utf8").read()
            except (UnicodeDecodeError, OSError):
                continue
            for needle in ANALYST_A_NAMES:
                if needle in text:
                    leaks.append({"path": os.path.relpath(path, dest),
                                  "why": f"names ANALYST-A's {needle!r}"})

    report = {
        "rows": len(rows), "judgements": len(judgements),
        "packet": dest,
        "python_files_in_packet": sum(1 for l in leaks if l["why"] == "python in the packet"),
        "leaks": leaks,
        "clean": not leaks,
    }
    print(f"  rows {report['rows']}  judgements {report['judgements']}")
    print(f"  leakage scan: {'clean' if report['clean'] else leaks[:3]}")
    print(f"  packet at {dest}")
    return 0 if report["clean"] else 1


if __name__ == "__main__":
    sys.exit(main())
