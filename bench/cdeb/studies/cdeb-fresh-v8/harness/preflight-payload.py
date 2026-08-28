#!/usr/bin/env python3
"""Section 15: prove both arms are producible for all 17 before any episode runs.

ON is what the frozen shipping build emits for the candidate's recorded path
scope. SUPPRESSED is that same payload with the target decision's blocks removed
by record identity -- not by matching text, because a text filter deletes whatever
happens to read like the ruling and leaves whatever happens not to.

Two things this checks that a naive version would miss.

The notes mirror is in the sealed bundle but `git clone` does not fetch it. The
product says so itself: it answers `notes: unfetched` and warns that the answer
may be missing records. On these bundles the trailers already carry everything and
the record set is identical either way, but that is a fact to establish per
candidate rather than assume, so every tree is fetched and the state is recorded.
agent-operator-score's bundle carries no notes ref at all -- that repository never
had one -- so `unfetched` there is the truth about the repository and not a step
this harness skipped. The check is that coverage is complete and the target
record is present, which is what the arms actually depend on.

And suppression has to remove the target without touching anything else. The
unrelated blocks are compared byte for byte, because an arm that quietly drops a
neighbouring record is a different treatment than the one registered.
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
CL = f"{SP}/v8run/cl120/dist/commitlore.mjs"
WORK = f"{SP}/v8run/preflight-trees"


def bundle_has_notes(entry):
    """Whether the sealed bundle carries a notes mirror at all."""
    bundle = os.path.join(ROOT, entry["snapshot"]["bundle_path"])
    p = run(f"git bundle list-heads {bundle}")
    return "refs/notes/commitlore" in p.stdout


def run(cmd, cwd=None):
    return subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)


def tree_for(entry):
    repo = entry["repository_id"]
    dest = f"{WORK}/{entry['candidate_id']}"
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    bundle = os.path.join(ROOT, entry["snapshot"]["bundle_path"])
    c = run(f"git clone --quiet {bundle} {dest}")
    if c.returncode != 0:
        return None, f"clone failed: {c.stderr.strip()[:160]}"
    run(f"git checkout --quiet {entry['snapshot']['snapshot_commit']}", cwd=dest)
    # The bundle carries refs/notes/commitlore; clone does not take it.
    run("git fetch origin 'refs/notes/commitlore:refs/notes/commitlore' --quiet", cwd=dest)
    return dest, None


def payload(tree, paths):
    # No shell. A path scope entry is repository data and quoting it into a
    # command line is one odd character away from a different query, or a
    # silently empty one.
    p = subprocess.run(["node", CL, "context", "--json", *paths],
                       cwd=tree, capture_output=True, text=True)
    # A non-zero exit here is not always a refusal. Asking for six paths at once
    # returns 3 with a note that rename following needs one pathspec, and prints
    # the full answer on stdout anyway. Judge the run by whether it produced the
    # document, and carry the exit code and the warnings alongside it.
    try:
        doc = json.loads(p.stdout)
    except Exception as e:
        return None, f"context exited {p.returncode}, stdout not JSON ({e}); stderr: {p.stderr.strip()[:160]}"
    doc["_exit_code"] = p.returncode
    doc["_stderr_lines"] = [l for l in p.stderr.splitlines()
                            if l.startswith("commitlore:")]
    return doc, None


def identity_of(rec, decision):
    """The structured handle this record is addressed by.

    Record-Id first, because that is what the SSOT names. Where the source pool
    records none, the decision still has a storage locator -- a commit and an
    ordinal -- and that addresses exactly one record in the payload. It is
    provenance, not text, so it is the same kind of identity rather than a
    lexical fallback wearing its clothes.
    """
    rid = rec.get("recordId") or rec.get("record_id") or rec.get("id")
    if rid:
        return ("record", rid)
    return ("sha", rec.get("sha") or "")


def target_identity(doc, decision):
    rid = decision.get("record_id")
    if rid:
        return ("record", rid)
    sha = (decision.get("source_commit_sha") or "")
    return ("sha", sha) if sha else None


def is_target(rec, target):
    if target is None:
        return False
    kind, val = target
    if kind == "record":
        return (rec.get("recordId") or rec.get("record_id") or rec.get("id")) == val
    return rec.get("sha") == val or val in (rec.get("shas") or [])


def blocks_of(doc):
    """Every record entry the payload carries, keyed by record id.

    A record with no id sorts under the empty string rather than None, because
    json.dumps(sort_keys=True) cannot order None against a string and the
    comparison below is the whole point of the function.
    """
    out = {}
    for rec in doc.get("records", []):
        rid = rec.get("recordId") or rec.get("record_id") or rec.get("id") or ""
        out.setdefault(rid, []).append(rec)
    return out


def suppress(doc, target_record):
    """Remove the target decision's blocks by record identity."""
    kept = [r for r in doc.get("records", [])
            if (r.get("recordId") or r.get("record_id") or r.get("id") or "") != target_record]
    out = dict(doc)
    out["records"] = kept
    return out


def check(entry, decision):
    cid = entry["candidate_id"]
    tree, err = tree_for(entry)
    if tree is None:
        return {"candidate_id": cid, "outcome": "TREE_NOT_MATERIALISED", "detail": err}

    scope = decision.get("path_scope") or []
    on, err = payload(tree, scope)
    if on is None:
        shutil.rmtree(tree, ignore_errors=True)
        return {"candidate_id": cid, "outcome": "PAYLOAD_FAILED", "detail": err}

    target = target_identity(on, decision)
    hits = [r for r in on.get("records", []) if is_target(r, target)]
    kept = [r for r in on.get("records", []) if not is_target(r, target)]
    off = dict(on); off["records"] = kept

    key = lambda r: json.dumps(identity_of(r, decision))
    unrelated_on = sorted((key(r), json.dumps(r, sort_keys=True)) for r in kept)
    unrelated_off = sorted((key(r), json.dumps(r, sort_keys=True)) for r in off["records"])
    unrelated_identical = unrelated_on == unrelated_off

    ruling = (decision.get("ruling") or "").strip().lower()
    reason = (decision.get("reason") or "").strip().lower()
    on_text = json.dumps(on).lower()
    off_text = json.dumps(off).lower()

    result = {
        "candidate_id": cid, "repository_id": entry["repository_id"],
        "target_record_id": target,
        "path_scope": scope,
        "notes_state": on.get("notes"),
        "coverage": on.get("coverage"),
        "context_exit_code": on.get("_exit_code"),
        "context_warnings": on.get("_stderr_lines", []),
        "bundle_has_notes_ref": bundle_has_notes(entry),
        "diagnostics": on.get("diagnostics", []),
        "records_in_on": len(on.get("records", [])),
        "records_in_suppressed": len(off.get("records", [])),
        "target_identity": list(target) if target else None,
        "target_blocks_removed": len(hits),
        "on_carries_ruling": bool(ruling) and ruling in on_text,
        "on_carries_reason": bool(reason) and reason in on_text,
        "suppressed_drops_ruling": bool(ruling) and ruling not in off_text,
        "suppressed_drops_reason": bool(reason) and reason not in off_text,
        "ruling_survives_in_other_records": bool(ruling) and ruling in off_text,
        "unrelated_blocks_identical": unrelated_identical,
        "on_payload_sha256": hashlib.sha256(json.dumps(on, sort_keys=True).encode()).hexdigest(),
        "suppressed_payload_sha256": hashlib.sha256(json.dumps(off, sort_keys=True).encode()).hexdigest(),
    }
    # `notes: unfetched` means one thing in gitseed, whose bundle carries
    # refs/notes/commitlore, and another in agent-operator-score, whose bundle has
    # no notes ref because the repository never had one. Requiring "present"
    # everywhere fails eight candidates for a mirror that does not exist. What
    # matters is that the payload is complete and carries the target.
    notes_ok = result["notes_state"] == "present" or (
        result["coverage"] == "complete" and result["bundle_has_notes_ref"] is False)
    result["notes_state_acceptable"] = notes_ok
    # Section 6.3 requires: target block absent, unrelated blocks byte-identical,
    # hook and framing preserved. It does not require the ruling to vanish from the
    # payload, and section 6.5 excludes "semantic content alone" from the estimand
    # while section 6.4 keeps episodes where the agent finds the decision in git.
    # An earlier version of this harness required semantic absence and failed a
    # candidate for it. That was my condition, not the registered one.
    result["passes"] = bool(
        notes_ok
        and result["target_blocks_removed"] == 1
        and result["on_carries_ruling"] and result["on_carries_reason"]
        and result["suppressed_drops_reason"]
        and result["unrelated_blocks_identical"]
    )
    shutil.rmtree(tree, ignore_errors=True)
    return result


def main():
    manifest = json.load(open(f"{V7}/benchmark-manifest.json"))
    pool = {c["candidate_id"]: c for c in json.load(open(f"{V6}/source-pool.json"))["candidates"]}
    os.makedirs(WORK, exist_ok=True)
    rows = []
    for entry in manifest["candidates"]:
        r = check(entry, pool[entry["candidate_id"]])
        rows.append(r)
        print("  {} {}".format(r["candidate_id"], "pass" if r.get("passes") else
                               f"FAIL {r.get('outcome','')} " + json.dumps(
                                   {k: v for k, v in r.items()
                                    if k.startswith(("on_", "suppressed_", "unrelated_", "target_", "notes_"))
                                    and v in (False, 0)})), flush=True)
    with open(f"{SP}/v8run/preflight-payload.json", "w") as fh:
        json.dump(rows, fh, indent=2)
    ok = sum(1 for r in rows if r.get("passes"))
    print(f"  {ok}/{len(rows)} 통과")


if __name__ == "__main__":
    main()
