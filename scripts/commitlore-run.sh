#!/bin/bash
# Resolve the commitlore entry point for plugin hooks, then exec it.
#
# There is no registry in this path and no install step. `dist/` ships in the
# repository, so cloning the plugin is the whole installation (ADR-0011).
#
# Hooks run on the hot path of every Edit. Three rules follow from that:
#
#   1. Fail open, always. A hook that errors must not stop the edit — the worst
#      acceptable outcome is that the agent proceeds without records, which is
#      exactly where it was before this plugin existed.
#   2. Never touch the network. Resolution is a filesystem check and nothing
#      else.
#   3. No output on failure. A hook that prints to stdout when it cannot run
#      feeds garbage into the payload the agent reads.
set -u

resolve() {
  # Shipped with the plugin. This is the normal case and needs no install.
  # `node` is checked rather than assumed: without it `exec node` exits 127,
  # which breaks rule 1 in the branch that looks too obvious to test.
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/dist/cli.js" ] \
     && command -v node >/dev/null 2>&1; then
    echo "node|$CLAUDE_PLUGIN_ROOT/dist/cli.js"; return 0
  fi
  # Built from source, or on PATH by whatever means the user chose.
  if command -v commitlore >/dev/null 2>&1; then
    echo "commitlore"; return 0
  fi
  return 1
}

BIN="$(resolve)" || exit 0    # rule 1: unresolvable is not an error

case "$BIN" in
  node\|*) exec node "${BIN#node|}" "$@" ;;
  *)       exec "$BIN" "$@" ;;
esac
