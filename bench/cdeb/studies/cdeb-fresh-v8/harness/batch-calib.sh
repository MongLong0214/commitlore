#!/bin/bash
# Score one judge candidate on the whole calibration corpus. Sequential: one
# heavy job at a time, per the owner's concurrency instruction.
set -u
SP=/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad
JUDGE=$1; FAMILY=$2; MODEL=$3
python3 -c "
import json
k=json.load(open('$SP/v8run/calibration-key.json'))
print('\n'.join(p['packet_id'] for p in k['packets']))" > "$SP/v8run/packet-ids.txt"
while read -r PID; do
  [ -z "$PID" ] && continue
  bash "$SP/v8run/judge-run.sh" "$SP/v8run/packets/calibration/$PID" "$JUDGE" "$FAMILY" "$MODEL"
done < "$SP/v8run/packet-ids.txt"
echo "CALIB BATCH $JUDGE DONE"
