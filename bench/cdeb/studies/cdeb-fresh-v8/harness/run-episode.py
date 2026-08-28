#!/usr/bin/env python3
"""One measured episode, following section 19's sixteen steps.

The synthetic smoke proved the plumbing on a fixture written for it. This runs a
real assignment: a frozen snapshot materialised from its bundle, the task the v6
corpus recorded, the shipping build's answer for that decision's path scope, and
the arm the frozen schedule assigns.

Three things here are easy to get subtly wrong and are therefore checked rather
than assumed.

**Suppression is exact, never a substring.** Candidate v4-002ffd1e428c572a has two
records in scope, `r-e0b001` and `r-e0b001b`. A substring rule removes both, which
is a different manipulation from the one registered, and the arm would be
suppressing a decision the study never chose. The runner asserts the SUPPRESSED
arm removed exactly one record and that every other record survived.

**The acceptance test is not in the tree while the agent works.** Section 19 step 5.
The v6 task carries the acceptance source separately from the repository precisely
so it can be installed after the agent stops. An agent that can read the test is
being asked a different question.

**The row is written before the worktree is destroyed, and read back.** A row that
does not survive its own process is not evidence, and the tree it describes will
not exist to re-derive it from.

This does not run anything by itself. `batch.py` walks the frozen schedule and
enforces section 18.4's concurrency; running an assignment outside that order is
how a schedule stops meaning anything.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", ".."))
V8 = os.path.join(ROOT, "bench/cdeb/studies/cdeb-fresh-v8")

sys.path.insert(0, HERE)
from packet_ids import load_or_create_salt, packet_id  # noqa: E402
import episode_packet  # noqa: E402

PINNED_DIST_SHA256 = "a0c542977f048e6b5163f581d2e4a53963b2d9845467af8949fa105b8bc0e528"
PINNED_MODEL = "gpt-5.6-terra"
EPISODE_TIMEOUT_SECONDS = 1800


def sha(text):
    return hashlib.sha256(text.encode(errors="replace")).hexdigest()


def sha_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def load(name):
    return json.load(open(os.path.join(V8, name)))


def verify_product(cl):
    """Step 1. The build under test lives outside the repository; check it every time."""
    if not os.path.exists(cl):
        raise SystemExit(f"product under test is missing: {cl}")
    digest = sha_file(cl)
    if digest != PINNED_DIST_SHA256:
        raise SystemExit(f"product under test is not the pinned build\n"
                         f"  pinned {PINNED_DIST_SHA256}\n  found  {digest}")
    return digest


def resolved_model_id(home):
    """What the runtime resolved, from the rollout it wrote -- not the -m argument."""
    root = os.path.join(home, ".codex", "sessions")
    newest, newest_at = None, -1
    for dirpath, _, filenames in os.walk(root):
        for name in filenames:
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(dirpath, name)
            if os.path.getmtime(path) > newest_at:
                newest, newest_at = path, os.path.getmtime(path)
    if newest is None:
        return None, None
    found = set()

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("model", "model_id", "modelId") and isinstance(value, str):
                    found.add(value)
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    for line in open(newest, encoding="utf8", errors="ignore"):
        try:
            walk(json.loads(line))
        except json.JSONDecodeError:
            continue
    if len(found) != 1:
        return sorted(found) or None, os.path.relpath(newest, home)
    return found.pop(), os.path.relpath(newest, home)


def materialise(candidate, dest):
    """Step 2. A fresh worktree from the frozen snapshot bundle."""
    snap = candidate["snapshot"]
    bundle = os.path.join(ROOT, snap["bundle_path"])
    if not os.path.exists(bundle):
        raise SystemExit(
            f"snapshot bundle is not on this machine: {snap['bundle_path']}\n"
            f"  it is gitignored by design; see snapshot-lock.json")
    if sha_file(bundle) != snap["bundle_sha256"]:
        raise SystemExit(f"snapshot bundle digest differs from the lock: {bundle}")
    subprocess.run(["git", "clone", "--quiet", bundle, dest],
                   check=True, capture_output=True)
    subprocess.run(["git", "-C", dest, "checkout", "--quiet", snap["snapshot_commit"]],
                   check=True, capture_output=True)
    at = subprocess.run(["git", "-C", dest, "rev-parse", "HEAD"],
                        capture_output=True, text=True).stdout.strip()
    if at != snap["snapshot_commit"]:
        raise SystemExit(f"materialised at {at}, expected {snap['snapshot_commit']}")
    return at


def hide_acceptance(tree, acceptance_path):
    """Step 5. The agent must not be able to read the test it is measured by."""
    full = os.path.join(tree, acceptance_path)
    existed = os.path.exists(full)
    if existed:
        os.remove(full)
    return existed


def install_acceptance(tree, acceptance_path, source):
    full = os.path.join(tree, acceptance_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as fh:
        fh.write(source)
    return sha(source)


def payload_for(tree, cl, path_scope, arm, identity):
    """Steps 6 and 7. The shipping build's answer, minus the target if SUPPRESSED.

    Removal is by exact record id. `r-e0b001` and `r-e0b001b` are different
    records and a substring rule takes both.
    """
    proc = subprocess.run(["node", cl, "context", "--json", *path_scope],
                          cwd=tree, capture_output=True, text=True)
    doc = json.loads(proc.stdout)
    records = doc.get("records", [])

    def key(record):
        # recordId where the record has one; the commit sha otherwise. Sixteen of
        # the seventeen decisions carry a Record-Id and one does not, and a report
        # keyed only on recordId says "removed [None]" for that one.
        return record.get("recordId") or f"commit:{str(record.get('sha'))[:12]}"

    before = [key(r) for r in records]

    if arm == "SUPPRESSED":
        if identity["kind"] == "record-id":
            target = identity["record_id"]
            kept = [r for r in records if r.get("recordId") != target]
        elif identity["kind"] == "storage-locator":
            # The locator is `commit:<sha>`, and a record carries that commit in
            # `sha`/`shas`. There is no storageLocator field on a record; looking
            # for one matches nothing and suppresses nothing, which reads as a
            # working ON arm on both sides.
            prefix = identity["commit_sha_prefix"]
            kept = [r for r in records
                    if not any(str(x).startswith(prefix)
                               for x in (r.get("shas") or [r.get("sha")]))]
        else:
            raise SystemExit(f"unresolved suppression identity for {identity}")
        removed = len(records) - len(kept)
        doc = dict(doc)
        doc["records"] = kept
    else:
        kept, removed = records, 0

    after = [key(r) for r in kept]
    if arm == "SUPPRESSED" and removed != 1:
        # An arm that removes nothing is an ON arm wearing a SUPPRESSED label, and
        # every episode it produces reports a manipulation that did not happen. An
        # arm that removes more than one suppresses a decision the study did not
        # choose. Neither is recoverable after the fact, so neither runs.
        raise SystemExit(
            f"SUPPRESSED removed {removed} records, expected exactly 1 "
            f"(identity {identity.get('kind')}); before={before} after={after}")
    return doc, {
        "records_before": len(before),
        "records_after": len(after),
        "removed": removed,
        "removed_ids": [k for k in before if k not in after],
        "survivors": after,
        "removal_is_exact": removed <= 1,
    }


def render(doc):
    lines = ["Recorded decisions for the files you are about to change:", ""]
    for r in doc.get("records", []):
        lines.append(f"  record {r.get('recordId')} ({r.get('lifecycle')})")
        for t in (r.get("trailers") or []):
            if isinstance(t, dict) and t.get("key") in ("Ruled-out", "Limit", "Warn"):
                lines.append(f"    {t['key']}: {t.get('value')}")
        lines.append("")
    return "\n".join(lines)


TAP_FAIL = re.compile(r"^not ok \d+ - (.*)$", re.M)
PYTEST_FAIL = re.compile(r"^FAILED (\S+)", re.M)


def regression_failures(output):
    """Failing test names from either runner, so the comparison is by name.

    Counting failures would compare 11 against 11 and miss a swap; comparing names
    catches a new failure that arrives while a baseline one happens to pass.
    """
    names = [m.strip() for m in TAP_FAIL.findall(output)]
    names += [m.strip() for m in PYTEST_FAIL.findall(output)]
    return sorted(set(names))


def first_mutation(events_path, tree):
    """Step 9, from the agent's own event stream rather than a file mtime."""
    tracked = subprocess.run(["git", "-C", tree, "ls-files"],
                             capture_output=True, text=True).stdout.split()
    for index, line in enumerate(open(events_path, encoding="utf8", errors="ignore"), 1):
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        item = event.get("item") or {}
        if item.get("type") == "file_change":
            for change in item.get("changes", []):
                rel = os.path.relpath(change.get("path", ""), tree)
                if rel in tracked:
                    return {"event_index": index, "path": rel, "kind": change.get("kind")}
        if item.get("type") == "command_execution":
            command = item.get("command", "")
            if any(k in command for k in ("sed -i", " > ", ">>", "tee ", "apply_patch")):
                return {"event_index": index, "path": None, "kind": "shell",
                        "command": command[:160]}
    return None


def run(assignment, out_dir, scratch):
    cl = os.path.join(scratch, "v8run/cl120/dist/commitlore.mjs")
    product_digest = verify_product(cl)

    population = {c["candidate_id"]: c for c in load("task-population.json")["candidates"]}
    identities = {e["candidate_id"]: e
                  for e in load("suppression-identity.json")["identities"]}
    candidate = population[assignment["candidate_id"]]
    identity = identities[assignment["candidate_id"]]
    if identity["kind"] == "unresolved":
        raise SystemExit(f"no suppression identity for {assignment['candidate_id']}")

    task = json.load(open(os.path.join(ROOT, candidate["task"]["path"])))
    os.makedirs(out_dir, exist_ok=True)
    tree = os.path.join(out_dir, "tree")
    home = os.path.join(out_dir, "home")
    shutil.rmtree(tree, ignore_errors=True)
    shutil.rmtree(home, ignore_errors=True)

    base_commit = materialise(candidate, tree)
    os.makedirs(os.path.join(home, ".codex"), exist_ok=True)
    src_auth = os.path.expanduser("~/.codex/auth.json")
    if os.path.exists(src_auth):
        shutil.copyfile(src_auth, os.path.join(home, ".codex/auth.json"))

    acceptance_path = candidate["task_acceptance"]["path_in_repository"]
    acceptance_was_present = hide_acceptance(tree, acceptance_path)

    path_scope = candidate["source_decision_packet"].get("path_scope") or ["."]
    doc, manipulation = payload_for(tree, cl, path_scope, assignment["arm"], identity)
    delivered = render(doc)
    prompt = f"{delivered}\n\nTASK\n{task['task_prompt']}\n"
    open(os.path.join(out_dir, "delivered.txt"), "w").write(delivered)
    open(os.path.join(out_dir, "prompt.txt"), "w").write(prompt)

    env = dict(os.environ, HOME=home)
    started = time.time()
    timed_out = False
    try:
        proc = subprocess.run(
            ["codex", "exec", "-m", PINNED_MODEL,
             "-c", 'model_reasoning_effort="high"',
             "-s", "workspace-write", "--skip-git-repo-check", "--json", prompt],
            cwd=tree, capture_output=True, text=True, env=env,
            timeout=EPISODE_TIMEOUT_SECONDS)
        stdout, stderr, code = proc.stdout, proc.stderr, proc.returncode
    except subprocess.TimeoutExpired as expired:
        timed_out = True
        stdout = (expired.stdout or b"").decode(errors="replace") if isinstance(expired.stdout, bytes) else (expired.stdout or "")
        stderr = (expired.stderr or b"").decode(errors="replace") if isinstance(expired.stderr, bytes) else (expired.stderr or "")
        code = None
    seconds = round(time.time() - started)
    events_path = os.path.join(out_dir, "events.jsonl")
    open(events_path, "w").write(stdout)
    open(os.path.join(out_dir, "err.txt"), "w").write(stderr)

    resolved_model, rollout = resolved_model_id(home)
    mutation = first_mutation(events_path, tree)
    diff = subprocess.run(["git", "-C", tree, "diff"], capture_output=True, text=True).stdout
    changed = [c[3:] for c in subprocess.run(
        ["git", "-C", tree, "status", "--porcelain"],
        capture_output=True, text=True).stdout.splitlines()]
    open(os.path.join(out_dir, "diff.patch"), "w").write(diff)

    acceptance_sha = install_acceptance(
        tree, acceptance_path, task["acceptance_test_source"])
    # The frozen, verified command -- not task["how_to_run"], which for four of the
    # seventeen is prose or names an interpreter that is not on PATH. Those exit 127,
    # which is not a failing test, and scored as one they cost those candidates all
    # twenty of their episodes in both arms.
    commands = {e["candidate_id"]: e for e in
                json.load(open(os.path.join(V8, "acceptance-commands.json")))["commands"]}
    acceptance_command = commands[assignment["candidate_id"]]["command"]
    task_acc = subprocess.run(acceptance_command, shell=True, cwd=tree,
                              capture_output=True, text=True, timeout=900)
    if task_acc.returncode in (126, 127):
        # The command did not run. That is an infrastructure failure at evaluation
        # time, not a verdict on the agent's tree, and recording it as "acceptance
        # failed" would be recording an outcome that was never measured.
        raise SystemExit(
            f"task acceptance did not run for {assignment['candidate_id']}: "
            f"exit {task_acc.returncode} from {acceptance_command!r}")
    regression = candidate["regression_acceptance"]
    reg_acc = subprocess.run(regression["command"], shell=True,
                             cwd=os.path.join(tree, regression.get("cwd", ".")),
                             capture_output=True, text=True, timeout=1800)

    # Regression acceptance is "no failure outside the baseline", not "exit 0".
    # agent-operator-score's pristine snapshot fails 11 of its 604 tests, stably
    # across three runs. Scored by exit code, every one of that repository's 160
    # episodes would fail regression whatever the agent did -- P-DSFPS zero in both
    # arms, the equal-weight estimand halved, and section 27's AOS condition
    # unreachable. gitseed is green at baseline, so the defect would have been
    # invisible in half the data.
    baseline = json.load(open(os.path.join(V8, "regression-baseline.json")))
    expected = set(baseline["repositories"][assignment["repository_id"]]["expected_failures"])
    observed = set(regression_failures(reg_acc.stdout + "\n" + reg_acc.stderr))
    new_failures = sorted(observed - expected)
    regression_pass = not new_failures

    completed = code == 0 and not timed_out
    functional_pass = completed and task_acc.returncode == 0 and regression_pass

    row = {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "candidate_id": assignment["candidate_id"],
        "repository_id": assignment["repository_id"],
        "repetition": assignment["repetition"],
        "arm": assignment["arm"],
        "episode_index": assignment["episode_index"],
        "pair_position": assignment["pair_position"],
        "slot_in_pair": assignment["slot_in_pair"],
        "packet_id": packet_id(load_or_create_salt(), assignment["candidate_id"],
                               assignment["arm"], assignment["repetition"]),
        "runtime": {
            "model_requested": PINNED_MODEL,
            "model_resolved": resolved_model,
            "model_resolved_from": rollout,
            "model_matches_pin": resolved_model == PINNED_MODEL,
            "product_sha256": product_digest,
            "product_matches_pin": product_digest == PINNED_DIST_SHA256,
        },
        "base_tree": base_commit,
        "final_diff_sha256": sha(diff),
        "final_diff_bytes": len(diff),
        "changed_files": changed,
        "completion": {"exit_code": code, "timed_out": timed_out,
                       "seconds": seconds, "completed": completed},
        "task_acceptance": {
            "command": acceptance_command,
            "recorded_how_to_run": task["how_to_run"],
            "pass": task_acc.returncode == 0,
            "exit_code": task_acc.returncode,
            "tail": (task_acc.stdout or task_acc.stderr).strip().splitlines()[-1:] or [],
            "source_sha256": acceptance_sha,
            "hidden_during_the_run": True,
            "was_present_in_the_snapshot": acceptance_was_present,
        },
        "regression_acceptance": {
            "command": regression["command"],
            "pass": regression_pass,
            "scored_as": "no failure outside the frozen baseline",
            "exit_code": reg_acc.returncode,
            "baseline_expected_failures": len(expected),
            "observed_failures": len(observed),
            "new_failures": new_failures,
            "baseline_failures_that_passed": sorted(expected - observed),
            "tail": (reg_acc.stdout or reg_acc.stderr).strip().splitlines()[-1:] or [],
        },
        "functional_pass": functional_pass,
        "delivery_manipulation": dict(manipulation, arm=assignment["arm"],
                                      identity_kind=identity["kind"]),
        "delivered_sha256": sha(delivered),
        "first_mutation": mutation,
        "manual_discovery": None,
        "usage": {"seconds": seconds},
        "retry_lineage": None,
        "not_yet_judged": True,
    }

    # Step 15, before step 16. The packet needs the final tree and the tree does
    # not survive the episode, so building it later is not an option that exists.
    row["judge_packet"] = episode_packet.build(
        tree, row, candidate, task, os.path.join(out_dir, "packet"), acceptance_path)

    tmp = os.path.join(out_dir, "row.json.tmp")
    with open(tmp, "w") as fh:
        json.dump(row, fh, indent=2, sort_keys=True)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, os.path.join(out_dir, "row.json"))
    readback = json.load(open(os.path.join(out_dir, "row.json")))
    if readback != row:
        raise SystemExit("the row did not read back as written")

    # Step 16. The tree is gone; the packet and the row are what remain.
    shutil.rmtree(tree, ignore_errors=True)
    shutil.rmtree(home, ignore_errors=True)
    return row


if __name__ == "__main__":
    print("run-episode.py is driven by batch.py, which enforces section 18.4's "
          "concurrency and the frozen order. Running an assignment on its own is "
          "how a schedule stops meaning anything.")
    sys.exit(2)
