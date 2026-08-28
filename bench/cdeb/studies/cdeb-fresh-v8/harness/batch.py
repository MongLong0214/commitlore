#!/usr/bin/env python3
"""Walk the frozen schedule, honouring section 18.4.

    max active coding episodes = 2
    max active per repository  = 1
    same pair concurrent       = false

One worker per repository satisfies all three without a scheduler: there are two
repositories, so at most two episodes are ever in flight, never two in the same
repository, and a worker runs its pair's two episodes in slot order so the two
halves of a pair are never simultaneous. The constraint that needs saying out loud
is the one this does not remove -- both arms of a pair still run in sequence on one
machine, so anything drifting with time is shared between them rather than
eliminated. Adjacency bounds that; nothing here removes it.

Refuses to start unless STATUS says the measured run is allowed. That flag is the
gate PR-B flips, and a batch runner that starts without it is the whole
preregistration undone by a convenience.

Resumable by construction: an assignment whose row already exists is skipped, so
an interrupted run continues rather than re-measuring. Section 20 governs what may
be retried, and this never retries on its own -- a failed episode is an outcome.
"""
import json
import os
import queue
import sys
import threading
import traceback

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

PRINT_LOCK = threading.Lock()


def say(message):
    with PRINT_LOCK:
        print(message, flush=True)


def episode_dir(rows_root, assignment):
    return os.path.join(rows_root, f"{assignment['episode_index']:03d}-"
                                   f"{assignment['candidate_id']}-"
                                   f"{assignment['repetition']}-"
                                   f"{assignment['arm'].lower()}")


def worker(repository, assignments, rows_root, results, failures):
    """One repository's episodes, in schedule order, pair by pair."""
    for assignment in assignments:
        out_dir = episode_dir(rows_root, assignment)
        row_path = os.path.join(out_dir, "row.json")
        if os.path.exists(row_path):
            results.append(json.load(open(row_path)))
            say(f"  {repository:22} {assignment['episode_index']:3} "
                f"{assignment['arm']:10} already recorded")
            continue
        try:
            row = ep.run(assignment, out_dir, SCRATCH)
        except Exception as error:                      # noqa: BLE001
            failures.append({"assignment": assignment, "error": str(error)[:200],
                             "traceback": traceback.format_exc()[-800:]})
            say(f"  {repository:22} {assignment['episode_index']:3} "
                f"{assignment['arm']:10} FAILED {str(error)[:70]}")
            continue
        results.append(row)
        say(f"  {repository:22} {assignment['episode_index']:3} "
            f"{assignment['arm']:10} completed={row['completion']['completed']} "
            f"functional={row['functional_pass']} "
            f"removed={row['delivery_manipulation']['removed']} "
            f"{row['completion']['seconds']}s")


def main():
    # `--plan` prints what would run and exits. It exists because checking that this
    # starts is the same act as starting it: verifying the refusal is safe, and
    # verifying the other half once began two real episodes against the pinned model
    # before a timeout killed them. See incidents/2026-08-28-accidental-episode-start.
    if "--plan" in sys.argv:
        schedule = json.load(open(os.path.join(V8, "schedule.json")))
        by_repository = {}
        for episode in schedule["episodes"]:
            by_repository.setdefault(episode["repository_id"], []).append(episode)
        print(f"  would run {len(schedule['episodes'])} episodes, "
              f"{len(by_repository)} workers, max 1 per repository")
        for repo, episodes in sorted(by_repository.items()):
            print(f"    {repo:22} {len(episodes)} episodes, first "
                  f"{episodes[0]['candidate_id']} {episodes[0]['arm']}")
        print(f"  measured_run_allowed is "
              f"{json.load(open(os.path.join(V8, 'STATUS.json'))).get('measured_run_allowed')}")
        return 0

    status = json.load(open(os.path.join(V8, "STATUS.json")))
    if not status.get("measured_run_allowed"):
        print("  refusing to start: STATUS.measured_run_allowed is false.")
        print("  That flag is the gate PR-B flips. A batch runner that starts")
        print("  without it undoes the preregistration for convenience.")
        return 2

    schedule = json.load(open(os.path.join(V8, "schedule.json")))

    # `--pairs N` runs the first N pair positions in the frozen order and stops.
    # It is not a sample and not a pilot: these are the first episodes of the
    # measured run, taken in the order the schedule fixed, and their rows are kept.
    # It exists so the run can be paced against a measured episode time rather than
    # against a 30-minute timeout, which is all that bounds it beforehand.
    limit = None
    for i, arg in enumerate(sys.argv):
        if arg == "--pairs" and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])
    if limit is not None:
        keep = {e["episode_index"] for e in schedule["episodes"]
                if e["pair_position"] < limit}
        schedule = dict(schedule, episodes=[e for e in schedule["episodes"]
                                            if e["episode_index"] in keep])
        say(f"  --pairs {limit}: running {len(schedule['episodes'])} of "
            f"{len(json.load(open(os.path.join(V8, 'schedule.json')))['episodes'])} "
            f"episodes, in the frozen order, keeping their rows")

    rows_root = os.path.join(V8, "rows")
    os.makedirs(rows_root, exist_ok=True)

    by_repository = {}
    for episode in schedule["episodes"]:
        by_repository.setdefault(episode["repository_id"], []).append(episode)

    say(f"  {len(schedule['episodes'])} episodes across "
        f"{len(by_repository)} repositories, one worker each "
        f"(section 18.4: max 2 active, max 1 per repository)")

    results, failures = [], []
    threads = [threading.Thread(target=worker,
                                args=(repo, episodes, rows_root, results, failures))
               for repo, episodes in sorted(by_repository.items())]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    say(f"\n  rows written: {len(results)}   failures: {len(failures)}")
    if failures:
        for f in failures[:5]:
            say(f"    {f['assignment']['episode_index']} {f['error'][:90]}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
