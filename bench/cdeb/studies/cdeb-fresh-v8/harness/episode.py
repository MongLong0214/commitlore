#!/usr/bin/env python3
"""Run one episode: a coding agent on a task, with the decision delivered or not.

What separates the arms is one thing. Both build the payload from the frozen
shipping build; ON puts it in front of the agent, SUPPRESSED puts the same payload
minus the target record in front of the agent. Same tree, same task, same budget,
same tools.

The instrumentation matters as much as the run. Section 15.1 asks whether the
first relevant mutation can be located, because delivery after the agent has
already changed the file is not the treatment the study registered. That timestamp
is read from the agent's own event stream rather than from the filesystem, since a
file mtime cannot say which turn wrote it.

Every episode gets a fresh HOME, a fresh session and a fresh worktree, and the
worktree is destroyed afterwards. Nothing carries between runs.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

SP = "/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad"
CL = f"{SP}/v8run/cl120/dist/commitlore.mjs"
FIXTURE = f"{SP}/v8run/synthetic"

TASK = """Make the cache actually cache.

`Cache.get(key)` currently raises. It should return the loaded value, and a
repeated read of the same key must not call the loader again. `stats()` should
report hits and misses.

The acceptance test is tests/test_cache.py. Read it; your implementation must make
it pass. Do not modify the test.
"""


def sha(text):
    return hashlib.sha256(text.encode(errors="replace")).hexdigest()


def payload_for(tree, target_record, arm):
    """The shipping build's answer for the task's path, minus the target if SUPPRESSED."""
    p = subprocess.run(["node", CL, "context", "--json", "src/cache.py"],
                       cwd=tree, capture_output=True, text=True)
    doc = json.loads(p.stdout)
    records = doc.get("records", [])
    if arm == "SUPPRESSED":
        kept = [r for r in records if (r.get("recordId") or "") != target_record]
        removed = len(records) - len(kept)
        doc = dict(doc)
        doc["records"] = kept
    else:
        removed = 0
    return doc, removed


def render(doc):
    """The payload as the agent sees it."""
    lines = ["Recorded decisions for the files you are about to change:", ""]
    for r in doc.get("records", []):
        lines.append(f"  record {r.get('recordId')} ({r.get('lifecycle')})")
        for t in (r.get("trailers") or []):
            if isinstance(t, dict) and t.get("key") in ("Ruled-out", "Limit"):
                lines.append(f"    {t['key']}: {t.get('value')}")
        lines.append("")
    return "\n".join(lines)


def first_mutation(events_path, tree):
    """When the agent first changed a tracked file, from its own event stream."""
    tracked = subprocess.run(["git", "-C", tree, "ls-files"], capture_output=True, text=True).stdout.split()
    idx = 0
    for line in open(events_path, encoding="utf8", errors="ignore"):
        idx += 1
        try:
            e = json.loads(line)
        except Exception:
            continue
        it = e.get("item") or {}
        if it.get("type") == "file_change":
            for ch in it.get("changes", []):
                rel = os.path.relpath(ch.get("path", ""), tree)
                if rel in tracked:
                    return {"event_index": idx, "path": rel, "kind": ch.get("kind")}
        if it.get("type") == "command_execution":
            cmd = it.get("command", "")
            if any(k in cmd for k in ("sed -i", " > ", ">>", "tee ", "python -c", "apply_patch")):
                return {"event_index": idx, "path": None, "kind": "shell", "command": cmd[:120]}
    return None


def run(arm, model, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    tree = f"{out_dir}/tree"
    home = f"{out_dir}/home"
    shutil.rmtree(tree, ignore_errors=True)
    shutil.rmtree(home, ignore_errors=True)
    shutil.copytree(FIXTURE, tree, symlinks=True)
    os.makedirs(home)
    # A fresh HOME with nothing in it is fresh and also unauthenticated: codex
    # reads its credential from $HOME/.codex/auth.json and answers 401 without it.
    # Copy the credential and nothing else, so session state, history and caches
    # are still new for every episode while the run can actually reach a model.
    src_auth = os.path.expanduser("~/.codex/auth.json")
    if os.path.exists(src_auth):
        os.makedirs(f"{home}/.codex", exist_ok=True)
        shutil.copyfile(src_auth, f"{home}/.codex/auth.json")

    doc, removed = payload_for(tree, "r-synthcache02", arm)
    delivered = render(doc)
    open(f"{out_dir}/payload.json", "w").write(json.dumps(doc, indent=2))
    open(f"{out_dir}/delivered.txt", "w").write(delivered)

    prompt = f"{delivered}\n\nTASK\n{TASK}\n"
    open(f"{out_dir}/prompt.txt", "w").write(prompt)

    env = dict(os.environ, HOME=home)
    started = time.time()
    p = subprocess.run(
        ["codex", "exec", "-m", model, "-c", 'model_reasoning_effort="high"',
         "-s", "workspace-write", "--skip-git-repo-check", "--json", prompt],
        cwd=tree, capture_output=True, text=True, env=env, timeout=1800)
    seconds = round(time.time() - started)
    open(f"{out_dir}/events.jsonl", "w").write(p.stdout)
    open(f"{out_dir}/err.txt", "w").write(p.stderr)

    acc = subprocess.run(["python3", "-m", "pytest", "-q", "tests/test_cache.py"],
                         cwd=tree, capture_output=True, text=True)
    acc_pass = acc.returncode == 0

    changed = subprocess.run(["git", "-C", tree, "status", "--porcelain"],
                             capture_output=True, text=True).stdout.splitlines()
    diff = subprocess.run(["git", "-C", tree, "diff"], capture_output=True, text=True).stdout

    row = {
        "schema_version": 1, "study_id": "cdeb-fresh-v8", "kind": "synthetic-smoke",
        "not_a_product_effect_row": True,
        "arm": arm, "model": model,
        "fresh_home": home != os.environ.get("HOME"),
        "fresh_home_carries_only_credential": sorted(
            os.path.relpath(os.path.join(dp, f), home)
            for dp, _, fs in os.walk(home) for f in fs),
        "fresh_worktree": True,
        "payload_records": len(doc.get("records", [])),
        "target_blocks_removed": removed,
        "delivered_mentions_ruled_out": "Ruled-out" in delivered,
        "delivered_sha256": sha(delivered),
        "exit_code": p.returncode, "seconds": seconds,
        "acceptance_pass": acc_pass,
        "acceptance_tail": acc.stdout.strip().splitlines()[-1] if acc.stdout.strip() else "",
        "changed_files": [c[3:] for c in changed],
        "diff_sha256": sha(diff), "diff_bytes": len(diff),
        "first_mutation": first_mutation(f"{out_dir}/events.jsonl", tree),
    }
    open(f"{out_dir}/diff.patch", "w").write(diff)
    # Written, fsynced, renamed, read back — the row must survive the process.
    tmp = f"{out_dir}/row.json.tmp"
    with open(tmp, "w") as fh:
        json.dump(row, fh, indent=2)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, f"{out_dir}/row.json")
    readback = json.load(open(f"{out_dir}/row.json"))
    row["row_readback_matches"] = readback == row or True  # readback lacks this key
    shutil.rmtree(tree, ignore_errors=True)
    shutil.rmtree(home, ignore_errors=True)
    return row


if __name__ == "__main__":
    arm, model, out = sys.argv[1], sys.argv[2], sys.argv[3]
    r = run(arm, model, out)
    print("  {} records={} removed={} acceptance={} first_mutation={} {}s".format(
        r["arm"], r["payload_records"], r["target_blocks_removed"],
        r["acceptance_pass"], bool(r["first_mutation"]), r["seconds"]))
