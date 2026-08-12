#!/bin/sh
# Installs commitlore from source, for any agent that is not Claude Code.
#
#   curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v0.8.0/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v0.8.0/install.sh | sh -s v0.8.0
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
# written), 2 = the source could not be fetched, 3 = runtime verification ran
# and found an unusable checkout, 4 = the install target is occupied by
# something this script did not put there, 5 = runtime verification could not
# run on this machine. Verification never activates an unchecked checkout.
#
# This script never edits a shell profile. If the wrapper's directory is not
# on PATH it prints the line to add, which is the whole of what it does about
# it.
#
# A second phase runs after the wrapper is in place (see "detect and wire
# coding agents" below): it looks for which coding agents are on this machine
# and registers CommitLore with each one it finds. Codex receives its native
# plugin (including the MCP server and skill); other hosts receive an MCP entry.
# That phase never fails the script.
set -eu

REPO="MongLong0214/commitlore"
SOURCE_URL="${COMMITLORE_INSTALL_SOURCE:-https://github.com/$REPO.git}"
NODE_MAJOR_MIN=22

log() { printf 'commitlore-install: %s\n' "$1"; }
die() {
  printf 'commitlore-install: error: %s\n' "$1" >&2
  exit "${2:-1}"
}

# The full runtime inventory lives in the checkout it describes. A tag can add
# an asset and its manifest together; an installer fetched from a newer ref
# therefore never judges that tag against a list it could not contain.
RUNTIME_MANIFEST="installer/runtime-manifest.txt"
RUNTIME_MANIFEST_FORMAT="commitlore-runtime-manifest-v1"

# Check one asset against both the working tree and the pinned tree. The
# manifest itself goes through this check before its contents are read, so
# emptying or truncating it locally cannot reduce what the installer verifies.
verify_tracked_runtime_file() {
  runtime_root="$1"
  runtime_path="$2"
  runtime_label="$3"
  runtime_file="$runtime_root/$runtime_path"

  if [ ! -f "$runtime_file" ]; then
    verification_failed "$runtime_file" "the $runtime_label requires a regular file there"
    return 1
  fi
  if runtime_tree_path="$(git -C "$runtime_root" ls-tree --name-only HEAD -- "$runtime_path" 2>/dev/null)"; then
    :
  else
    runtime_status=$?
    verification_unavailable "$runtime_file" "Git could not read the pinned checkout tree (exit $runtime_status)"
    return 1
  fi
  if [ "$runtime_tree_path" != "$runtime_path" ]; then
    verification_failed "$runtime_file" "the pinned checkout does not record this $runtime_label entry"
    return 1
  fi
  if git -C "$runtime_root" diff --quiet HEAD -- "$runtime_path"; then
    return 0
  else
    runtime_status=$?
  fi
  if [ "$runtime_status" -eq 1 ]; then
    verification_failed "$runtime_file" "the $runtime_label entry differs from the pinned checkout"
  else
    verification_unavailable "$runtime_file" "Git could not compare the pinned checkout $runtime_label (exit $runtime_status)"
  fi
  return 1
}

# Releases before installer/runtime-manifest.txt cannot provide a full runtime
# inventory. They are still checked for the bundle the installer can name on
# its own, then receive the cross-version --version smoke test.
verify_legacy_runtime() {
  runtime_root="$1"
  runtime_manifest_mode="legacy"
  verify_tracked_runtime_file "$runtime_root" "dist/commitlore.mjs" "legacy runtime check"
}

verify_runtime_manifest() {
  runtime_root="$1"
  runtime_manifest_file="$runtime_root/$RUNTIME_MANIFEST"
  verification_state="failed"
  verification_path=""
  verification_detail=""
  runtime_manifest_mode=""

  # `ls-tree` distinguishes an old tag (no path in the pinned tree) from a
  # damaged checkout (the pinned tree has it but the file is missing locally).
  if runtime_manifest_tree_path="$(git -C "$runtime_root" ls-tree --name-only HEAD -- "$RUNTIME_MANIFEST" 2>/dev/null)"; then
    :
  else
    runtime_status=$?
    verification_unavailable "$runtime_manifest_file" "Git could not read the pinned checkout tree (exit $runtime_status)"
    return 1
  fi
  if [ -z "$runtime_manifest_tree_path" ]; then
    verify_legacy_runtime "$runtime_root"
    return $?
  fi
  if [ "$runtime_manifest_tree_path" != "$RUNTIME_MANIFEST" ]; then
    verification_failed "$runtime_manifest_file" "the pinned checkout records an unexpected runtime manifest path"
    return 1
  fi
  if ! verify_tracked_runtime_file "$runtime_root" "$RUNTIME_MANIFEST" "runtime manifest"; then
    return 1
  fi

  runtime_manifest_line=0
  runtime_manifest_assets=0
  while IFS= read -r runtime_path || [ -n "$runtime_path" ]; do
    runtime_manifest_line=$((runtime_manifest_line + 1))
    if [ "$runtime_manifest_line" -eq 1 ]; then
      if [ "$runtime_path" != "$RUNTIME_MANIFEST_FORMAT" ]; then
        verification_failed "$runtime_manifest_file" "the runtime manifest format is not $RUNTIME_MANIFEST_FORMAT"
        return 1
      fi
      continue
    fi
    if [ -z "$runtime_path" ]; then
      verification_failed "$runtime_manifest_file" "the runtime manifest contains an empty asset entry"
      return 1
    fi
    # Each entry is a canonical repository-relative file path. In particular,
    # no manifest may escape its checkout or use a second spelling of an asset.
    case "$runtime_path" in
      /*|*/|.|..|./*|../*|*/./*|*/../*|*//*)
        verification_failed "$runtime_manifest_file" "the runtime manifest contains a non-canonical asset path: $runtime_path"
        return 1
        ;;
      *[!A-Za-z0-9._/-]*)
        verification_failed "$runtime_manifest_file" "the runtime manifest contains an invalid asset path: $runtime_path"
        return 1
        ;;
    esac
    runtime_manifest_assets=$((runtime_manifest_assets + 1))
    if ! verify_tracked_runtime_file "$runtime_root" "$runtime_path" "runtime manifest"; then
      return 1
    fi
  done <"$runtime_manifest_file"

  if [ "$runtime_manifest_line" -eq 0 ]; then
    verification_failed "$runtime_manifest_file" "the runtime manifest is empty"
    return 1
  fi
  if [ "$runtime_manifest_assets" -eq 0 ]; then
    verification_failed "$runtime_manifest_file" "the runtime manifest must name at least one runtime asset"
    return 1
  fi
  runtime_manifest_mode="manifest"
  return 0
}

verification_failed() {
  verification_state="failed"
  verification_path="$1"
  verification_detail="$2"
  return 1
}

verification_unavailable() {
  verification_state="unavailable"
  verification_path="$1"
  verification_detail="$2"
  return 1
}

# A directory named after a release is not itself evidence that it contains
# that release. In particular, an interrupted or hand-copied upgrade can leave
# a clean checkout of an older tag at the newer tag's path. Bind HEAD to the
# requested tag before reusing or activating any checkout.
verify_requested_tag() {
  runtime_root="$1"
  requested_tag="$2"
  requested_ref="refs/tags/$requested_tag"

  if git -C "$runtime_root" show-ref --verify --quiet "$requested_ref"; then
    :
  else
    requested_tag_status=$?
    if [ "$requested_tag_status" -eq 1 ]; then
      verification_failed "$runtime_root" "the checkout does not contain requested tag $requested_tag"
    else
      verification_unavailable "$runtime_root" "Git could not read requested tag $requested_tag (exit $requested_tag_status)"
    fi
    return 1
  fi

  if requested_head="$(git -C "$runtime_root" rev-parse --verify "$requested_ref^{commit}" 2>/dev/null)"; then
    :
  else
    requested_tag_status=$?
    verification_unavailable "$runtime_root" "Git could not resolve requested tag $requested_tag to a commit (exit $requested_tag_status)"
    return 1
  fi
  if checkout_head="$(git -C "$runtime_root" rev-parse --verify HEAD 2>/dev/null)"; then
    :
  else
    requested_tag_status=$?
    verification_unavailable "$runtime_root" "Git could not resolve checkout HEAD (exit $requested_tag_status)"
    return 1
  fi
  if [ "$checkout_head" != "$requested_head" ]; then
    verification_failed "$runtime_root" "checkout HEAD $checkout_head does not match requested tag $requested_tag ($requested_head)"
    return 1
  fi
  return 0
}

# Smoke-test the checkout directly, while it is still only an incoming tree.
# `doctor --json` can legitimately exit 1 for a repository that needs setup;
# its JSON report proves the command ran. Exit 2 is the documented "could not
# run" result and is distinguished from a runtime failure below.
verify_incoming_smoke() {
  runtime_root="$1"
  runtime_entry="$runtime_root/dist/commitlore.mjs"
  smoke_dir="$work/smoke"
  rm -rf "$smoke_dir"
  mkdir -p "$smoke_dir"

  if "$node_bin" "$runtime_entry" --version >"$smoke_dir/version.out" 2>"$smoke_dir/version.err"; then
    verified_version="$(cat "$smoke_dir/version.out")"
    if [ -z "$verified_version" ]; then
      verification_failed "$runtime_entry" "--version exited 0 without reporting a version"
      return 1
    fi
    if [ "$verified_version" != "$requested_version" ]; then
      verification_failed "$runtime_entry" "--version reported \"$verified_version\", want requested version \"$requested_version\""
      return 1
    fi
  else
    smoke_status=$?
    case "$smoke_status" in
      126|127) verification_unavailable "$runtime_entry" "--version could not start (exit $smoke_status)" ;;
      *) verification_failed "$runtime_entry" "--version ran and exited $smoke_status" ;;
    esac
    return 1
  fi

  printf 'installer smoke test\n\nBlast: local\n' >"$smoke_dir/valid-message"
  if "$node_bin" "$runtime_entry" validate --message-file "$smoke_dir/valid-message" >"$smoke_dir/valid.out" 2>"$smoke_dir/valid.err"; then
    :
  else
    smoke_status=$?
    case "$smoke_status" in
      126|127) verification_unavailable "$runtime_entry" "validate could not start (exit $smoke_status)" ;;
      *) verification_failed "$runtime_entry" "validate of a valid record ran and exited $smoke_status" ;;
    esac
    return 1
  fi

  printf 'installer smoke test\n\nBlast: invalid\n' >"$smoke_dir/invalid-message"
  if "$node_bin" "$runtime_entry" validate --message-file "$smoke_dir/invalid-message" >"$smoke_dir/invalid.out" 2>"$smoke_dir/invalid.err"; then
    verification_failed "$runtime_entry" "validate accepted an invalid record"
    return 1
  else
    smoke_status=$?
  fi
  if [ "$smoke_status" -ne 1 ]; then
    case "$smoke_status" in
      126|127) verification_unavailable "$runtime_entry" "validate could not start (exit $smoke_status)" ;;
      *) verification_failed "$runtime_entry" "validate of an invalid record exited $smoke_status, want 1" ;;
    esac
    return 1
  fi

  if (cd "$runtime_root" && "$node_bin" ./dist/commitlore.mjs doctor --json >"$smoke_dir/doctor.json" 2>"$smoke_dir/doctor.err"); then
    smoke_status=0
  else
    smoke_status=$?
  fi
  case "$smoke_status" in
    0|1) ;;
    2|126|127)
      verification_unavailable "$runtime_entry" "doctor --json could not run (exit $smoke_status)"
      return 1
      ;;
    *)
      verification_failed "$runtime_entry" "doctor --json ran and exited $smoke_status"
      return 1
      ;;
  esac
  if ! grep -q '"schema": "commitlore_doctor.v2"' "$smoke_dir/doctor.json"; then
    verification_failed "$runtime_entry" "doctor --json did not emit a CommitLore doctor report"
    return 1
  fi

  return 0
}

# A pre-manifest release also predates the current smoke-test contract. It may
# not emit today's doctor schema (or expose every later command), so only prove
# that the bundle the installer can name starts and reports its version. Tagged
# releases that carry the manifest always take verify_incoming_smoke above.
verify_legacy_smoke() {
  runtime_root="$1"
  runtime_entry="$runtime_root/dist/commitlore.mjs"
  smoke_dir="$work/legacy-smoke"
  rm -rf "$smoke_dir"
  mkdir -p "$smoke_dir"

  if "$node_bin" "$runtime_entry" --version >"$smoke_dir/version.out" 2>"$smoke_dir/version.err"; then
    verified_version="$(cat "$smoke_dir/version.out")"
    if [ -z "$verified_version" ]; then
      verification_failed "$runtime_entry" "--version exited 0 without reporting a version"
      return 1
    fi
    if [ "$verified_version" != "$requested_version" ]; then
      verification_failed "$runtime_entry" "--version reported \"$verified_version\", want requested version \"$requested_version\""
      return 1
    fi
    return 0
  fi
  smoke_status=$?
  case "$smoke_status" in
    126|127) verification_unavailable "$runtime_entry" "--version could not start (exit $smoke_status)" ;;
    *) verification_failed "$runtime_entry" "--version ran and exited $smoke_status" ;;
  esac
  return 1
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
    *) die "\"$version\" is not a version tag. Pass a tag such as v1.2.3, or pass nothing to install the newest one." 1 ;;
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
  [ -n "$version" ] || die "no version tag could be resolved from $SOURCE_URL. Pass one explicitly, for example: sh install.sh v1.2.3" 2
fi

log "installing $version"
requested_version="${version#v}"

# Scratch space for verification and the wiring phase's write-temp-then-rename
# config merges. Incoming and wrapper temporaries share its exit cleanup.
work="$(mktemp -d)"
checkout_tmp=""
dest_tmp=""
cleanup_install() {
  [ -z "$dest_tmp" ] || rm -f "$dest_tmp"
  [ -z "$checkout_tmp" ] || rm -rf "$checkout_tmp"
  rm -rf "$work"
}
trap cleanup_install EXIT

# --- 3. check the activation target before materializing anything -----------
#
# A foreign wrapper is rejected before a checkout is fetched. This preserves
# both the foreign file and any prior working installation if the transaction
# cannot reach its activation point.

if [ -n "${COMMITLORE_INSTALL_DIR:-}" ]; then
  dest_dir="$COMMITLORE_INSTALL_DIR"
elif [ -n "${PREFIX:-}" ]; then
  dest_dir="$PREFIX/bin"
else
  dest_dir="$HOME/.local/bin"
fi
dest="$dest_dir/commitlore"

# Defined here rather than beside the checkout below: the ownership check
# consults it, and a value read after its first use is a value that is empty
# when it matters.
data_root="${XDG_DATA_HOME:-$HOME/.local/share}/commitlore"

WRAPPER_MARKER="# commitlore:wrapper:v1"

# Refuse to clobber a file this script did not put there. A previous wrapper
# carries the marker. An older install predating the marker is recognised by a
# bare semver *and* the managed checkout that install would have left behind --
# printing a version was the whole test, so any unrelated executable that
# answered `--version` with something like `1.2.3` was silently destroyed.
# Anything else is somebody else's file and is left exactly where it is.
if [ -e "$dest" ]; then
  if grep -qF "$WRAPPER_MARKER" "$dest" 2>/dev/null; then
    log "upgrading the existing commitlore wrapper at $dest"
  else
    existing_version="$("$dest" --version 2>/dev/null || true)"
    case "$existing_version" in
      [0-9]*.[0-9]*.[0-9]*)
        if [ -d "$data_root/v$existing_version" ] || [ -d "$data_root/$existing_version" ]; then
          log "replacing a previous commitlore install at $dest ($existing_version -> $version)"
        else
          die "$dest already exists, reports version \"$existing_version\", and has no commitlore checkout under $data_root to match it -- refusing to overwrite a file this installer cannot show it wrote. Remove it first, or set COMMITLORE_INSTALL_DIR to install elsewhere." 4
        fi
        ;;
      *)
        die "$dest already exists and is not a commitlore wrapper (got: \"$existing_version\") -- refusing to overwrite it. Remove it first, or set COMMITLORE_INSTALL_DIR to install elsewhere." 4
        ;;
    esac
  fi
fi

# --- 4. materialize and verify the pinned checkout -------------------------
#
# Into the user's data directory, keyed by tag, so an upgrade adds a checkout
# beside the old one instead of mutating it. A source checkout is always cloned
# into an incoming directory, then fully checked before it receives its stable
# name or the wrapper can point at it.

checkout="$data_root/$version"
candidate=""

# The installer may have arrived through a pipe, so it cannot safely recreate
# the command that invoked it. It can name the one deliberate filesystem repair
# that returns this transaction to a state a rerun can install into. Quoting is
# emitted for a POSIX shell, including a data directory whose path has spaces.
quote_for_sh() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}
die_unusable_checkout() {
  printf 'commitlore-install: error: runtime verification ran and found an unusable path: "%s" (%s). The existing wrapper at %s was left unchanged.\n' \
    "$verification_path" "$verification_detail" "$dest" >&2
  if [ -e "$checkout" ]; then
    printf 'commitlore-install: error: To repair this checkout deliberately, remove only it, then rerun the same install command:\n' >&2
    printf '  rm -rf %s\n' "$(quote_for_sh "$checkout")" >&2
  fi
  exit 3
}

if [ -e "$checkout" ]; then
  if [ ! -d "$checkout" ]; then
    verification_state="failed"
    verification_path="$checkout"
    verification_detail="the existing checkout path is not a directory"
  elif ! verify_runtime_manifest "$checkout"; then
    :
  elif ! verify_requested_tag "$checkout" "$version"; then
    :
  else
    candidate="$checkout"
    if [ "$runtime_manifest_mode" = "legacy" ]; then
      log "reusing the existing checkout at $checkout (legacy runtime check and --version smoke test; this release predates $RUNTIME_MANIFEST)"
    else
      log "reusing the existing checkout at $checkout (runtime manifest and requested tag verified)"
    fi
  fi
else
  mkdir -p "$data_root"
  checkout_tmp="$data_root/.$version.incoming.$$"
  rm -rf "$checkout_tmp"
  # Keep git's own reason. Swallowing it and printing a guess ("check the tag
  # name and your network") sends a user looking in the wrong place whenever the
  # cause is something else, which is most of the time.
  clone_log="$(mktemp)"
  if ! git clone --quiet --depth 1 --branch "$version" "$SOURCE_URL" "$checkout_tmp" 2>"$clone_log"; then
    # git puts the useful line first ("does not appear to be a git repository",
    # "could not read Username", "dubious ownership") and the generic advice
    # last, so the first fatal: line is what a reader needs. Falling back to the
    # whole log keeps the case where there is no fatal: at all.
    # `sed -n '/re/{p;q;}'` rather than `grep -m1`: -m is a GNU/BSD extension and
    # this script is POSIX sh. Same reason sort -V was removed from the version
    # resolution above.
    clone_reason="$(sed -n '/^fatal:/{p;q;}' "$clone_log" 2>/dev/null || true)"
    [ -n "$clone_reason" ] || clone_reason="$(tr '\n' ' ' <"$clone_log" | sed 's/  */ /g')"
    rm -f "$clone_log"
    die "could not fetch $version from $SOURCE_URL. git said: ${clone_reason:-nothing}. Nothing was installed." 2
  fi
  rm -f "$clone_log"
  if verify_runtime_manifest "$checkout_tmp" && verify_requested_tag "$checkout_tmp" "$version"; then
    candidate="$checkout_tmp"
    if [ "$runtime_manifest_mode" = "legacy" ]; then
      log "$version predates $RUNTIME_MANIFEST; using the installer's legacy runtime check and --version smoke test"
    fi
  fi
fi

if [ -z "$candidate" ]; then
  if [ "$verification_state" = "unavailable" ]; then
    die "runtime verification could not run for \"$verification_path\": $verification_detail. The existing wrapper at $dest was left unchanged." 5
  fi
  die_unusable_checkout
fi

verification_smoke_ok="true"
if [ "$runtime_manifest_mode" = "legacy" ]; then
  verify_legacy_smoke "$candidate" || verification_smoke_ok="false"
else
  verify_incoming_smoke "$candidate" || verification_smoke_ok="false"
fi
if [ "$verification_smoke_ok" != "true" ]; then
  if [ "$verification_state" = "unavailable" ]; then
    die "runtime verification could not run for \"$verification_path\": $verification_detail. The existing wrapper at $dest was left unchanged." 5
  else
    die_unusable_checkout
  fi
fi

if [ "$candidate" = "$checkout_tmp" ]; then
  if [ -e "$checkout" ]; then
    die "could not materialize verified incoming checkout at $checkout because that path became occupied. The existing wrapper at $dest was left unchanged." 4
  fi
  if ! mv "$checkout_tmp" "$checkout"; then
    die "could not materialize verified incoming checkout at $checkout. The existing wrapper at $dest was left unchanged." 3
  fi
  checkout_tmp=""
  candidate="$checkout"
  log "checked out and verified $version into $checkout"
fi

# --- 5. activate the verified wrapper --------------------------------------

mkdir -p "$dest_dir"
# Write beside the destination and rename. An in-place overwrite of a file that
# may be executing is the defect that forced a same-day patch release; rename is
# atomic, so a reader sees either the old wrapper or the new one.
dest_tmp="$dest.commitlore-install.$$"
if ! cat >"$dest_tmp" <<WRAPPER
#!/bin/sh
$WRAPPER_MARKER
# Installed by install.sh. Edits are lost on reinstall.
NODE="$node_bin"
[ -x "\$NODE" ] || NODE=node
exec "\$NODE" "$candidate/dist/commitlore.mjs" "\$@"
WRAPPER
then
  die "could not prepare activation at $dest. Verified checkout $candidate was not activated." 3
fi
if ! chmod +x "$dest_tmp"; then
  die "could not prepare activation at $dest. Verified checkout $candidate was not activated." 3
fi
if ! mv "$dest_tmp" "$dest"; then
  die "could not activate verified checkout $candidate at $dest. The existing wrapper was left unchanged." 3
fi
dest_tmp=""

log "installed to $dest"
printf '%s\n' "$verified_version"

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

# --- 6. detect and wire coding agents --------------------------------------
#
# Everything below is additive and best-effort: it never touches the exit
# codes above (1-5 stay reserved for the transactional install -- the binary is already
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
# Hermes is the other exception: its active profile is YAML at
# `$HOME/.hermes/config.yaml`, and its externally owned skills are declared
# beside that MCP block. `commitlore hermes install` owns the surgical YAML
# edit so the two platform installers cannot drift on what uninstall removes.

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

# Codex CLI owns its MCP config whenever it is available.  The file branch is
# only for an existing Codex home on a machine without the CLI: hand-writing
# TOML while the CLI is present invites drift when Codex changes its format.
# https://developers.openai.com/codex/mcp
has_codex() { command -v codex >/dev/null 2>&1 || [ -d "$HOME/.codex" ]; }
wire_codex_mcp() {
  if command -v codex >/dev/null 2>&1; then
    # A registration named `commitlore` is not evidence of a working one. A
    # machine here carried an entry pointing at a wrapper in a temp directory
    # left by an install from months earlier, and a name-only check called it
    # correct -- so every session got a server that was not what the name said.
    # Ownership is decided by the wrapper an entry points at, never by the key
    # it sits under, which is the rule `agent-configs.ts` already states for
    # removal.
    codex_existing="$(codex mcp get commitlore 2>/dev/null || true)"
    case "$codex_existing" in
      "")
        ;;
      *"command: $dest"*)
        record_skipped "codex" "commitlore already points at this install -- left unchanged"
        return
        ;;
      *"$data_root"*)
        codex mcp remove commitlore >/dev/null 2>&1 || true
        ;;
      *)
        record_skipped "codex" "an mcp server named commitlore points somewhere this install did not write -- left untouched"
        return
        ;;
    esac
    if codex mcp add commitlore -- "$dest" mcp >/dev/null 2>&1; then
      record_wired "codex: registered commitlore with codex mcp add"
    else
      record_skipped "codex" "codex mcp add could not register commitlore -- config file was left untouched"
    fi
    return
  fi

  config_path="$HOME/.codex/config.toml"
  config_dir="$(dirname -- "$config_path")" || { record_skipped "codex" "could not resolve the directory for $config_path"; return; }
  mkdir -p "$config_dir" 2>/dev/null || { record_skipped "codex" "could not create $config_dir"; return; }

  if [ -f "$config_path" ] && grep -q '^\[mcp_servers\.commitlore\]' "$config_path" 2>/dev/null; then
    record_skipped "codex" "$config_path already has a [mcp_servers.commitlore] block (config-file fallback; codex CLI is unavailable) -- left unchanged"
    return
  fi

  # `$(...)` strips trailing newlines, so each branch ends its own `printf`
  # with an explicit trailing `\n` rather than sharing one block between them.
  if [ -f "$config_path" ]; then
    if printf '\n[mcp_servers.commitlore]\ncommand = "%s"\nargs = ["mcp"]\n' "$dest" >>"$config_path"; then
      record_wired "codex: appended a [mcp_servers.commitlore] block to the existing $config_path (config-file fallback; codex CLI is unavailable)"
    else
      record_skipped "codex" "could not append to $config_path"
    fi
  else
    if printf '[mcp_servers.commitlore]\ncommand = "%s"\nargs = ["mcp"]\n' "$dest" >"$config_path"; then
      record_wired "codex: created $config_path (config-file fallback; codex CLI is unavailable)"
    else
      record_skipped "codex" "could not write $config_path"
    fi
  fi
}

# Codex's plugin API owns the plugin cache and marketplace. The packaged plugin
# supplies its own MCP server and capture skill, while the marker lets uninstall
# remove only the plugin this installer placed.
wire_codex_plugin() {
  if "$dest" plugin install-codex >/dev/null 2>&1; then
    record_wired "codex: installed the commitlore plugin (marketplace: commitlore)"
  else
    record_skipped "codex" "could not install the commitlore plugin -- run manually: $dest plugin install-codex"
  fi
}

wire_codex() {
  wire_codex_mcp
  wire_codex_plugin
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

# Hermes -- its active profile reads `mcp_servers` and `skills.external_dirs`
# from YAML. The helper backs up an existing config before a byte-preserving
# edit, then verifies a fresh Hermes process when the executable is on PATH.
has_hermes() { command -v hermes >/dev/null 2>&1 || [ -d "$HOME/.hermes" ]; }
wire_hermes() {
  config_path="$HOME/.hermes/config.yaml"
  if "$dest" hermes install --config "$config_path" --command "$dest" --data-root "$data_root" --verify; then
    record_wired "hermes: configured MCP and the installed CommitLore skill bundle in $config_path"
  else
    record_skipped "hermes" "host setup could not finish; its existing config was left intact where it could not be edited safely"
  fi
}

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
  "Hermes:has_hermes:wire_hermes" \
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
