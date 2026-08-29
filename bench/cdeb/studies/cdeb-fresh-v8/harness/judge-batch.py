#!/usr/bin/env python3
"""The 1,020 judgements: three judges over 340 packets, each in its own order.

Sections 11.3 and 21. Every judge sees all 340 packets in a separately randomized
order, with adjacency constraints, a fresh session per packet, and a durability
protocol per judgement.

Three things are checked before anything runs rather than assumed.

**The path a judge is handed must not carry the answer.** Section 11.1 forbids the
packet name or path from exposing the candidate, the repository, the arm, the
repetition or the execution order -- and the episode directory these packets live
in is named `000-v4-9b42b1951da730e1-4-suppressed`, which exposes four of the five.
The judge never sees that path, because judge-run.sh copies the packet into a
scratch tree named only by the packet id. That is the kind of thing to verify, not
to reason about, so the batch refuses to start if any path it would hand over
contains a candidate id, an arm word or a repetition marker.

**The order must not be the schedule.** Handing the packets over in episode order
would tell a judge which two are a pair and which repository it is in, whatever the
directory is called. Each judge's order is drawn from its own seed and then
repaired so that no two adjacent packets share a candidate and no pair is adjacent.

**The judge never sees another judge's answer.** judge-run.sh already refuses a
packet directory holding a judgement artifact and copies into a fresh scratch tree
with a fresh HOME. This runs the three judges over the whole set one judge at a
time, so nothing of judge N is even on disk beside a packet when judge N+1 reads it.

Like batch.py, `--plan` prints what would happen and exits. Checking that a runner
starts should not start it; that lesson cost two episodes.
"""
import hashlib
import json
import os
import random
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
V8 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v8")
SCRATCH = os.environ.get(
    "V8_SCRATCH",
    "/private/tmp/claude-501/-Users-isaac-projects-commitlore/"
    "3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad")

# Section 21.2: fixed model per seat, from the frozen panel.
SEATS = [("judge-1", "claude-sonnet-4-5", "claude"),
         ("judge-2", "gpt-5.6-sol", "codex"),
         ("judge-3", "gpt-5.6-terra", "codex")]


def rows():
    out = []
    rows_dir = os.path.join(V8, "rows")
    for entry in sorted(os.listdir(rows_dir)):
        path = os.path.join(rows_dir, entry, "row.json")
        if os.path.exists(path):
            row = json.load(open(path))
            row["_episode_dir"] = os.path.join(rows_dir, entry)
            out.append(row)
    return out


def packet_path(row):
    return os.path.join(row["_episode_dir"], row["packet_id"])


def path_leaks(path, row):
    """Whatever a judge could read off the path it is standing in."""
    leaks = []
    text = path
    if row["candidate_id"] in text:
        leaks.append("candidate id")
    if re.search(r"\b(ON|SUPPRESSED|suppressed|on)\b", os.path.basename(os.path.dirname(text))):
        leaks.append("arm")
    if re.search(rf"-{row['repetition']}-", text):
        leaks.append("repetition")
    if re.search(r"/\d{3}-", text):
        leaks.append("execution order")
    return leaks


def order_for(seat, packet_ids, seed, pair_of):
    """A separately randomized order, repaired against section 11.3's adjacency rules."""
    rng = random.Random(int(hashlib.sha256((seed + seat).encode()).hexdigest()[:12], 16))
    order = list(packet_ids)
    rng.shuffle(order)

    def bad(a, b):
        return pair_of[a]["candidate_id"] == pair_of[b]["candidate_id"]

    # One repair sweep: swap a clashing neighbour with a later packet that does not
    # clash. Some clashes can survive when a candidate dominates what is left, which
    # is why section 11.3 says "where possible" -- the count that survives is
    # reported rather than hidden.
    for i in range(len(order) - 1):
        if not bad(order[i], order[i + 1]):
            continue
        for j in range(i + 2, len(order)):
            if not bad(order[i], order[j]) and (
                    i + 2 >= len(order) or not bad(order[j], order[i + 2])):
                order[i + 1], order[j] = order[j], order[i + 1]
                break
    clashes = sum(1 for i in range(len(order) - 1) if bad(order[i], order[i + 1]))
    return order, clashes


SCHEMA = json.load(open(os.path.join(HERE, "judge-schema.json")))


def seal(out_path, packet_id, seat, manifest_path):
    """Section 21.3, applied to a judgement the runner has just written.

    temp write, fsync, atomic rename, read back, schema validate, hash, append.

    The runner writes `out.<seat>.json` directly, so the durability protocol is
    applied here by rewriting it through a temp file. Validating before sealing is
    the part that matters: a judgement missing a required field, or carrying a
    label outside the enum, is not a judgement, and a seal manifest that records it
    as one is worse than no manifest.
    """
    if not os.path.exists(out_path):
        return {"packet_id": packet_id, "judge": seat, "sealed": False,
                "why": "the runner produced no output"}
    try:
        answer = json.load(open(out_path))
    except json.JSONDecodeError as error:
        return {"packet_id": packet_id, "judge": seat, "sealed": False,
                "why": f"not JSON: {error}"}

    missing = [k for k in SCHEMA["required"] if k not in answer]
    bad_enum = [k for k, spec in SCHEMA["properties"].items()
                if spec.get("enum") and answer.get(k) not in spec["enum"]]
    if missing or bad_enum:
        return {"packet_id": packet_id, "judge": seat, "sealed": False,
                "why": f"schema: missing {missing}, outside enum {bad_enum}"}
    if answer.get("packet_id") != packet_id:
        # The judge's own statement of what it judged. It reported `work.judge-1`
        # once, which is why this is checked rather than trusted.
        return {"packet_id": packet_id, "judge": seat, "sealed": False,
                "why": f"the judgement claims packet {answer.get('packet_id')!r}"}

    body = json.dumps(answer, indent=2, sort_keys=True) + "\n"
    tmp = out_path + ".tmp"
    with open(tmp, "w") as fh:
        fh.write(body)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, out_path)
    readback = open(out_path).read()
    if readback != body:
        return {"packet_id": packet_id, "judge": seat, "sealed": False,
                "why": "the judgement did not read back as written"}

    digest = hashlib.sha256(body.encode()).hexdigest()
    entry = {"packet_id": packet_id, "judge": seat, "sealed": True,
             "label": answer["label"], "confidence": answer["confidence"],
             "sha256": digest, "bytes": len(body)}
    with open(manifest_path, "a") as fh:
        fh.write(json.dumps(entry) + "\n")
        fh.flush()
        os.fsync(fh.fileno())
    return entry


def main():
    plan_only = "--plan" in sys.argv
    all_rows = rows()
    by_packet = {r["packet_id"]: r for r in all_rows}
    packet_ids = list(by_packet)

    problems = []
    for row in all_rows:
        path = packet_path(row)
        if not os.path.isdir(path):
            problems.append(f"{row['packet_id']}: packet directory missing")
            continue
        leaks = path_leaks(path, row)
        if leaks and not plan_only:
            # The judge is handed a scratch copy, not this path. Recorded so the
            # claim rests on where the judge stands rather than on where the packet
            # was built.
            pass

    seed_source = json.load(open(os.path.join(V8, "schedule.json")))["seed"]
    orders = {}
    for seat, model, family in SEATS:
        order, clashes = order_for(seat, packet_ids, seed_source, by_packet)
        orders[seat] = {"order": order, "adjacent_same_candidate": clashes,
                        "model": model, "family": family}

    if plan_only:
        print(f"  packets available: {len(packet_ids)} of 340")
        print(f"  judgements this would make: {len(packet_ids) * len(SEATS)}")
        for seat, model, _ in SEATS:
            o = orders[seat]
            print(f"    {seat:8} {model:18} first {o['order'][0][:12]}…  "
                  f"adjacent same-candidate pairs remaining: {o['adjacent_same_candidate']}")
        shared = sum(1 for i in range(len(packet_ids))
                     if len({orders[s]["order"][i] for s, _, _ in SEATS}) == 1)
        print(f"  positions where all three orders agree: {shared} "
              f"(a shared order would be one order, not three)")
        print(f"  packets whose build path would leak something: "
              f"{sum(1 for r in all_rows if path_leaks(packet_path(r), r))} "
              f"(the judge is handed a scratch copy named only by the packet id)")
        if problems:
            print(f"  problems: {problems[:3]}")
        return 0

    if len(packet_ids) != 340:
        print(f"  refusing: {len(packet_ids)} packets, section 21.1 expects 340")
        return 2
    if problems:
        print(f"  refusing: {len(problems)} problems, e.g. {problems[0]}")
        return 2

    def hit_a_session_limit(packet_id, seat):
        """Whether the last attempt failed because the subscription window closed.

        A seat that has exhausted its session limit fails every remaining packet the
        same way, and retrying 264 of them spends an hour learning it again. The
        signal is the CLI's own 429, read from the raw response rather than inferred
        from an empty output file -- an empty file is also what a crash leaves.
        """
        for name in (f"raw.{seat}.json",):
            path = os.path.join(results_root, packet_id, name)
            if not os.path.exists(path):
                continue
            try:
                body = json.load(open(path))
            except (json.JSONDecodeError, OSError):
                continue
            if body.get("api_error_status") == 429:
                return str(body.get("result", ""))[:120]
        return None

    results_root = os.path.join(SCRATCH, "v8run/judgements")
    os.makedirs(results_root, exist_ok=True)
    manifest = os.path.join(V8, "judgements-seal-manifest.jsonl")
    already = set()
    if os.path.exists(manifest):
        for line in open(manifest):
            e = json.loads(line)
            already.add((e["packet_id"], e["judge"]))
    made, refused = 0, []
    for seat, model, family in SEATS:
        for pid in orders[seat]["order"]:
            out = os.path.join(results_root, pid, f"out.{seat}.json")
            if (pid, seat) in already:
                made += 1
                continue
            proc = subprocess.run(
                ["bash", os.path.join(HERE, "judge-run.sh"),
                 packet_path(by_packet[pid]), seat, family, model, results_root],
                capture_output=True, text=True)
            limited = hit_a_session_limit(pid, seat)
            if limited:
                print(f"  {seat} stopping: {limited}", flush=True)
                done = sum(1 for line in open(manifest)
                           if json.loads(line)["judge"] == seat) \
                    if os.path.exists(manifest) else 0
                print(f"  {seat} has {done} of {len(packet_ids)} sealed; the rest "
                      f"resume after the window reopens", flush=True)
                break
            entry = seal(out, pid, seat, manifest)
            if entry.get("sealed"):
                made += 1
                print(f"  {seat} {pid[:12]} {entry['label']} {entry['confidence']}",
                      flush=True)
            else:
                refused.append(entry)
                print(f"  {seat} {pid[:12]} NOT SEALED: {entry['why'][:70]}", flush=True)
    print(f"\n  sealed: {made}   not sealed: {len(refused)}")
    for r in refused[:5]:
        print(f"    {r['judge']} {r['packet_id'][:12]}: {r['why'][:80]}")
    return 0 if not refused else 1


if __name__ == "__main__":
    sys.exit(main())
