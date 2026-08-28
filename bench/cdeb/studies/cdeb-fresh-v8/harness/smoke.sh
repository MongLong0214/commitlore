#!/bin/bash
# Both smoke episodes, one after the other. Never concurrently: they are the
# rehearsal for a schedule that caps active episodes, and a rehearsal run under
# load the real thing will not carry rehearses the wrong conditions.
set -u
SP=/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad
python3 "$SP/v8run/episode.py" ON "$1" "$SP/v8run/smoke/on"
python3 "$SP/v8run/episode.py" SUPPRESSED "$1" "$SP/v8run/smoke/suppressed"
echo "SMOKE DONE"
