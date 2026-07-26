#!/bin/bash
# Resolve the commitlore binary for plugin hooks, then exec it.
#
# Hooks run on the hot path of every Edit. Three rules follow from that:
#
#   1. Fail open, always. A hook that errors must not stop the edit — the worst
#      acceptable outcome is that the agent proceeds without records, which is
#      exactly where it was before this plugin existed.
#   2. No network on the hot path. Resolution is a filesystem check; the one
#      install that can touch the network happens in the SessionStart bootstrap.
#   3. No output on failure. A hook that prints to stdout when it cannot run
#      feeds garbage into the payload the agent reads.
set -u

resolve() {
  if command -v commitlore >/dev/null 2>&1; then
    echo "commitlore"; return 0
  fi
  if [ -n "${CLAUDE_PLUGIN_DATA:-}" ] && [ -x "$CLAUDE_PLUGIN_DATA/node_modules/.bin/commitlore" ]; then
    echo "$CLAUDE_PLUGIN_DATA/node_modules/.bin/commitlore"; return 0
  fi
  # Running from a checkout of the repository itself. `node` has to be checked
  # here and not assumed: without it `exec node` exits 127, which breaks rule 1
  # in the one branch that looked safe enough not to test.
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/dist/cli.js" ] \
     && command -v node >/dev/null 2>&1; then
    echo "node|$CLAUDE_PLUGIN_ROOT/dist/cli.js"; return 0
  fi
  return 1
}

BIN="$(resolve)" || exit 0    # rule 1: not installed yet is not an error

case "$BIN" in
  node\|*) exec node "${BIN#node|}" "$@" ;;
  *)       exec "$BIN" "$@" ;;
esac
