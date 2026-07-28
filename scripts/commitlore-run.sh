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
#   3. No stdout on failure. Stderr carries diagnostics without becoming hook
#      output, while stdout garbage would corrupt the payload the agent reads.
set -u

resolve() {
  # A compiled single-executable build (#39, `npm run build:binary`) needs no
  # node at all, so it is tried before the `command -v node` gate below could
  # ever rule it out — on the hot path this ticket exists for, it is also the
  # faster of the two, not merely the one that still works without node.
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -x "$CLAUDE_PLUGIN_ROOT/dist/commitlore" ]; then
    echo "$CLAUDE_PLUGIN_ROOT/dist/commitlore"; return 0
  fi
  # On PATH by whatever means the user chose — a global binary install included.
  if command -v commitlore >/dev/null 2>&1; then
    echo "commitlore"; return 0
  fi

  command -v node >/dev/null 2>&1 || return 1   # without it `exec node` exits 127

  # The bundle carries its own dependencies, so it runs from a clone that never
  # had node_modules. It is tried first among the node-based options for that
  # reason alone.
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/dist/commitlore.mjs" ]; then
    echo "node|$CLAUDE_PLUGIN_ROOT/dist/commitlore.mjs"; return 0
  fi
  # Unbundled build, which needs node_modules beside it.
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/dist/cli.js" ]; then
    echo "node|$CLAUDE_PLUGIN_ROOT/dist/cli.js"; return 0
  fi
  return 1
}

BIN="$(resolve)" || {
  printf '%s\n' "commitlore: injection hook: CLI could not be resolved; no context was injected" >&2
  exit 0
}

case "$BIN" in
  node\|*) node "${BIN#node|}" "$@" ;;
  *)       "$BIN" "$@" ;;
esac
status=$?
if [ "$status" -ne 0 ]; then
  printf '%s\n' "commitlore: injection hook: CLI exited $status; no context was injected" >&2
fi
exit 0
