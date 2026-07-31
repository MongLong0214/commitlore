#!/bin/sh
# Installs commitlore from source, for any agent that is not Claude Code.
#
#   curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v0.4.1/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v0.4.1/install.sh | sh -s v0.4.1
#
# **Claude Code users do not need this script.** The repository is itself a
# plugin marketplace (ADR-0011), so two `/plugin` commands register the MCP
# server, the pre-edit context hook and the skills. That path is first in the
# README and this one is second.
#
# What this installs: a pinned source checkout in the user's data directory,
# and a thin wrapper on PATH that runs `node <checkout>/dist/commitlore.mjs`.
# `dist/` is committed (ADR-0011), so there is no build step and no
# dependency install. **No compiled executable, no platform asset, no
# checksum of a downloaded tarball** -- ADR-0026 removed all of that from the
# product, and a script that reintroduced it would contradict the release it
# came from.
#
# Prerequisites are Node.js 22+ (ADR-0010) and Git, and they are checked
# before anything is written rather than assumed.
#
# Exit codes: 1 = missing or too-old prerequisite, or bad usage (nothing was
# written), 2 = the source could not be fetched, 4 = the install target is
# occupied by something this script did not put there.
#
# Post-install verification never decides the exit code. An install that
# succeeded is not retroactively failed by a check that could not run: that
# was a real defect once, where the installer's own `--version` was killed by
# a signal and its exit code became the script's.
#
# This script never edits a shell profile. If the wrapper's directory is not
# on PATH it prints the line to add, which is the whole of what it does about
# it.
#
# A second phase runs after the wrapper is in place (see "detect and wire
# coding agents" below): it looks for which coding agents are on this machine
# and registers commitlore's MCP server with each one it finds. That phase
# never fails the script.
set -eu

REPO="MongLong0214/commitlore"
SOURCE_URL="${COMMITLORE_INSTALL_SOURCE:-https://github.com/$REPO.git}"
NODE_MAJOR_MIN=22

log() { printf 'commitlore-install: %s\n' "$1"; }
die() {
  printf 'commitlore-install: error: %s\n' "$1" >&2
  exit "${2:-1}"
}

# --- 1. prerequisites, before anything is written ---------------------------
#
# Both are hard requirements rather than conveniences: the wrapper runs the
# bundle with node, and the checkout is a git clone. A missing one is named,
# with what to do about it, and nothing is installed.

node_bin="$(command -v node 2>/dev/null || true)"
[ -n "$node_bin" ] || die "Node.js $NODE_MAJOR_MIN or newer is required and no \"node\" was found on PATH. Install Node.js $NODE_MAJOR_MIN+ (https://nodejs.org), then run this again. Nothing was installed." 1

node_version="$("$node_bin" --version 2>/dev/null || true)"
case "$node_version" in
  v[0-9]*) ;;
  *) die "\"$node_bin --version\" did not report a version (got: \"$node_version\"), so the Node.js major version cannot be checked. Nothing was installed." 1 ;;
esac
node_major="$(printf '%s' "$node_version" | sed 's/^v//' | cut -d. -f1)"
if [ "$node_major" -lt "$NODE_MAJOR_MIN" ]; then
  die "Node.js $NODE_MAJOR_MIN or newer is required; this machine has $node_version. Upgrade Node.js, then run this again. Nothing was installed." 1
fi

# Run it rather than only look for it: a git that cannot execute is as useless
# here as a missing one, and this is the check that catches both.
git --version >/dev/null 2>&1 || die "Git is required, and \"git --version\" did not run. Install Git (or repair the installation), then run this again. Nothing was installed." 1

# --- 2. resolve the version to install -------------------------------------
#
# A tag, never a branch. Passing one explicitly is the reviewable path; with
# none, the newest semver tag is resolved with `git ls-remote`, which needs no
# API token and no rate limit. The default must not resolve to a branch --
# installing a moving target is what pinning exists to prevent.

version="${1:-}"
if [ -n "$version" ]; then
  case "$version" in
    v[0-9]*) ;;
    [0-9]*) version="v$version" ;;
    *) die "\"$version\" is not a version tag. Pass a tag such as v0.4.1, or pass nothing to install the newest one." 1 ;;
  esac
else
  # Newest release tag, compared numerically without `sort -V`. That flag is a
  # GNU/BSD extension and this script is POSIX sh: where it is missing the major
  # field compares lexically, which puts v9 above v10 and installs an older
  # release while reporting success. Zero-padding the three numbers turns a plain
  # lexical `sort` into a numeric one, which needs no extension at all.
  #
  # Only `vMAJOR.MINOR.PATCH` is considered. A pre-release tag would otherwise tie
  # with its release on the padded numbers and then win the tie-break by being
  # the longer string, which is backwards.
  version="$(git ls-remote --tags --refs "$SOURCE_URL" 2>/dev/null \
    | awk '{print $2}' | sed 's#refs/tags/##' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
    | awk -F. '{ maj = $1; sub(/^v/, "", maj); printf "%010d %010d %010d %s\n", maj + 0, $2 + 0, $3 + 0, $0 }' \
    | sort \
    | tail -n 1 \
    | awk '{ print $4 }' || true)"
  [ -n "$version" ] || die "no version tag could be resolved from $SOURCE_URL. Pass one explicitly, for example: sh install.sh v0.4.1" 2
fi

log "installing $version"

# Scratch space for the wiring phase's write-temp-then-rename config merges.
# Created here, removed on exit, exactly as the previous script did.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# --- 3. fetch the pinned checkout ------------------------------------------
#
# Into the user's data directory, keyed by tag, so an upgrade adds a checkout
# beside the old one instead of mutating it. Cloned to a temporary name and
# renamed, so a failed clone never leaves a half-checkout that looks installed.

data_root="${XDG_DATA_HOME:-$HOME/.local/share}/commitlore"
checkout="$data_root/$version"

if [ -d "$checkout/dist" ]; then
  log "reusing the existing checkout at $checkout"
else
  mkdir -p "$data_root"
  checkout_tmp="$data_root/.$version.incoming.$$"
  rm -rf "$checkout_tmp"
  cleanup_checkout_tmp() { rm -rf "$checkout_tmp"; }
  trap cleanup_checkout_tmp EXIT
  # Keep git's own reason. Swallowing it and printing a guess ("check the tag
  # name and your network") sends a user looking in the wrong place whenever the
  # cause is something else, which is most of the time.
  clone_log="$(mktemp)"
  if ! git clone --quiet --depth 1 --branch "$version" "$SOURCE_URL" "$checkout_tmp" 2>"$clone_log"; then
    # git puts the useful line first ("does not appear to be a git repository",
    # "could not read Username", "dubious ownership") and the generic advice
    # last, so the first fatal: line is what a reader needs. Falling back to the
    # whole log keeps the case where there is no fatal: at all.
    clone_reason="$(grep -m1 '^fatal:' "$clone_log" 2>/dev/null || true)"
    [ -n "$clone_reason" ] || clone_reason="$(tr '\n' ' ' <"$clone_log" | sed 's/  */ /g')"
    rm -f "$clone_log"
    die "could not fetch $version from $SOURCE_URL. git said: ${clone_reason:-nothing}. Nothing was installed." 2
  fi
  rm -f "$clone_log"
  [ -f "$checkout_tmp/dist/commitlore.mjs" ] \
    || die "$version does not carry dist/commitlore.mjs, so there is nothing to run. Nothing was installed." 2
  rm -rf "$checkout"
  mv "$checkout_tmp" "$checkout"
  trap - EXIT
  log "checked out $version into $checkout"
fi

# --- 4. install the wrapper ------------------------------------------------

if [ -n "${COMMITLORE_INSTALL_DIR:-}" ]; then
  dest_dir="$COMMITLORE_INSTALL_DIR"
elif [ -n "${PREFIX:-}" ]; then
  dest_dir="$PREFIX/bin"
else
  dest_dir="$HOME/.local/bin"
fi
dest="$dest_dir/commitlore"

WRAPPER_MARKER="# commitlore:wrapper:v1"

# Refuse to clobber a file this script did not put there. A previous wrapper
# carries the marker; a previous binary install prints a bare semver. Anything
# else is somebody else's file and is left exactly where it is.
if [ -e "$dest" ]; then
  if grep -qF "$WRAPPER_MARKER" "$dest" 2>/dev/null; then
    log "upgrading the existing commitlore wrapper at $dest"
  else
    existing_version="$("$dest" --version 2>/dev/null || true)"
    case "$existing_version" in
      [0-9]*.[0-9]*.[0-9]*)
        log "replacing a previous commitlore install at $dest ($existing_version -> $version)"
        ;;
      *)
        die "$dest already exists and is not a commitlore wrapper (got: \"$existing_version\") -- refusing to overwrite it. Remove it first, or set COMMITLORE_INSTALL_DIR to install elsewhere." 4
        ;;
    esac
  fi
fi

mkdir -p "$dest_dir"
# Write beside the destination and rename. An in-place overwrite of a file that
# may be executing is the defect that forced a same-day patch release; rename is
# atomic, so a reader sees either the old wrapper or the new one.
dest_tmp="$dest.commitlore-install.$$"
cleanup_dest_tmp() { rm -f "$dest_tmp"; }
trap cleanup_dest_tmp EXIT
cat >"$dest_tmp" <<WRAPPER
#!/bin/sh
$WRAPPER_MARKER
# Installed by install.sh. Edits are lost on reinstall.
NODE="$node_bin"
[ -x "\$NODE" ] || NODE=node
exec "\$NODE" "$checkout/dist/commitlore.mjs" "\$@"
WRAPPER
chmod +x "$dest_tmp"
mv "$dest_tmp" "$dest"
trap - EXIT

log "installed to $dest"

# The install is complete by this point. Verification reports; it does not
# decide. A single failure is retried once before it is reported, and a
# reported failure still exits 0 -- an install that succeeded must not be
# failed by a check that could not run.
if ! installed_version=$("$dest" --version 2>/dev/null); then
  sleep 1
  installed_version=$("$dest" --version 2>/dev/null) || installed_version=""
fi
if [ -n "$installed_version" ]; then
  printf '%s\n' "$installed_version"
else
  log "installed, but unverified: \"$dest --version\" did not run in this shell."
  log "the wrapper is in place; verify it yourself with: $dest --version"
fi

path_file="$HOME/.profile"
case "${SHELL:-}" in
  */bash) path_file="$HOME/.bashrc" ;;
  */zsh) path_file="$HOME/.zshrc" ;;
esac
path_export="export PATH=\"$dest_dir:\$PATH\""

# Printed, never written. Rewriting a shell profile from a piped installer is
# ruled out on this file: it is what makes people distrust curl-to-shell.
case ":$PATH:" in
  *":$dest_dir:"*) ;;
  *)
    log "note: $dest_dir is not on PATH."
    log "add this line to $path_file:"
    log "  $path_export"
    ;;
esac

# --- 5. detect and wire coding agents --------------------------------------
#
# Everything below is additive and best-effort: it never touches the exit
# codes above (1-4 stay reserved for phase 1 -- the binary is already
# installed and working by the time this runs), and every agent it wires is
# detect-then-act, in the same order every time:
#
#   1. Is the agent actually on this machine? An agent that is not found is
#      left alone completely -- no config is created "for later".
#   2. Does its config already mention commitlore? If so, this is a re-run:
#      report it and change nothing (the whole install is safe to run
#      again this way, same as phase 1's upgrade path above).
#   3. Otherwise, either create the config fresh, or merge into the existing
#      one with `jq` (only if `jq` is actually present -- this script does
#      not install it), or, failing both, report exactly what to add by
#      hand rather than risk the rest of the file.
#
# Claude Code is the one exception to "config file": this repository is
# itself a plugin marketplace (.claude-plugin/marketplace.json, ADR-0011),
# so it is wired through the documented non-interactive `claude plugin`
# CLI (https://code.claude.com/docs/en/discover-plugins#install-plugins)
# instead of hand-editing .claude/settings.json.
#
# Every other client here documents the same MCP shape
# (`{"mcpServers":{"<name>":{"command":...,"args":[...]}}}`) at the path
# named next to its has_/wire_ pair below -- verified against each agent's
# own docs, not assumed from one client's format working for another.
# opencode is the one exception to *that*: its config key is `mcp`, not
# `mcpServers`, and its `command` is an argv array rather than
# command+args -- see its own comment below.

log ""
log "Detecting coding agents..."

wired_log="$work/wired.log"
skipped_log="$work/skipped.log"
: >"$wired_log"
: >"$skipped_log"

record_wired() { printf '%s\n' "$1" >>"$wired_log"; }
record_skipped() { printf '%s: %s\n' "$1" "$2" >>"$skipped_log"; }

# `mcpServers: { name: { command, args } }` -- Gemini CLI, Cursor, and
# Windsurf all document this exact shape.
wire_mcp_servers_json() {
  agent="$1"
  config_path="$2"
  config_dir="$(dirname -- "$config_path")" || { record_skipped "$agent" "could not resolve the directory for $config_path"; return; }
  mkdir -p "$config_dir" 2>/dev/null || { record_skipped "$agent" "could not create $config_dir"; return; }

  if [ ! -f "$config_path" ]; then
    if cat >"$config_path" <<EOF
{
  "mcpServers": {
    "commitlore": {
      "command": "$dest",
      "args": ["mcp"]
    }
  }
}
EOF
    then
      record_wired "$agent: created $config_path"
    else
      record_skipped "$agent" "could not write $config_path"
    fi
    return
  fi

  if grep -q '"commitlore"' "$config_path" 2>/dev/null; then
    record_skipped "$agent" "$config_path already mentions commitlore -- left unchanged"
    return
  fi

  if command -v jq >/dev/null 2>&1; then
    merge_tmp="$(mktemp)"
    if jq --arg cmd "$dest" \
      '.mcpServers = ((.mcpServers // {}) + {commitlore: {command: $cmd, args: ["mcp"]}})' \
      "$config_path" >"$merge_tmp" 2>/dev/null && mv "$merge_tmp" "$config_path"; then
      record_wired "$agent: added the commitlore MCP server into the existing $config_path"
    else
      rm -f "$merge_tmp"
      record_skipped "$agent" "$config_path exists but jq could not parse it as JSON (or the merge could not be written) -- left untouched. Add manually: {\"mcpServers\":{\"commitlore\":{\"command\":\"$dest\",\"args\":[\"mcp\"]}}}"
    fi
    return
  fi

  record_skipped "$agent" "$config_path already exists and jq is not installed, so it cannot be merged without risking its other entries. Add manually: {\"mcpServers\":{\"commitlore\":{\"command\":\"$dest\",\"args\":[\"mcp\"]}}}"
}

# Claude Code -- https://code.claude.com/docs/en/discover-plugins#install-plugins
has_claude_code() { command -v claude >/dev/null 2>&1; }
wire_claude_code() {
  installed_plugins="$(claude plugin list 2>/dev/null || true)"
  case "$installed_plugins" in
    *commitlore*)
      record_skipped "claude-code" "the commitlore plugin is already installed -- left unchanged"
      return
      ;;
  esac

  if ! claude plugin marketplace add "$REPO" >/dev/null 2>&1; then
    record_skipped "claude-code" "could not add the $REPO marketplace (offline, or already added under a different state) -- run manually: claude plugin marketplace add $REPO"
    return
  fi
  if claude plugin install commitlore@commitlore --scope user >/dev/null 2>&1; then
    record_wired "claude-code: installed the commitlore plugin (marketplace: commitlore, scope: user)"
  else
    record_skipped "claude-code" "marketplace added, but plugin install failed -- run manually: claude plugin install commitlore@commitlore"
  fi
}

# Codex CLI -- TOML, one [mcp_servers.<name>] table per server.
# https://developers.openai.com/codex/mcp
has_codex() { command -v codex >/dev/null 2>&1 || [ -d "$HOME/.codex" ]; }
wire_codex() {
  config_path="$HOME/.codex/config.toml"
  config_dir="$(dirname -- "$config_path")" || { record_skipped "codex" "could not resolve the directory for $config_path"; return; }
  mkdir -p "$config_dir" 2>/dev/null || { record_skipped "codex" "could not create $config_dir"; return; }

  if [ -f "$config_path" ] && grep -q '^\[mcp_servers\.commitlore\]' "$config_path" 2>/dev/null; then
    record_skipped "codex" "$config_path already has a [mcp_servers.commitlore] block -- left unchanged"
    return
  fi

  # `$(...)` strips trailing newlines, so each branch ends its own `printf`
  # with an explicit trailing `\n` rather than sharing one block between them.
  if [ -f "$config_path" ]; then
    if printf '\n[mcp_servers.commitlore]\ncommand = "%s"\nargs = ["mcp"]\n' "$dest" >>"$config_path"; then
      record_wired "codex: appended a [mcp_servers.commitlore] block to the existing $config_path"
    else
      record_skipped "codex" "could not append to $config_path"
    fi
  else
    if printf '[mcp_servers.commitlore]\ncommand = "%s"\nargs = ["mcp"]\n' "$dest" >"$config_path"; then
      record_wired "codex: created $config_path"
    else
      record_skipped "codex" "could not write $config_path"
    fi
  fi
}

# Gemini CLI -- same mcpServers shape as Claude Desktop.
# https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html
has_gemini() { command -v gemini >/dev/null 2>&1 || [ -d "$HOME/.gemini" ]; }
wire_gemini() { wire_mcp_servers_json "gemini-cli" "$HOME/.gemini/settings.json"; }

# Cursor -- global config (community-documented; Cursor has no single
# canonical MCP-config reference page at the time of writing).
has_cursor() { command -v cursor >/dev/null 2>&1 || [ -d "$HOME/.cursor" ] || [ -d "/Applications/Cursor.app" ]; }
wire_cursor() { wire_mcp_servers_json "cursor" "$HOME/.cursor/mcp.json"; }

# Windsurf -- same mcpServers shape, under Codeium's config directory.
# https://docs.windsurf.com/windsurf/cascade/mcp
has_windsurf() { command -v windsurf >/dev/null 2>&1 || [ -d "$HOME/.codeium/windsurf" ] || [ -d "/Applications/Windsurf.app" ]; }
wire_windsurf() { wire_mcp_servers_json "windsurf" "$HOME/.codeium/windsurf/mcp_config.json"; }

# opencode -- different shape from the rest: the key is `mcp`, not
# `mcpServers`, and `command` is an argv array alongside a `type`/`enabled`
# pair. https://opencode.ai/docs/mcp-servers/ (config path: https://opencode.ai/docs/config/)
has_opencode() { command -v opencode >/dev/null 2>&1 || [ -d "$HOME/.config/opencode" ]; }
wire_opencode() {
  config_path="$HOME/.config/opencode/opencode.json"
  config_dir="$(dirname -- "$config_path")" || { record_skipped "opencode" "could not resolve the directory for $config_path"; return; }
  mkdir -p "$config_dir" 2>/dev/null || { record_skipped "opencode" "could not create $config_dir"; return; }

  if [ ! -f "$config_path" ]; then
    if cat >"$config_path" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "commitlore": {
      "type": "local",
      "command": ["$dest", "mcp"],
      "enabled": true
    }
  }
}
EOF
    then
      record_wired "opencode: created $config_path"
    else
      record_skipped "opencode" "could not write $config_path"
    fi
    return
  fi

  if grep -q '"commitlore"' "$config_path" 2>/dev/null; then
    record_skipped "opencode" "$config_path already mentions commitlore -- left unchanged"
    return
  fi

  if command -v jq >/dev/null 2>&1; then
    merge_tmp="$(mktemp)"
    if jq --arg cmd "$dest" \
      '.mcp = ((.mcp // {}) + {commitlore: {type: "local", command: [$cmd, "mcp"], enabled: true}})' \
      "$config_path" >"$merge_tmp" 2>/dev/null && mv "$merge_tmp" "$config_path"; then
      record_wired "opencode: added the commitlore MCP server into the existing $config_path"
    else
      rm -f "$merge_tmp"
      record_skipped "opencode" "$config_path exists but jq could not parse it as JSON (or the merge could not be written) -- left untouched. Add manually under \"mcp\": {\"commitlore\":{\"type\":\"local\",\"command\":[\"$dest\",\"mcp\"],\"enabled\":true}}"
    fi
    return
  fi

  record_skipped "opencode" "$config_path already exists and jq is not installed, so it cannot be merged without risking its other entries. Add manually under \"mcp\": {\"commitlore\":{\"type\":\"local\",\"command\":[\"$dest\",\"mcp\"],\"enabled\":true}}"
}

not_found=""
for spec in \
  "Claude Code:has_claude_code:wire_claude_code" \
  "Codex:has_codex:wire_codex" \
  "Gemini CLI:has_gemini:wire_gemini" \
  "Cursor:has_cursor:wire_cursor" \
  "Windsurf:has_windsurf:wire_windsurf" \
  "opencode:has_opencode:wire_opencode"; do
  agent_name="${spec%%:*}"
  agent_rest="${spec#*:}"
  agent_has="${agent_rest%%:*}"
  agent_wire="${agent_rest#*:}"
  if "$agent_has"; then
    "$agent_wire"
  else
    not_found="${not_found}${not_found:+, }${agent_name}"
  fi
done

log ""
log "== commitlore install summary =="
if [ -s "$wired_log" ]; then
  log ""
  log "Wired:"
  while IFS= read -r line; do log "  - $line"; done <"$wired_log"
fi
if [ -s "$skipped_log" ]; then
  log ""
  log "Skipped:"
  while IFS= read -r line; do log "  - $line"; done <"$skipped_log"
fi
if [ -n "$not_found" ]; then
  log ""
  log "Not detected on this machine: $not_found"
fi
log ""
log "Next: cd into a repository and run 'commitlore init' to install its git hook and index."
log "(install.sh never runs init for you -- it only installs the tool and wires agents, never touches a repository's .git.)"
