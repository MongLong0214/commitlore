#!/bin/sh
# Installs a prebuilt commitlore release binary.
#
#   curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/dev/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/dev/install.sh | sh -s v0.1.0
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
