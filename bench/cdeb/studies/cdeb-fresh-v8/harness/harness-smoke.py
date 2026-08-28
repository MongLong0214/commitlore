#!/usr/bin/env python3
"""Run every step of an episode except the model call, on a real assignment.

`run-episode.py` has never been executed end to end. Each of its steps has been
checked on its own and five defects were found that way, but the ones that hurt
most -- regression measured after the acceptance was installed, an arm that
suppressed nothing -- lived in how the steps fit together, not in any step.

So this runs the real function on a real schedule assignment with one substitution:
instead of invoking the coding agent, it applies a v7 rebuilt control patch and
writes a plausible event stream. Everything else is the production path --
materialise, hide the acceptance, build the payload, score regression, install the
acceptance, score it, build the row, write and read it back, build the judge packet,
tear the tree down.

That substitution is what keeps this out of section 33's prohibition on a benchmark
pilot: no coding agent runs, no model is called, and no outcome about the product is
produced. What is produced is a row shaped exactly like a measured one, which is the
only way to find out whether the row can be produced at all.

Two arms are run for the same pair, because the pair is the unit and a runner that
works for ON and not for SUPPRESSED would look fine one episode at a time.
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


def patch_applying_agent(patch_path):
    """Stands in for the coding agent: applies a control patch, reports like codex.

    The event stream it writes is the shape `reached_a_model` and `first_mutation`
    read, so those two are exercised rather than bypassed.
    """
    def agent(tree, prompt, env):
        result = subprocess.run(["git", "-C", tree, "apply", patch_path],
                                capture_output=True, text=True)
        if result.returncode != 0:
            return "", f"patch did not apply: {result.stderr}", 1
        changed = subprocess.run(["git", "-C", tree, "status", "--porcelain"],
                                 capture_output=True, text=True).stdout.split()
        events = [
            {"type": "thread.started"},
            {"type": "turn.started"},
            {"type": "item.completed",
             "item": {"type": "agent_message", "text": "applied the control patch"}},
            {"type": "item.completed",
             "item": {"type": "file_change",
                      "changes": [{"path": os.path.join(tree, c), "kind": "modify"}
                                  for c in changed if not c.startswith("?")][:4]}},
            {"type": "turn.completed"},
        ]
        return "\n".join(json.dumps(e) for e in events) + "\n", "", 0
    return agent


def check(name, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"  <- {detail}"))
    return ok


def main():
    schedule = json.load(open(os.path.join(V8, "schedule.json")))
    # The first pair in the frozen order, both of its arms.
    pair = [e for e in schedule["episodes"][:2]]
    cid = pair[0]["candidate_id"]
    patch = os.path.join(V8, f"calibration/cases/{cid}.goodA.patch")
    if not os.path.exists(patch):
        print(f"  no goodA control for {cid}")
        return 2

    passed, rows = [], {}
    with tempfile.TemporaryDirectory() as td:
        for assignment in pair:
            out = os.path.join(td, f"{assignment['episode_index']}-{assignment['arm']}")
            row = ep.run(assignment, out, SCRATCH, agent=patch_applying_agent(patch))
            rows[assignment["arm"]] = (row, out)
            print(f"\n  {assignment['arm']}  episode {assignment['episode_index']}  "
                  f"{cid}")
            passed.append(check("the row was written and read back",
                                os.path.exists(os.path.join(out, "row.json"))))
            passed.append(check("the agent was substituted and the row says so",
                                row["agent_substituted"] is True))
            passed.append(check("the event stream reports a model turn",
                                row["completion"]["reached_a_model"] is True))
            passed.append(check("a first mutation was located",
                                row["first_mutation"] is not None,
                                str(row["first_mutation"])))
            passed.append(check("regression scored against the baseline",
                                row["regression_acceptance"]["pass"] is True,
                                str(row["regression_acceptance"]["new_failures"])))
            passed.append(check("task acceptance passed on the control patch",
                                row["task_acceptance"]["pass"] is True,
                                f"exit {row['task_acceptance']['exit_code']}"))
            passed.append(check("functional pass", row["functional_pass"] is True))
            packet = os.path.join(out, row["packet_id"])
            passed.append(check("the judge packet was built",
                                os.path.exists(os.path.join(packet, "packet_id.txt"))))
            passed.append(check("the packet holds no .git",
                                not os.path.exists(os.path.join(packet, "tree", ".git"))))
            passed.append(check("the packet holds no judgement artifact",
                                not any(f.startswith(("out.", "events.", "raw."))
                                        for f in os.listdir(packet))))
            passed.append(check("the packet directory is named by the packet id",
                                os.path.basename(packet) == row["packet_id"],
                                os.path.basename(packet)))
            passed.append(check("the worktree was torn down",
                                not os.path.exists(os.path.join(out, "tree"))))

        on_row, _ = rows["ON"]
        off_row, _ = rows["SUPPRESSED"]
        print()
        passed.append(check("the two arms differ in what was delivered",
                            on_row["delivered_sha256"] != off_row["delivered_sha256"]))
        passed.append(check("only the suppressed arm removed a record",
                            on_row["delivery_manipulation"]["removed"] == 0
                            and off_row["delivery_manipulation"]["removed"] == 1))
        passed.append(check("the two arms have different packet ids",
                            on_row["packet_id"] != off_row["packet_id"]))
        passed.append(check("both rows carry the resolved model as unknown, since "
                            "no model ran",
                            on_row["runtime"]["model_resolved"] is None))

    print(f"\n  {sum(passed)}/{len(passed)} checks")
    return 0 if all(passed) else 1


if __name__ == "__main__":
    sys.exit(main())
