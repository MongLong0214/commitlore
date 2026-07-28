#!/bin/sh
# Installs a prebuilt commitlore release binary.
#
#   curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/dev/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/dev/install.sh | sh -s v0.2.0
#
# This is a *second* install path, not the canonical one — `git clone` plus
# either a Node runtime or `npm run build:binary` (see the README, ADR-0011,
# ADR-0015) remains that. What this script adds is a way to get a working
# binary with no Node, no build step, and no clone at all: it downloads the
# release asset matching this machine's OS/arch and the matching
# `SHA256SUMS` from the same GitHub release, verifies the asset's checksum
# *before* anything is installed, and only then puts the binary in place.
#
# A script that skips that verification step is worse than no script at all
# — it teaches whoever runs it that piping a URL to `sh` is safe by itself,
# which is exactly the habit this project's own trust model (README §"Trust
# is routing, not a badge") argues against. Piping to a shell should never be
# the *only* documented install path either — the READMEs also carry the
# manual curl + verify steps this script automates, unabbreviated.
#
# Exit codes: 1 = unsupported platform or bad usage, 2 = download failed,
# 3 = checksum did not match (nothing was installed), 4 = install target
# already occupied by something this script did not put there.
#
# A second phase runs after the binary is in place (see "detect and wire
# coding agents" below): it looks for which coding agents are on this
# machine and registers commitlore's MCP server — the plugin, for Claude
# Code — with each one it finds. That phase never fails the script: an agent
# config it cannot verify from that agent's own docs, or cannot merge
# safely, is reported and skipped, never guessed at.
set -eu

REPO="MongLong0214/commitlore"
RAW_VERSION="${1:-${COMMITLORE_INSTALL_VERSION:-latest}}"

log() { printf 'commitlore-install: %s\n' "$1"; }
die() {
  printf 'commitlore-install: error: %s\n' "$1" >&2
  exit "${2:-1}"
}

# --- 1. platform detection -> target triple -----------------------------
#
# The Rust ecosystem's target-triple convention (`<arch>-<vendor>-<os>`) is
# what release.yml names assets with, precisely so a script like this one
# has one string to build instead of a table of special cases per OS.
os_raw="$(uname -s)"
arch_raw="$(uname -m)"

case "$os_raw" in
  Darwin) os=apple-darwin ;;
  Linux) os=unknown-linux-gnu ;;
  *)
    die "unsupported OS \"$os_raw\" — only macOS and Linux release binaries are published (no Windows asset yet: the SEA build and the commit-msg hook shim are not verified there, see ADR-0015). Install from source instead: https://github.com/$REPO#install-from-the-clone" 1
    ;;
esac

case "$arch_raw" in
  arm64 | aarch64) arch=aarch64 ;;
  x86_64 | amd64) arch=x86_64 ;;
  *)
    die "unsupported architecture \"$arch_raw\" — published binaries are aarch64 and x86_64 only. Install from source instead: https://github.com/$REPO#install-from-the-clone" 1
    ;;
esac

target="${arch}-${os}"

# --- 2. resolve the release + build download URLs -----------------------
#
# `releases/latest/download/<asset>` and `releases/download/<tag>/<asset>`
# both redirect straight to the asset without an API call — no token, no
# rate limit, the same pattern GitHub's own docs use for install scripts.
if [ -n "${COMMITLORE_INSTALL_BASE_URL:-}" ]; then
  # Escape hatch for a mirror, or for testing this script against a locally
  # built binary and a hand-made SHA256SUMS — never needed for the documented
  # install command.
  base_url="$COMMITLORE_INSTALL_BASE_URL"
  log "using COMMITLORE_INSTALL_BASE_URL override: $base_url"
elif [ "$RAW_VERSION" = "latest" ]; then
  release_path="latest/download"
  log "resolving the latest release for $target"
  base_url="https://github.com/$REPO/releases/$release_path"
else
  case "$RAW_VERSION" in
    v*) tag="$RAW_VERSION" ;;
    *) tag="v$RAW_VERSION" ;;
  esac
  release_path="download/$tag"
  log "installing $tag for $target"
  base_url="https://github.com/$REPO/releases/$release_path"
fi
# The version segment of the asset name is only known once "latest" is
# resolved, and this script never calls the API to resolve it — it downloads
# the fixed-name SHA256SUMS first (every release has exactly one, at a fixed
# URL) and reads the real asset name for this target back out of that,
# instead of guessing the version and hoping GitHub's redirect saves it.
sums_url="$base_url/SHA256SUMS"

fetch() {
  # $1 = url, $2 = output path
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$1" -O "$2"
  else
    die "neither curl nor wget is available to download the release" 2
  fi
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

sums_file="$work/SHA256SUMS"
fetch "$sums_url" "$sums_file" || die "could not download $sums_url (bad version, or no release published yet)" 2

asset_line="$(grep -- "-${target}\.tar\.gz\$" "$sums_file" || true)"
[ -n "$asset_line" ] || die "SHA256SUMS at $sums_url lists no asset for $target" 2
asset_name="$(printf '%s\n' "$asset_line" | awk '{print $2}' | sed 's/^\*//')"

asset_url="$base_url/$asset_name"
asset_file="$work/$asset_name"
log "downloading $asset_name"
fetch "$asset_url" "$asset_file" || die "could not download $asset_url" 2

# --- 3. verify the checksum before installing anything -------------------
expected="$(printf '%s\n' "$asset_line" | awk '{print $1}')"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(cd "$work" && sha256sum "$asset_name" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(cd "$work" && shasum -a 256 "$asset_name" | awk '{print $1}')"
else
  die "neither sha256sum nor shasum is available to verify the download — refusing to install an unverified binary" 3
fi

if [ "$expected" != "$actual" ]; then
  die "checksum mismatch for $asset_name
  expected: $expected
  got:      $actual
  Nothing was installed. Do not re-run against the same cache; re-download fresh, and if it mismatches again, report it — the release may be corrupted." 3
fi
log "checksum verified ($actual)"

# --- 4. install ------------------------------------------------------------
tar -xzf "$asset_file" -C "$work" commitlore
chmod +x "$work/commitlore"

# The checksum proves the bytes are the ones the release published — it says
# nothing about whether this machine can *run* them. The published target is
# `<arch>-unknown-linux-gnu`: built against glibc, dynamically linked against
# glibc's loader. A musl-libc host (Alpine and its `#!/bin/sh` -> busybox ash
# are the common case; there is no `-musl` asset for this target) has no
# `/lib/ld-linux-*.so.*` for that binary to run against, and the kernel's
# refusal to exec it surfaces as a bare "not found" from the shell — which
# reads exactly like a typo in this script, not a platform gap. Executing the
# freshly extracted binary here, before it is copied anywhere, turns that
# into the same clear, attributed failure every other unsupported-platform
# case in this script already gives.
if ! "$work/commitlore" --version >/dev/null 2>&1; then
  die "the downloaded binary for $target does not run on this machine (nothing was installed). This usually means a musl-libc host such as Alpine — only glibc (\"-gnu\") Linux binaries are published, and Alpine's dynamic linker cannot load them. Install from source instead: https://github.com/$REPO#install-from-the-clone" 1
fi

if [ -n "${COMMITLORE_INSTALL_DIR:-}" ]; then
  dest_dir="$COMMITLORE_INSTALL_DIR"
elif [ -n "${PREFIX:-}" ]; then
  dest_dir="$PREFIX/bin"
else
  dest_dir="$HOME/.local/bin"
fi
dest="$dest_dir/commitlore"

# Refuse to silently clobber a file this script did not put there. A prior
# commitlore install (from this script, `hooks install`'s own binary
# resolution, or a manual copy) is a legitimate upgrade target — but exit 0
# alone does not prove that: plenty of unrelated executables exit 0 and print
# *something* for an unrecognized `--version` flag. The output has to look
# like ours — a bare semver, nothing else — before this overwrites anything.
if [ -e "$dest" ]; then
  existing_version="$("$dest" --version 2>/dev/null || true)"
  case "$existing_version" in
    [0-9]*.[0-9]*.[0-9]*)
      log "upgrading existing install at $dest ($existing_version -> $(cd "$work" && ./commitlore --version))"
      ;;
    *)
      die "$dest already exists and does not look like a commitlore binary (got: \"$existing_version\") — refusing to overwrite it. Remove it first, or set COMMITLORE_INSTALL_DIR to install elsewhere." 4
      ;;
  esac
fi

mkdir -p "$dest_dir"
cp "$work/commitlore" "$dest"
chmod +x "$dest"

log "installed to $dest"
"$dest" --version

case ":$PATH:" in
  *":$dest_dir:"*) ;;
  *) log "note: $dest_dir is not on PATH — add it, e.g. export PATH=\"$dest_dir:\$PATH\"" ;;
esac

# --- 5. detect and wire coding agents --------------------------------------
#
# Everything below is additive and best-effort: it never touches the exit
# codes above (1-4 stay reserved for phase 1 — the binary is already
# installed and working by the time this runs), and every agent it wires is
# detect-then-act, in the same order every time:
#
#   1. Is the agent actually on this machine? An agent that is not found is
#      left alone completely — no config is created "for later".
#   2. Does its config already mention commitlore? If so, this is a re-run:
#      report it and change nothing (the whole install is safe to run
#      again this way, same as phase 1's upgrade path above).
#   3. Otherwise, either create the config fresh, or merge into the existing
#      one with `jq` (only if `jq` is actually present — this script does
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
# named next to its has_/wire_ pair below — verified against each agent's
# own docs, not assumed from one client's format working for another.
# opencode is the one exception to *that*: its config key is `mcp`, not
# `mcpServers`, and its `command` is an argv array rather than
# command+args — see its own comment below.

log ""
log "Detecting coding agents..."

wired_log="$work/wired.log"
skipped_log="$work/skipped.log"
: >"$wired_log"
: >"$skipped_log"

record_wired() { printf '%s\n' "$1" >>"$wired_log"; }
record_skipped() { printf '%s: %s\n' "$1" "$2" >>"$skipped_log"; }

# `mcpServers: { name: { command, args } }` — Gemini CLI, Cursor, and
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
    record_skipped "$agent" "$config_path already mentions commitlore — left unchanged"
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
      record_skipped "$agent" "$config_path exists but jq could not parse it as JSON (or the merge could not be written) — left untouched. Add manually: {\"mcpServers\":{\"commitlore\":{\"command\":\"$dest\",\"args\":[\"mcp\"]}}}"
    fi
    return
  fi

  record_skipped "$agent" "$config_path already exists and jq is not installed, so it cannot be merged without risking its other entries. Add manually: {\"mcpServers\":{\"commitlore\":{\"command\":\"$dest\",\"args\":[\"mcp\"]}}}"
}

# Claude Code — https://code.claude.com/docs/en/discover-plugins#install-plugins
has_claude_code() { command -v claude >/dev/null 2>&1; }
wire_claude_code() {
  installed_plugins="$(claude plugin list 2>/dev/null || true)"
  case "$installed_plugins" in
    *commitlore*)
      record_skipped "claude-code" "the commitlore plugin is already installed — left unchanged"
      return
      ;;
  esac

  if ! claude plugin marketplace add "$REPO" >/dev/null 2>&1; then
    record_skipped "claude-code" "could not add the $REPO marketplace (offline, or already added under a different state) — run manually: claude plugin marketplace add $REPO"
    return
  fi
  if claude plugin install commitlore@commitlore --scope user >/dev/null 2>&1; then
    record_wired "claude-code: installed the commitlore plugin (marketplace: commitlore, scope: user)"
  else
    record_skipped "claude-code" "marketplace added, but plugin install failed — run manually: claude plugin install commitlore@commitlore"
  fi
}

# Codex CLI — TOML, one [mcp_servers.<name>] table per server.
# https://developers.openai.com/codex/mcp
has_codex() { command -v codex >/dev/null 2>&1 || [ -d "$HOME/.codex" ]; }
wire_codex() {
  config_path="$HOME/.codex/config.toml"
  config_dir="$(dirname -- "$config_path")" || { record_skipped "codex" "could not resolve the directory for $config_path"; return; }
  mkdir -p "$config_dir" 2>/dev/null || { record_skipped "codex" "could not create $config_dir"; return; }

  if [ -f "$config_path" ] && grep -q '^\[mcp_servers\.commitlore\]' "$config_path" 2>/dev/null; then
    record_skipped "codex" "$config_path already has a [mcp_servers.commitlore] block — left unchanged"
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

# Gemini CLI — same mcpServers shape as Claude Desktop.
# https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html
has_gemini() { command -v gemini >/dev/null 2>&1 || [ -d "$HOME/.gemini" ]; }
wire_gemini() { wire_mcp_servers_json "gemini-cli" "$HOME/.gemini/settings.json"; }

# Cursor — global config (community-documented; Cursor has no single
# canonical MCP-config reference page at the time of writing).
has_cursor() { command -v cursor >/dev/null 2>&1 || [ -d "$HOME/.cursor" ] || [ -d "/Applications/Cursor.app" ]; }
wire_cursor() { wire_mcp_servers_json "cursor" "$HOME/.cursor/mcp.json"; }

# Windsurf — same mcpServers shape, under Codeium's config directory.
# https://docs.windsurf.com/windsurf/cascade/mcp
has_windsurf() { command -v windsurf >/dev/null 2>&1 || [ -d "$HOME/.codeium/windsurf" ] || [ -d "/Applications/Windsurf.app" ]; }
wire_windsurf() { wire_mcp_servers_json "windsurf" "$HOME/.codeium/windsurf/mcp_config.json"; }

# opencode — different shape from the rest: the key is `mcp`, not
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
    record_skipped "opencode" "$config_path already mentions commitlore — left unchanged"
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
      record_skipped "opencode" "$config_path exists but jq could not parse it as JSON (or the merge could not be written) — left untouched. Add manually under \"mcp\": {\"commitlore\":{\"type\":\"local\",\"command\":[\"$dest\",\"mcp\"],\"enabled\":true}}"
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
log "(install.sh never runs init for you — it only installs the tool and wires agents, never touches a repository's .git.)"
