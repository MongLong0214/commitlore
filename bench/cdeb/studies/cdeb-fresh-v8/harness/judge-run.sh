#!/bin/bash
# One blind judgement on one packet by one judge model.
#
# Three CLI families, three flag shapes. codex takes --output-schema as a path;
# grok takes --json-schema as the schema body and fails on a path; claude takes
# neither and is asked for JSON in the prompt with the schema inlined.
#
# The packet directory is the judge's whole world: decision, task, diff, and the
# finished tree. It carries no arm label, no boundary status and no acceptance
# result, and the caller is responsible for that -- nothing here can put back
# what a leaky packet already gave away.
#
# What this file *is* responsible for is that one judge cannot read another's
# answer. An earlier version wrote out.$JUDGE.json, events.$JUDGE.jsonl and
# err.$JUDGE.txt into the packet directory and then cd'd into that directory to
# run the model, so judge 2 and judge 3 worked inside a directory containing
# judge 1's label. A hostile review found it. Three judgements produced that way
# are not three independent labels, and the panel's whole aggregation rests on
# their independence.
#
# So: outputs go to a separate results tree, the judge runs in a scratch copy of
# the packet that holds only the packet's own files, and each judgement gets a
# fresh HOME so no session history or cache carries between them.
set -u
SP=/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad

PACKET=$1     # directory holding decision.txt, task.txt, diff.patch and the tree
JUDGE=$2      # judge id, used for the output filename
FAMILY=$3     # codex | grok | claude
MODEL=$4
RESULTS=${5:-$SP/v8run/judgements}   # never inside $PACKET

PID=$(basename "$PACKET")
mkdir -p "$RESULTS/$PID"
OUT=$RESULTS/$PID/out.$JUDGE.json
[ -f "$OUT" ] && { echo "$PID/$JUDGE done"; exit 0; }

PROMPT=$(cat "$SP/v8run/judge-prompt.txt")
SCHEMA=$SP/v8run/judge-schema.json

# A scratch copy carrying only what a packet is allowed to contain. Copying
# rather than reading in place means a stray write by a judge cannot alter what
# the next judge sees, and a file that should not be in a packet is visible here
# as a file this loop had to skip.
WORK=$RESULTS/$PID/work.$JUDGE
rm -rf "$WORK"; mkdir -p "$WORK"
( cd "$PACKET" && find . -type f \
    ! -name 'out.*' ! -name 'events.*' ! -name 'err.*' ! -name 'raw.*' \
    ! -name 'work.*' -print0 ) | while IFS= read -r -d '' f; do
  mkdir -p "$WORK/$(dirname "$f")"
  cp "$PACKET/$f" "$WORK/$f"
done
LEAKED=$(cd "$PACKET" && find . -type f \( -name 'out.*' -o -name 'events.*' -o -name 'raw.*' \) | wc -l | tr -d ' ')
if [ "$LEAKED" != "0" ]; then
  echo "$PID/$JUDGE REFUSED: packet contains $LEAKED judgement artifact(s)" >&2
  exit 2
fi

HOME_DIR=$RESULTS/$PID/home.$JUDGE
rm -rf "$HOME_DIR"; mkdir -p "$HOME_DIR/.codex"
cp ~/.codex/auth.json "$HOME_DIR/.codex/auth.json" 2>/dev/null

cd "$WORK" || exit 1
case "$FAMILY" in
  codex)
    HOME="$HOME_DIR" codex exec -m "$MODEL" -c 'model_reasoning_effort="high"' \
      -s read-only --skip-git-repo-check --json \
      --output-schema "$SCHEMA" -o "$OUT" "$PROMPT" \
      > "$RESULTS/$PID/events.$JUDGE.jsonl" 2> "$RESULTS/$PID/err.$JUDGE.txt" </dev/null
    ;;
  grok)
    # --json-schema wants the schema body, not a path. Passing a path makes it
    # try to parse the filename as JSON and die before the model is called.
    HOME="$HOME_DIR" grok --json-schema "$(cat "$SCHEMA")" -p "$PROMPT" \
      > "$RESULTS/$PID/raw.$JUDGE.json" 2> "$RESULTS/$PID/err.$JUDGE.txt" </dev/null
    python3 -c "
import json, sys
raw = open('$RESULTS/$PID/raw.$JUDGE.json').read()
try:
    d = json.loads(raw)
    for cand in ([d] if isinstance(d, dict) else []) + list(d.values() if isinstance(d, dict) else []):
        if isinstance(cand, dict) and 'label' in cand and 'packet_id' in cand:
            json.dump(cand, open('$OUT','w'), indent=2); break
    else:
        json.dump(d, open('$OUT','w'), indent=2)
except Exception as e:
    print('parse failed:', e, file=sys.stderr)
" 2>> "$RESULTS/$PID/err.$JUDGE.txt"
    ;;
  claude)
    HOME="$HOME_DIR" claude -p "$PROMPT

Return only a JSON object matching this schema, with no prose around it:
$(cat "$SCHEMA")" --output-format json \
      > "$RESULTS/$PID/raw.$JUDGE.json" 2> "$RESULTS/$PID/err.$JUDGE.txt" </dev/null
    python3 -c "
import json, re, sys
raw = open('$RESULTS/$PID/raw.$JUDGE.json').read()
try:
    outer = json.loads(raw)
    text = outer.get('result', raw) if isinstance(outer, dict) else raw
except Exception:
    text = raw

def candidates(t):
    # A fenced block is the model saying which part is the answer, so prefer it.
    for m in re.finditer(r'\`\`\`(?:json)?\s*(\{.*?\})\s*\`\`\`', t, re.S):
        yield m.group(1)
    # Otherwise scan every '{' and take what parses. A single greedy \{.*\}
    # starts at the first brace in the prose and never closes.
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
" 2>> "$RESULTS/$PID/err.$JUDGE.txt"
    ;;
  *) echo "unknown family $FAMILY"; exit 1 ;;
esac

rm -rf "$WORK" "$HOME_DIR"

python3 -c "
import json
try:
    d = json.load(open('$OUT'))
    print('$PID/$JUDGE %s conf=%s' % (d['label'], d.get('confidence')))
except Exception as e:
    print('$PID/$JUDGE MALFORMED', e)"
