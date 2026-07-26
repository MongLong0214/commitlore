#!/bin/bash
# SessionStart: make sure a commitlore binary exists, once, without asking.
#
# This is the only place the plugin is allowed to touch the network, and it
# does so at most once per plugin version. Everything on the Edit hot path is a
# filesystem check (see commitlore-run.sh).
#
# Exits 0 in every path. A session must start whether or not this worked.
set -u

RUN="$(dirname "$0")/commitlore-run.sh"

# Already resolvable? Nothing to do.
if "$RUN" --version >/dev/null 2>&1; then exit 0; fi

# No writable data directory means no place to install; degrade to the plain-git
# workflow rather than writing into the plugin directory, which updates wipe.
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0
command -v npm >/dev/null 2>&1 || exit 0

mkdir -p "$CLAUDE_PLUGIN_DATA" 2>/dev/null || exit 0

# A lock file rather than a bare check: several sessions can start at once, and
# two npm installs into one prefix corrupt each other.
LOCK="$CLAUDE_PLUGIN_DATA/.install.lock"
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

VERSION="${COMMITLORE_PLUGIN_VERSION:-0.1.0}"

# --omit=optional keeps the native index dependency from failing the install on
# a machine with no toolchain; the CLI falls back to --no-index and still works.
npm install --prefix "$CLAUDE_PLUGIN_DATA" --no-audit --no-fund --loglevel=error \
  --omit=optional "commitlore@$VERSION" >"$CLAUDE_PLUGIN_DATA/install.log" 2>&1 || {
    echo "commitlore: background install failed; see $CLAUDE_PLUGIN_DATA/install.log" >&2
    exit 0
  }

exit 0
