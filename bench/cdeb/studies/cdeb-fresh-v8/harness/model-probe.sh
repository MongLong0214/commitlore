#!/bin/bash
# Three metadata probes of the concrete model id, per section 16.2.
#
# The probe asks the runtime what it resolved, not what was requested. Passing
# `-m gpt-5.6-terra` and reading it back would confirm the flag reached the
# process and nothing else -- an alias that routes elsewhere would still echo the
# alias. What matters is the id the run reports for itself.
#
# Three separate invocations, not one repeated read, because the failure being
# looked for is a resolver that answers differently at different moments.
set -u
SP=/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad
MODEL=$1
OUT=$SP/v8run/model-probe
rm -rf "$OUT"; mkdir -p "$OUT"

T=$OUT/tree; mkdir -p "$T"; cd "$T" || exit 1
git init --quiet -b main; git commit --quiet --allow-empty -m "probe"

for i in 1 2 3; do
  H=$OUT/home$i; mkdir -p "$H/.codex"
  cp ~/.codex/auth.json "$H/.codex/auth.json" 2>/dev/null
  HOME="$H" codex exec -m "$MODEL" -s read-only --skip-git-repo-check --json \
    "Reply with exactly the word: probe" \
    > "$OUT/probe$i.jsonl" 2> "$OUT/probe$i.err" </dev/null
  echo "  probe $i exit=$?"
done

python3 - "$OUT" <<'PY'
import json, sys, collections
out = sys.argv[1]
seen = collections.defaultdict(list)
for i in (1, 2, 3):
    ids = set()
    for line in open(f"{out}/probe{i}.jsonl", encoding="utf8", errors="ignore"):
        try:
            e = json.loads(line)
        except Exception:
            continue
        # walk the event for anything that names a concrete model
        def walk(o):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k in ("model", "model_id", "modelId") and isinstance(v, str):
                        ids.add(v)
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(e)
    seen[i] = sorted(ids)
    print(f"  probe {i} reported: {sorted(ids)}")
sets = [set(v) for v in seen.values()]
agree = all(s == sets[0] for s in sets) and bool(sets[0])
print(f"  three probes agree: {agree}")
json.dump({"probes": {str(k): v for k, v in seen.items()}, "agree": agree},
          open(f"{out}/result.json", "w"), indent=2)
PY
