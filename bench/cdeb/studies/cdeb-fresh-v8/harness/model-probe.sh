#!/bin/bash
# Three metadata probes of the concrete model id, per section 16.2.
#
# The probe asks the runtime what it resolved, not what was requested. Passing
# `-m gpt-5.6-terra` and reading it back would confirm the flag reached the
# process and nothing else -- an alias that routes elsewhere would still echo the
# alias. What matters is the id the run reports for itself.
#
# It reads the session rollout, not the `--json` event stream. An earlier version
# of this file walked the event stream, which runtime-lock.json itself records as
# carrying no model id at all -- so the committed probe could not have produced
# the recorded result, and a hostile review found exactly that. The rollout the
# run writes under $HOME/.codex/sessions is the only place the resolved id
# appears, and `episode.py:resolved_model_id` reads it the same way per episode.
#
# Three separate invocations, not one repeated read, because the failure being
# looked for is a resolver that answers differently at different moments.
#
# The negative control is the fourth run: no `-m` at all. If the reading path
# echoed the request it would have nothing to echo; it reports gpt-5.6-sol, a
# value nothing passed in.
set -u
SP=/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad
MODEL=$1
OUT=$SP/v8run/model-probe
HARNESS=$(cd "$(dirname "$0")" && pwd)
rm -rf "$OUT"; mkdir -p "$OUT"

T=$OUT/tree; mkdir -p "$T"; cd "$T" || exit 1
git init --quiet -b main; git commit --quiet --allow-empty -m "probe"

for i in 1 2 3 control; do
  H=$OUT/home$i; mkdir -p "$H/.codex"
  cp ~/.codex/auth.json "$H/.codex/auth.json" 2>/dev/null
  if [ "$i" = "control" ]; then
    HOME="$H" codex exec -s read-only --skip-git-repo-check \
      "Reply with exactly the word: probe" \
      > "$OUT/probe$i.out" 2> "$OUT/probe$i.err" </dev/null
  else
    HOME="$H" codex exec -m "$MODEL" -s read-only --skip-git-repo-check \
      "Reply with exactly the word: probe" \
      > "$OUT/probe$i.out" 2> "$OUT/probe$i.err" </dev/null
  fi
  echo "  probe $i exit=$?"
done

python3 - "$OUT" "$HARNESS" "$MODEL" <<'PY'
import importlib.util
import json
import sys

out, harness, pinned = sys.argv[1], sys.argv[2], sys.argv[3]
spec = importlib.util.spec_from_file_location("ep", f"{harness}/episode.py")
ep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ep)

resolved = {}
for i in ("1", "2", "3", "control"):
    mid, path = ep.resolved_model_id(f"{out}/home{i}")
    resolved[i] = {"model": mid, "rollout": path}
    print(f"  probe {i:7} resolved: {mid}")

pinned_runs = [resolved[i]["model"] for i in ("1", "2", "3")]
agree = len(set(pinned_runs)) == 1 and pinned_runs[0] == pinned
control = resolved["control"]["model"]
# "Both absent" and "identical" are the same output from a check that is not
# looking anywhere useful, so an empty result is never agreement.
control_differs = control is not None and control != pinned

print(f"  three probes agree on the pin: {agree}")
print(f"  no -m resolves elsewhere:      {control_differs} ({control})")
json.dump({"probes": resolved, "pinned": pinned,
           "three_probes_agree_on_the_pin": agree,
           "read_from": "session rollout under $HOME/.codex/sessions",
           "negative_control_no_model_flag": control,
           "negative_control_differs_from_pin": control_differs},
          open(f"{out}/result.json", "w"), indent=2, sort_keys=True)
PY
