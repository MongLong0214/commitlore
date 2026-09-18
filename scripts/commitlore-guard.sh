#!/bin/bash
# Resolve the commitlore entry point for the commit gate, then exec it.
#
# Separate from `commitlore-run.sh`, which resolves identically and then exits 0
# on every path. That is correct there and fatal here. The injection hook must
# never block an edit -- "no record is worth that" -- so it swallows its own
# failures; this hook exists to block, and routing it through that script would
# turn every refusal into an allow while looking like it worked.
#
# The exit policy is the whole difference:
#
#   2  refuse this tool call, with the reason on stderr for the agent to read
#   0  allow it -- including every way this script or the CLI can fail
#
# Never 1. Claude Code shows an exit-1 hook's stderr to the developer rather
# than to the agent, so a crash would surface as noise a person has to read
# instead of as the silence a fail-open is supposed to be.
set -u

resolve() {
  # A plugin is a versioned release artifact, so its own bundle is the runtime
  # authority when one is present -- the same rule `commitlore-run.sh` follows,
  # and for the same reason: a newly installed plugin must not silently run an
  # older CLI from PATH.
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    command -v node >/dev/null 2>&1 || return 1
    if [ -f "$CLAUDE_PLUGIN_ROOT/dist/commitlore.mjs" ]; then
      echo "node|$CLAUDE_PLUGIN_ROOT/dist/commitlore.mjs"; return 0
    fi
    if [ -f "$CLAUDE_PLUGIN_ROOT/dist/cli.js" ]; then
      echo "node|$CLAUDE_PLUGIN_ROOT/dist/cli.js"; return 0
    fi
    return 1
  fi

  if command -v commitlore >/dev/null 2>&1; then
    echo "commitlore"; return 0
  fi
  return 1
}

BIN="$(resolve)" || exit 0

case "$BIN" in
  node\|*) node "${BIN#node|}" "$@" ;;
  *)       "$BIN" "$@" ;;
esac
status=$?

# 2 is the CLI's considered refusal and is the one code forwarded. Anything
# else -- a crash, a missing subcommand on an older build, a malformed payload
# -- is this tool failing to answer, which is not a reason to stop somebody
# committing.
if [ "$status" -eq 2 ]; then
  exit 2
fi
exit 0
