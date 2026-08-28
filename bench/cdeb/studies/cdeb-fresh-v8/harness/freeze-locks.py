#!/usr/bin/env python3
"""Section 13's three missing locks: snapshot, product, and the v7 boundary archive.

The layout in section 13 lists snapshot-lock.json, product-lock.json and
v7-boundary-metadata.json. v8 had none of them; the product identity was reachable
only through runtime-lock.json and study.json, and the snapshot identity only by
following task-population.json back into v7's manifest.

The snapshot lock is the one that matters. A hostile review found that
task-population.json records `verified_bundle_sha256` for two bundles that are not
in the repository at all -- `bench/cdeb/studies/*/corpus/bundles/` is gitignored --
so `import_valid: true` was true on the machine that wrote it and unreproducible
anywhere else. The policy is deliberate and predates this study (r-v3sealedcensus
ruled out committing them: large binaries, with a recorded digest and a refusal on
mismatch giving the same integrity guarantee). What was missing is the sentence v7
already wrote and this study dropped:

    that guarantees integrity, not availability

So every verified path here is classified against `git ls-files`. A digest checked
against a tracked file and a digest checked against a local artifact are different
claims, and an artifact that renders them identically invites exactly the reading
the review made.
"""
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
V7 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v7")
V8 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v8")


def sha256_file(rel):
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def tracked(rel):
    """Whether git carries this path, which is what a fresh clone will have."""
    out = subprocess.run(["git", "-C", ROOT, "ls-files", "--error-unmatch", rel],
                         capture_output=True, text=True)
    return out.returncode == 0


def classify(rel, recorded):
    """A verified digest, plus what it was verified against."""
    actual = sha256_file(rel)
    return {
        "path": rel,
        "recorded_sha256": recorded,
        "verified_sha256": actual,
        "present_on_this_machine": actual is not None,
        "tracked_in_git": tracked(rel),
        "matches": actual is not None and (recorded is None or actual == recorded),
    }


def snapshot_lock():
    v7lock = json.load(open(os.path.join(V7, "snapshot-lock.json")))
    population = json.load(open(os.path.join(V8, "task-population.json")))

    seen, repositories = {}, []
    for candidate in population["candidates"]:
        snap = candidate["snapshot"]
        key = snap["repository_id"]
        if key in seen:
            continue
        seen[key] = True
        entry = classify(snap["bundle_path"], snap["bundle_sha256"])
        entry["repository_id"] = key
        entry["snapshot_commit"] = snap["snapshot_commit"]
        repositories.append(entry)

    untracked = [r for r in repositories if not r["tracked_in_git"]]
    return {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-snapshot-lock",
        "source": "bench/cdeb/studies/cdeb-fresh-v7/snapshot-lock.json",
        "source_sha256": sha256_file(
            "bench/cdeb/studies/cdeb-fresh-v7/snapshot-lock.json"),
        "no_resnapshot": True,
        "source_snapshot_cutoff": v7lock.get("source_snapshot_cutoff"),
        "repositories": repositories,
        "bundles_tracked_in_git": len(repositories) - len(untracked),
        "bundles_untracked": len(untracked),
        "bundles_are_untracked_by_design": v7lock.get("bundles_are_untracked_by_design"),
        "what_the_digest_does_and_does_not_give":
            "Integrity, not availability. Every bundle digest here was verified by "
            "reading the file on the machine that wrote this lock, and a run whose "
            "bytes differ is refused. A fresh clone has no bundles at all, so it "
            "cannot repeat that verification and cannot instantiate a base tree "
            "without obtaining them separately. task-population.json's "
            "`import_valid` is a statement about this machine for exactly this "
            "reason, and says so.",
        "what_a_clone_can_still_check":
            "The snapshot commit sha is recorded per repository, so anyone holding "
            "the source repository can rebuild the bundle at that commit and compare "
            "against the digest here.",
    }


def product_under_test(pinned):
    """The build the episodes actually invoke, which is not the checked-out one.

    episode.py runs a materialized v1.2.0 build from outside the repository, and
    the tree's own dist/ has moved on since v1.2.0. Comparing the pin against
    dist/commitlore.mjs would therefore report a mismatch every time and say
    nothing about what the study runs. What matters is whether the build the
    harness invokes is the pinned one, and whether it is still there at all --
    it lives in a scratch directory that does not survive a session boundary.
    """
    import re

    source = open(os.path.join(HERE, "episode.py")).read()
    sp = re.search(r'^SP = "([^"]+)"', source, re.M)
    cl = re.search(r'^CL = f"\{SP\}/(.+)"', source, re.M)
    if not sp or not cl:
        return {"resolved": False,
                "why": "episode.py no longer declares SP and CL in the expected form"}
    path = os.path.join(sp.group(1), cl.group(1))
    if not os.path.exists(path):
        return {"resolved": True, "path": path, "present": False,
                "matches_pin": False,
                "why": "the build the harness invokes is not on this machine"}
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    digest = h.hexdigest()
    return {"resolved": True, "path": path, "present": True,
            "sha256": digest, "matches_pin": digest == pinned,
            "outside_the_repository": True,
            "availability_caveat":
                "This path is a scratch directory. It is not tracked, not backed "
                "up, and has been lost at a session boundary before. episode.py "
                "verifies this digest before every episode so a missing or "
                "different build stops the run instead of silently changing what "
                "was measured."}


def product_lock():
    v7lock = json.load(open(os.path.join(V7, "product-lock.json")))
    dist = classify("dist/commitlore.mjs", v7lock["dist_sha256_measured"])
    under_test = product_under_test(v7lock["dist_sha256_measured"])
    return {
        "product_under_test": under_test,
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-product-lock",
        "source": "bench/cdeb/studies/cdeb-fresh-v7/product-lock.json",
        "source_sha256": sha256_file(
            "bench/cdeb/studies/cdeb-fresh-v7/product-lock.json"),
        "product_release_tag": v7lock["product_release_tag"],
        "tag_resolves_to_commit": v7lock["tag_resolves_to_commit"],
        "dist_artifact": v7lock["dist_artifact"],
        "dist_sha256_pinned": v7lock["dist_sha256_measured"],
        "dist_as_checked_out_here": dist,
        "checked_out_dist_matches_the_pin": dist["matches"],
        "why_the_checked_out_dist_is_informational":
            "The tree has moved past v1.2.0, so dist/commitlore.mjs is expected to "
            "differ from the pin. It is recorded because a reader who sees only a "
            "digest will assume it is the one that ran.",
        "why_this_is_carried_forward_rather_than_remeasured":
            "v8 measures the same shipping build v7 pinned. Remeasuring would let "
            "the pinned identity follow whatever happens to be checked out, which is "
            "the drift the lock exists to catch.",
    }


def boundary_metadata():
    population = json.load(open(os.path.join(V8, "task-population.json")))
    specs = sorted(os.listdir(os.path.join(V7, "oracle-specs")))
    agreements = sorted(os.listdir(os.path.join(V7, "spec-agreement")))
    return {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-v7-boundary-metadata",
        "what_this_is":
            "v7's per-candidate boundary status, kept as a metadata archive. "
            "Section 14 preserves the v7 spec A/B/C readings and section 7.3 keeps "
            "them out of the judge packet, so this file names them by path and does "
            "not inline them.",
        "not_shown_to_judges": True,
        "descriptive_only":
            "Section 23.8 reports boundary strata separately. They do not split or "
            "reselect the primary population, and BOUNDARY_UNRESOLVED is neither an "
            "exclusion nor a hold reason in v8.",
        "counts": {
            "settled": population["counts"]["boundary_settled"],
            "unresolved": population["counts"]["boundary_unresolved"],
        },
        "archive": {
            "oracle_specs_dir": "bench/cdeb/studies/cdeb-fresh-v7/oracle-specs",
            "oracle_spec_files": len(specs),
            "spec_agreement_dir": "bench/cdeb/studies/cdeb-fresh-v7/spec-agreement",
            "spec_agreement_files": len(agreements),
        },
        "candidates": [
            {"candidate_id": c["candidate_id"],
             "repository_id": c["repository_id"],
             "v7_boundary_status": c["v7_boundary_status"],
             "derived_from": c["v7_boundary_derived_from"]}
            for c in population["candidates"]
        ],
    }


def main():
    written = []
    for name, builder in (("snapshot-lock.json", snapshot_lock),
                          ("product-lock.json", product_lock),
                          ("v7-boundary-metadata.json", boundary_metadata)):
        doc = builder()
        dest = os.path.join(V8, name)
        with open(dest, "w") as fh:
            json.dump(doc, fh, indent=2, sort_keys=True)
            fh.write("\n")
        written.append((name, doc))

    snap = dict(written)["snapshot-lock.json"]
    prod = dict(written)["product-lock.json"]
    for repo in snap["repositories"]:
        print(f"  snapshot {repo['repository_id']:22} present={repo['present_on_this_machine']} "
              f"tracked={repo['tracked_in_git']} matches={repo['matches']}")
    ut = prod["product_under_test"]
    print(f"  product  under test matches the pin: {ut.get('matches_pin')}  "
          f"({ut.get('path', 'unresolved')})")
    print(f"  product  checked-out dist matches the pin: "
          f"{prod['checked_out_dist_matches_the_pin']} (informational)")
    print(f"  wrote    {', '.join(n for n, _ in written)}")

    ok = (all(r["matches"] for r in snap["repositories"])
          and prod["product_under_test"].get("matches_pin") is True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
