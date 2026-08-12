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
  # A plugin is a versioned release artifact. When this script is executing as
  # a plugin hook, its root is therefore the runtime authority: accepting a
  # different `commitlore` from PATH would let a newly installed plugin silently
  # run an older CLI. If this bundle cannot run, fail open rather than substituting
  # an unrelated installation and presenting its context as the plugin's.
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    command -v node >/dev/null 2>&1 || return 1   # without it `exec node` exits 127

    # The bundle carries its own dependencies, so it runs from a clone that never
    # had node_modules. The unbundled build remains a development fallback.
    if [ -f "$CLAUDE_PLUGIN_ROOT/dist/commitlore.mjs" ]; then
      echo "node|$CLAUDE_PLUGIN_ROOT/dist/commitlore.mjs"; return 0
    fi
    if [ -f "$CLAUDE_PLUGIN_ROOT/dist/cli.js" ]; then
      echo "node|$CLAUDE_PLUGIN_ROOT/dist/cli.js"; return 0
    fi
    return 1
  fi

  # Outside a plugin invocation there is no plugin-owned bundle to bind, so a
  # caller may deliberately use the normal CLI install from PATH.
  if command -v commitlore >/dev/null 2>&1; then
    echo "commitlore"; return 0
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
