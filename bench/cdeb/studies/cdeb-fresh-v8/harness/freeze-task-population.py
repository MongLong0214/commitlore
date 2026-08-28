#!/usr/bin/env python3
"""Section 14: freeze the seventeen, and verify every hash by opening the file.

The manifest records a sha256 beside each path. Copying those forward would
freeze the manifest's claims rather than the artifacts, and a file that has drifted
since v7 would be frozen as though it had not. So every referenced path is opened
and rehashed here, and any missing path or mismatched digest is reported as drift.
Section 14 makes either one terminal.

Boundary status is derived rather than copied, because v7 published the 8/9 split
as counts and never wrote the per-candidate label to a file. The derivation is
recorded with the result so the reader can check it:

  both readers agreed a boundary (spec-agreement agree=true)      -> settled
  both readers declared it undrawable (specA and specB unresolvable) -> unresolved
  otherwise a third reading exists, and its own unresolvable flag decides

That reproduces v7's published 8 settled and 9 unresolved exactly. If it ever
stops doing so, the derivation is wrong and this script fails rather than writing
a population whose boundary column disagrees with the study it came from.
"""
import hashlib
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "..", "..", "..", "..", ".."))
V7 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v7")
V8 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v8")


def sha256_file(rel):
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        return None
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(rel, expected, drift, label):
    """Open it. A recorded digest is a claim about a file until the file is read."""
    actual = sha256_file(rel)
    if actual is None:
        drift.append({"kind": "missing", "what": label, "path": rel})
    elif expected and actual != expected:
        drift.append({"kind": "digest-drift", "what": label, "path": rel,
                      "recorded": expected, "actual": actual})
    return actual


def boundary_status(cand, specs, agreement):
    a = specs.get("specA", {}).get("unresolvable")
    b = specs.get("specB", {}).get("unresolvable")
    c = specs.get("specC", {})
    if agreement is not None and agreement.get("agree") is True:
        return "BOUNDARY_SETTLED", "both readers drew the same boundary"
    if a is True and b is True:
        return "BOUNDARY_UNRESOLVED", "both readers declared the boundary undrawable"
    if not c:
        return None, "split with no third reading on file"
    if c.get("unresolvable") is True:
        return "BOUNDARY_UNRESOLVED", "the third reading found the rule does not settle it"
    return "BOUNDARY_SETTLED", "the third reading resolved the split"


def main():
    manifest = json.load(open(os.path.join(V7, "benchmark-manifest.json")))
    specs, agreements = {}, {}
    for name in os.listdir(os.path.join(V7, "oracle-specs")):
        cand, spec = name[:-5].rsplit(".", 1)
        specs.setdefault(cand, {})[spec] = json.load(
            open(os.path.join(V7, "oracle-specs", name)))
    for name in os.listdir(os.path.join(V7, "spec-agreement")):
        d = json.load(open(os.path.join(V7, "spec-agreement", name)))
        agreements[d["_candidate_id"]] = d

    drift, population = [], []
    for c in manifest["candidates"]:
        cid = c["candidate_id"]
        status, how = boundary_status(cid, specs.get(cid, {}), agreements.get(cid))
        if status is None:
            drift.append({"kind": "boundary-underivable", "what": cid, "detail": how})

        controls = {}
        for name in ("goodA", "goodB", "badA"):
            ctl = c["controls"].get(name)
            if not ctl:
                controls[name] = None
                continue
            controls[name] = {
                "path": ctl["path"],
                "recorded_sha256": ctl.get("sha256"),
                "verified_sha256": verify(ctl["path"], ctl.get("sha256"), drift,
                                          f"{cid} controls.{name}"),
            }

        population.append({
            "candidate_id": cid,
            "repository_id": c["repository_id"],
            "snapshot": {
                "repository_id": c["snapshot"]["repository_id"],
                "snapshot_commit": c["snapshot"]["snapshot_commit"],
                "bundle_path": c["snapshot"]["bundle_path"],
                "bundle_sha256": c["snapshot"]["bundle_sha256"],
                "verified_bundle_sha256": verify(
                    c["snapshot"]["bundle_path"], c["snapshot"]["bundle_sha256"],
                    drift, f"{cid} snapshot bundle"),
            },
            "task": {
                "path": c["task"]["path"],
                "recorded_sha256": c["task"]["sha256"],
                "verified_sha256": verify(c["task"]["path"], c["task"]["sha256"],
                                          drift, f"{cid} task"),
                "task_prompt_sha256": c["task"]["task_prompt_sha256"],
            },
            "task_acceptance": c["task_acceptance"],
            "regression_acceptance": c["regression_acceptance"],
            "baseline_evidence": c["base_verification"],
            "controls": controls,
            "bad_a_semantic_judgement": {
                "path": c["semantic_judgement"]["path"],
                "recorded_sha256": c["semantic_judgement"]["sha256"],
                "verified_sha256": verify(
                    c["semantic_judgement"]["path"], c["semantic_judgement"]["sha256"],
                    drift, f"{cid} bad A judgement"),
            },
            "source_decision_packet": c["decision"],
            "v7_boundary_status": status,
            "v7_boundary_derived_from": how,
        })

    fw = manifest["firewall_evidence"]
    verify(fw["path"], fw.get("sha256"), drift, "firewall evidence")

    settled = sum(1 for p in population if p["v7_boundary_status"] == "BOUNDARY_SETTLED")
    unresolved = sum(1 for p in population
                     if p["v7_boundary_status"] == "BOUNDARY_UNRESOLVED")
    counts_agree = settled == 8 and unresolved == 9

    out = {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-task-population",
        "what_this_is":
            "The seventeen tasks frozen for measurement, with every referenced "
            "artifact rehashed from the file rather than copied from v7's manifest.",
        "source_manifest": {
            "path": "bench/cdeb/studies/cdeb-fresh-v7/benchmark-manifest.json",
            "sha256": sha256_file(
                "bench/cdeb/studies/cdeb-fresh-v7/benchmark-manifest.json"),
        },
        "firewall_evidence": {
            "path": fw["path"], "recorded_sha256": fw.get("sha256"),
            "verified_sha256": sha256_file(fw["path"]),
        },
        "counts": {
            "total": len(population),
            "agent-operator-score": sum(
                1 for p in population if p["repository_id"] == "agent-operator-score"),
            "gitseed": sum(1 for p in population if p["repository_id"] == "gitseed"),
            "boundary_settled": settled,
            "boundary_unresolved": unresolved,
        },
        "boundary_derivation":
            "v7 published the split as counts only. Derived here: readers agreeing a "
            "boundary is settled; both declaring it undrawable is unresolved; "
            "otherwise the third reading's own unresolvable flag decides.",
        "boundary_counts_match_v7_result": counts_agree,
        "boundary_status_is_descriptive_only":
            "Section 23.8 reports these separately. They do not split or reselect the "
            "primary population, and BOUNDARY_UNRESOLVED is neither an exclusion nor a "
            "hold reason in v8.",
        "good_control_bytes_exist": False,
        "good_control_caveat":
            "goodA and goodB hashes are digests of v6's prose account of each control, "
            "not of patch bytes. v6 never wrote the Good A/B implementations to a file "
            "and they are unrecoverable; see cdeb-fresh-v7/control-availability.json. "
            "Only the seventeen Bad A patches survive as bytes.",
        "drift": drift,
        "import_valid": not drift and counts_agree,
        "candidates": population,
    }

    dest = os.path.join(V8, "task-population.json")
    json.dump(out, open(dest, "w"), indent=2, sort_keys=True)
    open(dest, "a").write("\n")

    print(f"  candidates      {out['counts']['total']} "
          f"(aos {out['counts']['agent-operator-score']}, "
          f"gitseed {out['counts']['gitseed']})")
    print(f"  boundary        settled {settled}, unresolved {unresolved} "
          f"-- matches v7 result: {counts_agree}")
    print(f"  drift           {len(drift)}")
    for d in drift[:10]:
        print(f"    {d['kind']}: {d['what']}  {d.get('path','')}")
    print(f"  import_valid    {out['import_valid']}")
    print(f"  wrote           {os.path.relpath(dest, ROOT)}")
    return 0 if out["import_valid"] else 1


if __name__ == "__main__":
    sys.exit(main())
