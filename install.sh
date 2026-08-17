#!/bin/sh
# Installs commitlore from source, for any agent that is not Claude Code.
#
#   curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v1.0.2/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v1.0.2/install.sh | sh -s v1.0.2
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
# The index needs FTS5 as well as the `node:sqlite` module. The module is
# unflagged from 22.13, but bundled SQLite exposes FTS5 only from 22.16. The
# package tracks the current stable Node 22 LTS, 22.23.2, which guarantees both
# requirements; `engines.node` says the same.
NODE_MINOR_MIN=23
NODE_PATCH_MIN=2
NODE_FLOOR="$NODE_MAJOR_MIN.$NODE_MINOR_MIN.$NODE_PATCH_MIN"

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
[ -n "$node_bin" ] || die "Node.js $NODE_FLOOR or newer is required and no \"node\" was found on PATH. Install Node.js $NODE_FLOOR+ (https://nodejs.org), then run this again. Nothing was installed." 1

node_version="$("$node_bin" --version 2>/dev/null || true)"
case "$node_version" in
  v[0-9]*) ;;
  *) die "\"$node_bin --version\" did not report a version (got: \"$node_version\"), so the Node.js major version cannot be checked. Nothing was installed." 1 ;;
esac
node_major="$(printf '%s' "$node_version" | sed 's/^v//' | cut -d. -f1)"
node_minor="$(printf '%s' "$node_version" | sed 's/^v//' | cut -d. -f2)"
node_patch="$(printf '%s' "$node_version" | sed 's/^v//' | cut -d. -f3)"
case "$node_minor" in ''|*[!0-9]*) node_minor=0 ;; esac
case "$node_patch" in ''|*[!0-9]*) node_patch=0 ;; esac
if [ "$node_major" -eq "$NODE_MAJOR_MIN" ] && { [ "$node_minor" -lt "$NODE_MINOR_MIN" ] || { [ "$node_minor" -eq "$NODE_MINOR_MIN" ] && [ "$node_patch" -lt "$NODE_PATCH_MIN" ]; }; }; then
  die "Node.js $node_version is too old: this release needs Node $NODE_FLOOR or newer (node:sqlite with FTS5 for the index). Upgrade Node.js, then run this again. Nothing was installed." 1
fi
if [ "$node_major" -lt "$NODE_MAJOR_MIN" ]; then
  die "Node.js $NODE_FLOOR or newer is required; this machine has $node_version. Upgrade Node.js, then run this again. Nothing was installed." 1
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
        # The *contents*, not the directory name. Requiring only a directory
        # called `v1.2.3` meant anyone could make one and have an unrelated
        # executable at the wrapper path replaced -- the check asked whether a
        # name existed, which is the thing an attacker controls. `dist/commitlore.mjs`
        # is written by this install and by nothing else.
        # The runtime has to answer, not merely exist. A file at that path is
        # still something anyone can create -- the previous rule accepted one
        # containing a comment -- so the evidence is that it runs and reports
        # the version the wrapper claims. Forging that means installing a
        # working CommitLore of that version, which is not an attack.
        owned_checkout=""
        for candidate in "$data_root/v$existing_version" "$data_root/$existing_version"; do
          [ -f "$candidate/dist/commitlore.mjs" ] || continue
          reported="$("$node_bin" "$candidate/dist/commitlore.mjs" --version 2>/dev/null || true)"
          if [ "$reported" = "$existing_version" ]; then owned_checkout="$candidate"; break; fi
        done
        if [ -n "$owned_checkout" ]; then
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

# A version-free path to the bundle, maintained beside the versioned checkouts
# (#693).
#
# `commitlore hooks install` records an absolute path to the bundle so a hook is
# independent of PATH and of any node_modules/.bin/commitlore above the
# repository. Recording the versioned checkout pins that repository to one
# release: three repositories on the first machine to upgrade were still
# validating commits with 0.8.2 and 0.8.0, and this repository was one of them.
#
# The wrapper cannot stand in for it -- that was tried and fails, because a hook
# runs where PATH may carry no node and a shell script cannot be launched with
# the recorded interpreter. A symlink to the checkout keeps both properties: an
# absolute path to a .mjs, and one that does not name a release.
#
# Symlink, then rename: an existing `current` cannot be replaced in place while
# something is reading through it.
current_link="$data_root/current"
current_tmp="$current_link.commitlore-install.$$"
if ln -sfn "$candidate" "$current_tmp" 2>/dev/null && mv -f "$current_tmp" "$current_link" 2>/dev/null; then
  log "current -> $(basename "$candidate")"
else
  rm -f "$current_tmp" 2>/dev/null || true
  # Not fatal. A host without symlinks still has a working install; hooks there
  # keep recording the versioned path and `commitlore hooks install` after an
  # upgrade remains the repair, which `doctor` already names.
  log "note: could not maintain $current_link -- hooks will record a versioned path"
fi

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
# Detection, every config write, and the live MCP probes are one TypeScript
# command shared with install.ps1. This script activates the verified wrapper,
# prints that command's stable summary, and returns its status; it must never
# turn a failed host into a successful install.
#
# The has_/wire_ pairs that used to sit here were deleted in #691. Nothing
# called them -- the work moved to `installer-hosts` -- but they still read as
# the list of hosts this installer supports, which is how #689 happened and how
# two later readers reached the same wrong conclusion from install.ps1's copy.

log ""
log "Detecting coding agents..."
log ""
log "== commitlore install summary =="
# Host inspection and all writes are deliberately delegated.  The installer
# only activates the wrapper, prints this command's stable summary, and returns
# its status; it must never turn a failed host into a successful install.
host_status=0
"$dest" installer-hosts --wrapper "$dest" --data-root "$data_root" --home "$HOME" --json \
  >"$work/installer-hosts.json" 2>"$work/installer-hosts.err" || host_status=$?
cat "$work/installer-hosts.json"
# A non-zero status with nothing shown is the failure this installer exists to
# stop making, inverted: the user is told the install did not succeed and never
# told what is wrong or with which host.  Whatever the command managed to say is
# surfaced here, and saying nothing at all is itself reported rather than
# swallowed -- an exit code alone is not a diagnosis.
if [ "$host_status" -ne 0 ]; then
  if [ -s "$work/installer-hosts.err" ]; then
    while IFS= read -r line; do log "  $line"; done <"$work/installer-hosts.err"
  fi
  if [ ! -s "$work/installer-hosts.json" ] && [ ! -s "$work/installer-hosts.err" ]; then
    log "  host inspection exited $host_status and reported nothing: unhealthy, cause unknown"
  fi
fi
log ""
log "Next: cd into a repository and run 'commitlore init' to install its git hook and index."
log "(install.sh never runs init for you -- it only installs the tool and wires agents, never touches a repository's .git.)"
exit "$host_status"
