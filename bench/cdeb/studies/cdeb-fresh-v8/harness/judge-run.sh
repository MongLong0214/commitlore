#!/bin/bash
# One blind judgement on one packet by one judge model.
#
# Three CLI families, three flag shapes. codex takes --output-schema as a path;
# grok takes --json-schema as the schema body and fails on a path; claude takes
# neither and is asked for JSON in the prompt with the schema inlined.
#
# The packet directory is the judge's whole world: decision, task, diff, and the
# finished tree. It carries no arm label, no boundary status, no acceptance
# result and no other judge's answer, and the caller is responsible for that --
# nothing here can put back what a leaky packet already gave away.
set -u
SP=/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad

PACKET=$1     # directory holding decision.txt, task.txt, diff.patch and the tree
JUDGE=$2      # judge id, used for the output filename
FAMILY=$3     # codex | grok | claude
MODEL=$4

OUT=$PACKET/out.$JUDGE.json
[ -f "$OUT" ] && { echo "$(basename "$PACKET")/$JUDGE done"; exit 0; }

PROMPT=$(cat "$SP/v8run/judge-prompt.txt")
SCHEMA=$SP/v8run/judge-schema.json

cd "$PACKET" || exit 1
case "$FAMILY" in
  codex)
    codex exec -m "$MODEL" -c 'model_reasoning_effort="high"' -s read-only --skip-git-repo-check --json \
      --output-schema "$SCHEMA" -o "$OUT" "$PROMPT" \
      > "$PACKET/events.$JUDGE.jsonl" 2> "$PACKET/err.$JUDGE.txt" </dev/null
    ;;
  grok)
    # --json-schema wants the schema body, not a path. Passing a path makes it
    # try to parse the filename as JSON and die before the model is called.
    grok --json-schema "$(cat "$SCHEMA")" -p "$PROMPT" \
      > "$PACKET/raw.$JUDGE.json" 2> "$PACKET/err.$JUDGE.txt" </dev/null
    python3 -c "
import json, sys
raw = open('$PACKET/raw.$JUDGE.json').read()
try:
    d = json.loads(raw)
    # grok wraps the answer; find the object carrying our required keys
    for cand in ([d] if isinstance(d, dict) else []) + list(d.values() if isinstance(d, dict) else []):
        if isinstance(cand, dict) and 'label' in cand and 'packet_id' in cand:
            json.dump(cand, open('$OUT','w'), indent=2); break
    else:
        json.dump(d, open('$OUT','w'), indent=2)
except Exception as e:
    print('parse failed:', e, file=sys.stderr)
" 2>> "$PACKET/err.$JUDGE.txt"
    ;;
  claude)
    claude -p "$PROMPT

Return only a JSON object matching this schema, with no prose around it:
$(cat "$SCHEMA")" --output-format json \
      > "$PACKET/raw.$JUDGE.json" 2> "$PACKET/err.$JUDGE.txt" </dev/null
    python3 -c "
import json, re, sys
raw = open('$PACKET/raw.$JUDGE.json').read()
try:
    outer = json.loads(raw)
    text = outer.get('result', raw) if isinstance(outer, dict) else raw
except Exception:
    text = raw

def candidates(t):
    # A fenced block is the model saying which part is the answer, so prefer it.
    for m in re.finditer(r'\`\`\`(?:json)?\s*(\{.*?\})\s*\`\`\`', t, re.S):
        yield m.group(1)
    # Otherwise scan every '{' and take what parses, longest first. A single
    # greedy \{.*\} starts at the first brace in the prose and never closes.
    starts = [i for i, c in enumerate(t) if c == '{']
    for i in sorted(starts, reverse=True):
        yield t[i:]

got = None
for c in candidates(text):
    try:
        obj = json.JSONDecoder().raw_decode(c)[0]
    except Exception:
        continue
    if isinstance(obj, dict) and 'label' in obj:
        got = obj
        break
if got is None:
    print('no json object with a label found', file=sys.stderr)
else:
    json.dump(got, open('$OUT','w'), indent=2)
" 2>> "$PACKET/err.$JUDGE.txt"
    ;;
  *) echo "unknown family $FAMILY"; exit 1 ;;
esac

python3 -c "
import json
try:
    d = json.load(open('$OUT'))
    print('$(basename "$PACKET")/$JUDGE %s conf=%s' % (d['label'], d.get('confidence')))
except Exception as e:
    print('$(basename "$PACKET")/$JUDGE MALFORMED', e)"
