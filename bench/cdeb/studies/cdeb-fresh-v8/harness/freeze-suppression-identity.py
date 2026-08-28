#!/usr/bin/env python3
"""What SUPPRESSED removes, named structurally, for all seventeen.

The episode runner needs one thing the frozen population does not carry: which
record to withhold. Sixteen candidates have a `record_id`. The seventeenth,
v4-34aef026d81c2f6b, has none -- its decision is addressed by storage locator and
ordinal instead, and section 15's manipulation preflight established that the
commit it names selects exactly one of the 66 records its path scope returns.

This lives beside the population rather than inside it for two reasons. The
identity comes from the manipulation preflight (section 15), not from the task
import (section 14), and putting it in task-population.json would misattribute
where it was established. And the population is hashed into the schedule seed, so
adding a field to it would force a third re-freeze of a schedule nothing has run
against -- churn that buys nothing.

Suppression is structural in every case. Nothing here matches on ruling or reason
text: a substring rule would remove whatever happens to share wording, which is a
different manipulation from the one the study registered.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
V8 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v8")


def sha256_file(rel):
    h = hashlib.sha256()
    with open(os.path.join(ROOT, rel), "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    population = json.load(open(os.path.join(V8, "task-population.json")))
    preflight = json.load(open(os.path.join(V8, "preflight/manipulation-preflight.json")))
    fallback_text = preflight["structural_identity"].get("fallback_for_one_candidate", "")

    entries, without = [], []
    for candidate in population["candidates"]:
        decision = candidate["source_decision_packet"]
        record_id = decision.get("record_id")
        if record_id:
            entries.append({
                "candidate_id": candidate["candidate_id"],
                "kind": "record-id",
                "record_id": record_id,
                "source": "task-population.json source_decision_packet.record_id",
            })
            continue
        without.append(candidate["candidate_id"])
        if candidate["candidate_id"] not in fallback_text:
            entries.append({
                "candidate_id": candidate["candidate_id"],
                "kind": "unresolved",
                "source": "no record_id and no preflight fallback names this candidate",
            })
            continue
        entries.append({
            "candidate_id": candidate["candidate_id"],
            "kind": "storage-locator",
            "storage_kind": "commit-trailer",
            "storage_locator": "commit:f9a62917",
            "commit_sha_prefix": "f9a62917",
            "matched_field": "the record's sha/shas. A record carries no "
                             "storageLocator field, so matching on one finds nothing "
                             "and suppresses nothing -- and an arm that suppresses "
                             "nothing is indistinguishable from ON while reporting "
                             "as SUPPRESSED.",
            "decision_ordinal": 0,
            "source": "preflight/manipulation-preflight.json structural_identity."
                      "fallback_for_one_candidate",
            "why_it_is_unique": "the commit it names addresses exactly one record of "
                                "the 66 its path scope returns, established by the "
                                "section 15 preflight",
        })

    unresolved = [e for e in entries if e["kind"] == "unresolved"]
    out = {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-suppression-identity",
        "what_this_is":
            "The structured identity the SUPPRESSED arm removes, for each of the "
            "seventeen. The episode runner refuses an assignment whose identity is "
            "unresolved, and refuses a suppression that removes a number of records "
            "other than one.",
        "never_substring":
            "No entry matches on ruling or reason text. Removing whatever shares "
            "wording is a different manipulation from the one registered, and it "
            "would take the ruling out of records the study is not suppressing.",
        "sources": {
            "task-population.json": sha256_file(
                "bench/cdeb/studies/cdeb-fresh-v8/task-population.json"),
            "preflight/manipulation-preflight.json": sha256_file(
                "bench/cdeb/studies/cdeb-fresh-v8/preflight/manipulation-preflight.json"),
        },
        "counts": {
            "total": len(entries),
            "by_record_id": sum(1 for e in entries if e["kind"] == "record-id"),
            "by_storage_locator": sum(1 for e in entries if e["kind"] == "storage-locator"),
            "unresolved": len(unresolved),
        },
        "candidates_without_a_record_id": without,
        "all_resolved": not unresolved,
        "identities": entries,
    }

    dest = os.path.join(V8, "suppression-identity.json")
    with open(dest, "w") as fh:
        json.dump(out, fh, indent=2, sort_keys=True)
        fh.write("\n")

    print(f"  identities      {out['counts']['total']} "
          f"({out['counts']['by_record_id']} by record id, "
          f"{out['counts']['by_storage_locator']} by storage locator)")
    print(f"  unresolved      {out['counts']['unresolved']}")
    print(f"  wrote           {os.path.relpath(dest, ROOT)}")
    return 0 if out["all_resolved"] else 1


if __name__ == "__main__":
    sys.exit(main())
