#!/usr/bin/env python3
"""Build a judge packet for both arms of the synthetic episode and audit it.

Section 17 requires a judge-packet simulation before execution. The thing to prove
is not that a packet can be built -- it is that a packet built from the ON arm and
one built from the SUPPRESSED arm are, on their face, the same kind of object. If
a judge can tell which arm a packet came from without reading the code, the panel
is scoring the arm rather than the tree.

The final trees were destroyed with their worktrees, as the protocol requires, so
they are reconstructed here from committed bytes: rebuild the fixture, apply that
arm's committed diff. Nothing is taken from a working directory.

The audit is section 11.4. It scans for the arm words, the record id, assignment
files, delivery logs and CommitLore markers. Two things it deliberately does not
do: it does not redact agent-written source or comments, because a judge reading a
redacted tree is reading something the agent did not produce; and it does not treat
the English word "on" as a cue, only the standalone token.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
V8 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v8")
SMOKE = os.path.join(V8, "preflight/synthetic-smoke")

# The salt exists so a packet id cannot be reversed into a candidate by anyone
# holding the candidate list. It is committed because the mapping has to be
# reproducible after the judgements are sealed; it is not a secret, it is a
# separator. Section 21.4 governs when the mapping may be revealed.
PACKET_SALT = "cdeb-fresh-v8-packet"

TASK_PROMPT = """Make the cache actually cache.

`Cache.get(key)` currently raises. It should return the loaded value, and a
repeated read of the same key must not call the loader again. `stats()` should
report hits and misses.

The acceptance test is tests/test_cache.py. Read it; your implementation must make
it pass. Do not modify the test.
"""

# Section 7.3: the judge sees the ruling and its reason, not the record that
# carries them and not who delivered what.
DECISION = {
    "ruling": "keep the cache unbounded for now",
    "reason": ("the working set is small and bounded by the caller, so an eviction "
               "policy would add a knob nobody can tune from evidence yet"),
    "ruled_out": ("a time-to-live expiry on cache entries -- callers cannot say what "
                  "a correct lifetime is, and a wrong one silently reintroduces the "
                  "loader calls the cache exists to remove"),
    "scope": "src/cache.py",
    "lifecycle": "active",
}

EXCLUDED_FROM_PACKET = [
    ".git", "delivered.txt", "payload.json", "prompt.txt", "events.jsonl",
    "row.json", "err.txt", "assignment.json",
]

CUE_PATTERNS = [
    ("arm-word-on", re.compile(r"\bON\b")),
    ("arm-word-suppressed", re.compile(r"SUPPRESSED", re.I)),
    ("record-id", re.compile(r"\bRecord-Id\b|\br-[0-9a-z]{6,}\b")),
    ("experiment-assignment", re.compile(r"\barm\b|\bepisode_index\b|\brepetition\b", re.I)),
    ("delivery-log", re.compile(r"delivered_sha256|target_blocks_removed|payload_records")),
    ("commitlore-marker", re.compile(r"Ruled-out:|Limit:|Provenance:|Certainty:|Blast:|Undo:")),
]


def opaque_id(arm, candidate):
    return hashlib.sha256(f"{PACKET_SALT}|{candidate}|{arm}".encode()).hexdigest()[:24]


def build_tree(arm, workdir):
    """Rebuild the fixture and apply that arm's committed diff."""
    fixture = os.path.join(workdir, f"{arm}-fixture")
    env = dict(os.environ, F=fixture)
    r = subprocess.run(["bash", os.path.join(HERE, "make-synthetic.sh")],
                       capture_output=True, text=True, env=env)
    # make-synthetic.sh writes to its own hardcoded scratch path; copy from there.
    built = re.search(r"fixture: (\S+)", r.stdout)
    if not built:
        return None, f"fixture build produced no path: {r.stdout.strip()[:120]} {r.stderr.strip()[:120]}"
    shutil.rmtree(fixture, ignore_errors=True)
    shutil.copytree(built.group(1), fixture, symlinks=True)

    patch = os.path.join(SMOKE, f"{arm}.diff.patch")
    if os.path.getsize(patch) > 0:
        ap = subprocess.run(["git", "-C", fixture, "apply", patch],
                            capture_output=True, text=True)
        if ap.returncode != 0:
            return None, f"diff did not apply: {ap.stderr.strip()[:160]}"
    return fixture, None


def collect(tree):
    """The tree as the judge sees it: tracked source, no experiment plumbing."""
    files = {}
    for dirpath, dirnames, filenames in os.walk(tree):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_FROM_PACKET]
        for fn in filenames:
            if fn in EXCLUDED_FROM_PACKET:
                continue
            rel = os.path.relpath(os.path.join(dirpath, fn), tree)
            try:
                files[rel] = open(os.path.join(dirpath, fn), encoding="utf8").read()
            except (UnicodeDecodeError, OSError):
                files[rel] = "<binary>"
    return files


def audit(packet):
    """Section 11.4, over every string the judge can read."""
    hits = []
    for field, text in packet["_scannable"].items():
        for name, pat in CUE_PATTERNS:
            for m in pat.finditer(text):
                hits.append({"cue": name, "where": field,
                             "match": m.group(0)[:40],
                             "context": text[max(0, m.start() - 45):m.end() + 45]
                                        .replace("\n", " ")[:110]})
    return hits


# A scanner that finds nothing and a scanner that cannot find anything print the
# same zero. These run every time, so "0 cues" is only ever reported next to
# evidence that each cue is detectable and that ordinary prose does not fire.
CUE_PROBES = {
    "arm-word-on": "# run under ON conditions",
    "arm-word-suppressed": "# this tree came from the SUPPRESSED arm",
    "record-id": "Record-Id: r-synthcache02",
    "experiment-assignment": '{"arm": "ON", "repetition": 3}',
    "delivery-log": '"target_blocks_removed": 1',
    "commitlore-marker": "Ruled-out: a time-to-live expiry",
}
BENIGN_PROBES = [
    "the loader is called on a miss",
    "turn it on and off",
    "python -m pytest ran on the tree",
    "keys are retained on insert",
]


def scanner_negative_control():
    detected = {}
    for cue, text in CUE_PROBES.items():
        found = sorted({h["cue"] for h in audit({"_scannable": {"probe": text}})})
        detected[cue] = {"detected": cue in found, "also_matched": [f for f in found if f != cue]}
    benign = {t: sorted({h["cue"] for h in audit({"_scannable": {"probe": t}})})
              for t in BENIGN_PROBES}
    return {
        "every_cue_detectable": all(v["detected"] for v in detected.values()),
        "no_benign_text_fires": all(not v for v in benign.values()),
        "per_cue": detected,
        "benign_probes": benign,
        "note": "Some probes match more than one pattern -- an assignment blob that "
                "names the ON arm trips both. Overlap is not a defect; a cue going "
                "undetected would be.",
    }


def constructed_cases(base_files, diff):
    """Two cases the real arms cannot supply.

    The smoke's two arms produced byte-identical diffs -- the agent wrote the same
    cache with and without the record -- so comparing their packets shows only that
    identical inputs look identical. These supply what that comparison is missing:
    a pair whose trees genuinely differ, and a tree carrying a leak, so the audit
    is asked a question it can fail.
    """
    def packet(files, d):
        p = {"packet_id": "constructed", "decision": DECISION,
             "task_prompt": TASK_PROMPT, "base_to_final_diff": d, "final_tree": files}
        p["_scannable"] = dict({f"final_tree/{k}": v for k, v in files.items()},
                               diff=d, task_prompt=TASK_PROMPT,
                               decision=json.dumps(DECISION))
        return p

    # A different but equally clean implementation: same behaviour, other wording.
    other = dict(base_files)
    other["src/cache.py"] = base_files["src/cache.py"].replace(
        "self._hits", "self._hit_count").replace("self._misses", "self._miss_count")
    differ = other != base_files
    a, b = packet(base_files, diff), packet(other, diff)
    shape_same = sorted(k for k in a if not k.startswith("_")) == \
        sorted(k for k in b if not k.startswith("_"))
    clean_pair_cues = len(audit(a)) + len(audit(b))

    # A leak: the delivery payload written into the tree, which is what the
    # exclusion list exists to prevent and what section 11.4 must catch if it slips.
    leaked = dict(base_files)
    leaked["notes.txt"] = (
        'episode assignment: {"arm": "SUPPRESSED", "repetition": 4}\n'
        '"target_blocks_removed": 1\n'
        "Ruled-out: a time-to-live expiry on cache entries\n")
    leak_hits = audit(packet(leaked, diff))

    return {
        "differing_trees_pair": {
            "trees_actually_differ": differ,
            "same_field_shape": shape_same,
            "arm_cues_found": clean_pair_cues,
            "means": "two genuinely different clean trees still yield packets of the "
                     "same shape with no arm cue",
        },
        "leaked_tree": {
            "arm_cue_present": bool(leak_hits),
            "cues_found": sorted({h["cue"] for h in leak_hits}),
            "means": "a tree carrying the assignment, the delivery counter and a "
                     "CommitLore trailer is flagged rather than passed through",
        },
    }


def main():
    results, packets = {}, {}
    with tempfile.TemporaryDirectory() as td:
        for arm in ("on", "suppressed"):
            tree, err = build_tree(arm, td)
            if err:
                print(f"  {arm}: {err}")
                return 1
            files = collect(tree)
            diff = open(os.path.join(SMOKE, f"{arm}.diff.patch"), encoding="utf8").read()
            packet = {
                "packet_id": opaque_id(arm, "synthetic-cache"),
                "decision": DECISION,
                "task_prompt": TASK_PROMPT,
                "base_to_final_diff": diff,
                "final_tree": files,
            }
            packet["_scannable"] = dict(
                {f"final_tree/{k}": v for k, v in files.items()},
                diff=diff, task_prompt=TASK_PROMPT,
                decision=json.dumps(DECISION), packet_id=packet["packet_id"])
            packets[arm] = packet
            results[arm] = audit(packet)

    nc = scanner_negative_control()
    cc = constructed_cases(packets["on"]["final_tree"],
                           packets["on"]["base_to_final_diff"])
    on, sup = packets["on"], packets["suppressed"]
    shape_same = sorted(k for k in on if not k.startswith("_")) == \
        sorted(k for k in sup if not k.startswith("_"))
    id_prefix_shared = os.path.commonprefix([on["packet_id"], sup["packet_id"]])

    # The decision block and the task are identical across arms by construction;
    # what differs is only the tree and the diff, which is what a judge must read.
    same_decision = on["decision"] == sup["decision"]
    same_task = on["task_prompt"] == sup["task_prompt"]

    out = {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-judge-packet-simulation",
        "not_a_product_effect_row": True,
        "fixture": "synthetic cache episode, both arms, trees reconstructed from "
                   "the committed fixture script and the committed per-arm diffs",
        "packets_built": 2,
        "packet_ids": {a: packets[a]["packet_id"] for a in packets},
        "shared_packet_id_prefix": id_prefix_shared,
        "checks": {
            "same_field_shape_across_arms": shape_same,
            "decision_block_identical_across_arms": same_decision,
            "task_prompt_identical_across_arms": same_task,
            "packet_ids_share_no_prefix": len(id_prefix_shared) == 0,
            "experiment_plumbing_excluded": EXCLUDED_FROM_PACKET,
        },
        "arm_cue_hits": results,
        "arm_cue_present": {a: bool(h) for a, h in results.items()},
        "scanner_negative_control": nc,
        "constructed_cases": cc,
        "real_arms_produced_identical_trees": True,
        "why_that_matters":
            "The smoke's ON and SUPPRESSED arms wrote byte-identical diffs "
            "(diff_sha256 47b2ded9 in both rows), so comparing their two packets "
            "shows only that identical inputs look identical. The constructed cases "
            "carry the blinding claim instead: a differing-but-clean pair, and a "
            "tree with a real leak that the audit must flag.",
        "what_this_does_not_prove":
            "One synthetic episode. A measured episode's tree is written by an agent "
            "that may name an arm word for its own reasons, so this shows the packet "
            "builder does not leak the arm, not that no measured packet ever will. "
            "Section 11.4 records arm_cue_present per packet for exactly that reason, "
            "and the cue-excluded sensitivity is where it is used.",
    }

    dest = os.path.join(V8, "preflight/judge-packet-simulation.json")
    json.dump(out, open(dest, "w"), indent=2, sort_keys=True)
    open(dest, "a").write("\n")

    for a in ("on", "suppressed"):
        print(f"  {a:11} packet {packets[a]['packet_id']}  cues {len(results[a])}")
        for h in results[a][:6]:
            print(f"    {h['cue']:22} {h['where'][:34]:34} {h['context'][:60]}")
    print(f"  same field shape        {shape_same}")
    print(f"  decision/task identical {same_decision and same_task}")
    print(f"  shared id prefix        {id_prefix_shared!r}")
    print(f"  wrote                   {os.path.relpath(dest, ROOT)}")
    print(f"  scanner control         every cue detectable: "
          f"{nc['every_cue_detectable']}, benign text clean: {nc['no_benign_text_fires']}")
    dp, lk = cc["differing_trees_pair"], cc["leaked_tree"]
    print(f"  differing clean pair    differ={dp['trees_actually_differ']} "
          f"same shape={dp['same_field_shape']} cues={dp['arm_cues_found']}")
    print(f"  leaked tree             flagged={lk['arm_cue_present']} {lk['cues_found']}")
    clean = (not any(results.values()) and shape_same and same_decision and same_task
             and not id_prefix_shared and nc["every_cue_detectable"]
             and nc["no_benign_text_fires"]
             and cc["differing_trees_pair"]["trees_actually_differ"]
             and cc["differing_trees_pair"]["same_field_shape"]
             and cc["differing_trees_pair"]["arm_cues_found"] == 0
             and cc["leaked_tree"]["arm_cue_present"])
    return 0 if clean else 1


if __name__ == "__main__":
    sys.exit(main())
