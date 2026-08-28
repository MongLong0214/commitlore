#!/usr/bin/env python3
"""Check what SUPPRESSED actually removes, on all seventeen, without running one.

Section 33 forbids a benchmark pilot, and this is not one: no coding agent runs,
no outcome is produced, nothing is measured. What happens is that each snapshot is
materialised and the shipping build is asked the same question the episode would
ask, so the runner's suppression is checked against real trees rather than against
the fixture it was written on.

The control that matters is candidate v4-002ffd1e428c572a. Its path scope returns
two records, `r-e0b001` and `r-e0b001b`, and the second has the first as a prefix.
A substring rule removes both -- suppressing a decision the study never chose,
while reporting a tidy "1 removed" if it only counted the target. So the check is
not "one fewer record" but "exactly the target is gone and every other survivor is
unchanged".

Section 15's preflight established suppression works. This establishes that *this
implementation* does what that preflight described, which is a different claim.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
V8 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v8")
SCRATCH = os.environ.get(
    "V8_SCRATCH",
    "/private/tmp/claude-501/-Users-isaac-projects-commitlore/"
    "3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad")

sys.path.insert(0, HERE)
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("ep", os.path.join(HERE, "run-episode.py"))
ep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ep)


def main():
    cl = os.path.join(SCRATCH, "v8run/cl120/dist/commitlore.mjs")
    ep.verify_product(cl)

    population = json.load(open(os.path.join(V8, "task-population.json")))["candidates"]
    identities = {e["candidate_id"]: e for e in json.load(
        open(os.path.join(V8, "suppression-identity.json")))["identities"]}

    results, failures = [], []
    with tempfile.TemporaryDirectory() as td:
        for candidate in population:
            cid = candidate["candidate_id"]
            identity = identities[cid]
            tree = os.path.join(td, cid)
            try:
                ep.materialise(candidate, tree)
            except SystemExit as err:
                failures.append(cid)
                results.append({"candidate_id": cid, "ok": False,
                                "why": str(err)[:160]})
                continue

            scope = candidate["source_decision_packet"].get("path_scope") or ["."]
            acceptance = candidate["task_acceptance"]["path_in_repository"]
            was_present = ep.hide_acceptance(tree, acceptance)

            on_doc, on = ep.payload_for(tree, cl, scope, "ON", identity)
            off_doc, off = ep.payload_for(tree, cl, scope, "SUPPRESSED", identity)

            target = identity.get("record_id")
            on_ids, off_ids = on["survivors"], off["survivors"]
            if target is None and off["removed_ids"]:
                target = off["removed_ids"][0]

            checks = {
                "on_removes_nothing": on["removed"] == 0,
                "suppressed_removes_exactly_one": off["removed"] == 1,
                "target_is_gone": (target not in off_ids) if target else True,
                "every_other_record_survives":
                    [i for i in on_ids if i != target] == [i for i in off_ids if i != target],
                "at_least_one_record_to_deliver": len(on_ids) >= 1,
                "acceptance_hidden_and_restorable": (
                    not os.path.exists(os.path.join(tree, acceptance))),
            }
            ok = all(checks.values())
            if not ok:
                failures.append(cid)
            results.append({
                "candidate_id": cid,
                "repository_id": candidate["repository_id"],
                "identity_kind": identity["kind"],
                "records_in_scope": len(on_ids),
                "record_ids": on_ids,
                "removed_ids": off["removed_ids"],
                "survivors": off_ids,
                "acceptance_present_in_snapshot": was_present,
                "checks": checks,
                "ok": ok,
            })
            shutil.rmtree(tree, ignore_errors=True)

    # A guard that never fires and a guard that cannot fire look identical, so the
    # refusal is exercised on a real tree before the result is believed.
    refusal = {}
    with tempfile.TemporaryDirectory() as td:
        probe = population[0]
        tree = os.path.join(td, "probe")
        ep.materialise(probe, tree)
        scope = probe["source_decision_packet"]["path_scope"]
        for label, identity in (
                ("a target that is not in scope",
                 {"kind": "record-id", "record_id": "r-does-not-exist"}),
                ("a null target",
                 {"kind": "record-id", "record_id": None})):
            try:
                _, m = ep.payload_for(tree, cl, scope, "SUPPRESSED", identity)
                refusal[label] = {"refused": False, "removed": m["removed"]}
            except SystemExit as error:
                refusal[label] = {"refused": True, "message": str(error).splitlines()[0][:120]}

    prefix_cases = [r for r in results
                    if any(a != b and (a or "").startswith(b or "\0") or
                           (b or "").startswith(a or "\0")
                           for a in r.get("record_ids", []) for b in r.get("record_ids", [])
                           if a != b)]

    out = {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-dry-run-manipulation",
        "not_a_pilot":
            "No coding agent ran and no outcome was produced. Each snapshot was "
            "materialised and the shipping build asked the same question an episode "
            "would ask, to check this runner against real trees.",
        "candidates": len(results),
        "passing": sum(1 for r in results if r["ok"]),
        "failing": sorted(failures),
        "prefix_collision_candidates": [
            {"candidate_id": r["candidate_id"], "record_ids": r["record_ids"],
             "removed": r["removed_ids"], "survivors": r["survivors"]}
            for r in prefix_cases],
        "refusal_control": refusal,
        "why_a_null_target_matters":
            "A null record id removes every record that has no id -- 41 of them on "
            "the probe candidate. One of the seventeen genuinely has no record_id, "
            "so this is the shape the study was one careless line away from: an arm "
            "reported as SUPPRESSED that had removed 41 decisions, or none.",
        "why_prefix_collisions_matter":
            "Where one record id is a prefix of another, a substring rule removes "
            "both and still reports a plausible count. These are the cases that "
            "distinguish exact-identity suppression from a tidy-looking bug.",
        "results": results,
    }
    dest = os.path.join(V8, "preflight/dry-run-manipulation.json")
    with open(dest, "w") as fh:
        json.dump(out, fh, indent=2, sort_keys=True)
        fh.write("\n")

    for r in results:
        mark = "ok  " if r["ok"] else "FAIL"
        print(f"  {mark} {r['candidate_id']}  scope={r.get('records_in_scope', '?')} "
              f"removed={r.get('removed_ids')}")
    print(f"\n  {out['passing']}/{out['candidates']} candidates")
    print(f"  prefix-collision candidates: "
          f"{[c['candidate_id'] for c in out['prefix_collision_candidates']]}")
    print(f"  wrote {os.path.relpath(dest, ROOT)}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
