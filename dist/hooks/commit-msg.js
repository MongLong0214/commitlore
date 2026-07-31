/**
 * The `commit-msg` hook stub installed by `commitlore hooks install`.
 *
 * Two constraints shape it:
 *
 * - **No repository path may be baked in.** The same `.git/hooks` directory is
 *   shared by every linked worktree, and a repository gets cloned, moved, and
 *   re-checked-out. The stub therefore locates its neighbours relative to `$0`
 *   and finds the CLI on `PATH` at run time.
 * - **It must be byte-identical on every install.** Idempotence is checked by
 *   comparing the file on disk to this text, so nothing here may vary per
 *   machine, per install, or per version of the repository it lands in.
 */
/**
 * Identifies a stub as ours. Never change it in place — a new marker makes
 * `hooks uninstall` treat previously installed stubs as somebody else's hook.
 */
export const HOOK_MARKER = '# commitlore:commit-msg:v1';
/** A pre-existing foreign hook is moved here and called first. */
export const CHAINED_SUFFIX = '.commitlore-chained';
export const HOOK_NAME = 'commit-msg';
export const CHAINED_HOOK_NAME = `${HOOK_NAME}${CHAINED_SUFFIX}`;
export const HOOK_MODE = 0o755;
/**
 * The stub's text.
 *
 * `set -e` plus the explicit `|| exit $?` makes a chained hook's failure the
 * stub's failure, with its own exit code, before commitlore runs at all: a hook
 * that was already rejecting commits keeps rejecting them.
 *
 * `COMMITLORE_BIN` exists so a checkout can point the hook at a specific build
 * (a test harness, a monorepo's local bin) without the installer writing an
 * absolute path into the repository. It carries the same `.js`/`.mjs`
 * allowlist as the recorded path below: an env var is reachable from CI
 * configuration, a sourced profile, or a compromised toolchain — places a
 * reviewer does not read as executable config, so it gets no more trust than
 * `commitlore.bin` does. A value that fails the check falls through to the
 * remaining resolution steps rather than being executed.
 *
 * The recorded `commitlore.bin` gets one more check `COMMITLORE_BIN` deliberately
 * does not: it must resolve inside `commitlore.root`, also recorded at install
 * time (#71). Naming a file `.js` costs a `.git/config` editor nothing, so the
 * extension check alone does not stop a post-install edit from pointing
 * `commitlore.bin` at an attacker's own script — only its location, which the
 * installer controls and a later config edit cannot rewrite without also
 * rewriting `commitlore.root`. `COMMITLORE_BIN` is exempt on purpose: its whole
 * reason to exist is aiming the hook at a build outside the install root.
 *
 * There is no `npx` fallback on purpose. `npx --no` still queries the registry
 * when the package is not installed locally, which would put a network call on
 * every commit and make offline commits fail. The local `node_modules/.bin`
 * walk covers the same case without leaving the machine.
 *
 * Only `.js`/`.mjs` is recognized. ADR-0026 removed the compiled
 * single-executable build, and with it the arm that would exec an extensionless
 * file named `commitlore` directly. That name now belongs to the installer's own
 * wrapper, which is a shell script that execs node — so the path worth trusting is
 * the bundle it runs, and an extensionless recorded path falls through to the
 * PATH search below rather than being exec'd on the strength of its name.
 */
export const commitMsgStub = () => [
    '#!/bin/sh',
    HOOK_MARKER,
    '# Installed by `commitlore hooks install`.',
    '# Edits are lost on reinstall; `commitlore hooks uninstall` removes this file',
    `# and restores any ${CHAINED_HOOK_NAME} hook saved beside it.`,
    'set -e',
    '',
    '# Paths are taken apart with parameter expansion rather than dirname: a',
    '# hook that needs a working PATH to find its own directory would die with',
    '# 127 instead of reporting anything useful.',
    'case "$0" in',
    '  */*) hook_dir=${0%/*} ;;',
    '  *) hook_dir=. ;;',
    'esac',
    `chained="$hook_dir/${CHAINED_HOOK_NAME}"`,
    '',
    '# git only runs an executable hook, so an unset execute bit means the',
    '# preserved hook was already inert before commitlore arrived.',
    'if [ -x "$chained" ]; then',
    '  "$chained" "$@" || exit $?',
    'fi',
    '',
    'if [ -n "${COMMITLORE_BIN:-}" ]; then',
    '  # Same allowlist as the recorded commitlore.bin case below: any executable',
    '  # here used to run unchecked, which is exactly the gap an env var is for.',
    '  case "$COMMITLORE_BIN" in',
    '    *.mjs|*.js)',
    '      exec "$COMMITLORE_BIN" validate --message-file "$1"',
    '      ;;',
    '  esac',
    'fi',
    '',
    '# Where `hooks install` was run from. A clone is a complete installation',
    '# (ADR-0011), so the common case is a checkout that is on no PATH and in no',
    "# node_modules — and the installer is the only thing that ever knew where it",
    '# was. Recorded in local git config rather than in this file so the stub',
    '# stays byte-identical wherever it came from, which is what `hooks status`',
    '# compares against.',
    '#',
    '# Ahead of the PATH and node_modules searches below, because this is the only',
    '# branch that also knows its *interpreter*. Those searches guess at an',
    '# installation, and a guessed sibling used to win: a stale',
    '# `node_modules/.bin/commitlore` in a parent directory shadowed the recorded',
    "# path, and that shim's own first line is `exec node`, so it died with 127 in",
    '# exactly the PATH-less environment this file exists to survive. A stale guess',
    '# also validates commits with a different version than the one installed here.',
    'recorded=$(git config --local --get commitlore.bin 2>/dev/null || true)',
    'if [ -n "$recorded" ]; then',
    "  # What `hooks install` recorded as this install's trusted location: the",
    '  # directory the recorded script has to sit under.',
    '  recorded_root=$(git config --local --get commitlore.root 2>/dev/null || true)',
    '  case "$recorded" in',
    '    *.mjs|*.js)',
    '      # The interpreter is recorded as an absolute path too. A bare `node`',
    "      # here dies with 127 whenever the hook's PATH lacks it, which is the",
    '      # same environment this whole branch exists to survive.',
    '      recorded_node=$(git config --local --get commitlore.node 2>/dev/null || true)',
    '      # An extension match alone lets a config edit after install point this',
    '      # at any .js file, anywhere. `doctor` has warned about a recorded path',
    '      # outside the install root since the extension check was added; this is',
    '      # that same fact enforced here instead of only reported. `-L` closes the',
    '      # gap a directory-only containment check would leave open: a symlink',
    '      # planted inside the root but pointing outside it.',
    '      if [ -x "$recorded_node" ] && [ -n "$recorded_root" ] && [ ! -L "$recorded" ]; then',
    '        # Both sides are resolved before they are compared. Matching a stored',
    '        # string against a resolved one is what broke this on Windows: the',
    '        # installer records a win32 path and the shell git runs hooks with',
    '        # answers in POSIX form from `pwd -P`, so the case matched nothing --',
    "        # not an attacker's path, and not the installer's own bundle either.",
    '        #',
    '        # The separator is normalised first because neither `dirname` nor',
    '        # ${var%/*} finds a parent in a backslash-separated path; both yield',
    '        # `.`, which resolves to the repository rather than to the install.',
    "        recorded_slashed=$(printf %s \"$recorded\" | tr '\\\\' /)",
    "        root_slashed=$(printf %s \"$recorded_root\" | tr '\\\\' /)",
    '        case "$recorded_slashed" in',
    '          */*) recorded_parent=${recorded_slashed%/*} ;;',
    '          *) recorded_parent=. ;;',
    '        esac',
    '        recorded_dir=$(cd "$recorded_parent" 2>/dev/null && pwd -P) || recorded_dir=',
    '        root_dir=$(cd "$root_slashed" 2>/dev/null && pwd -P) || root_dir=',
    '        if [ -n "$recorded_dir" ] && [ -n "$root_dir" ]; then',
    '          case "$recorded_dir" in',
    '            "$root_dir"|"$root_dir"/*)',
    '              exec "$recorded_node" "$recorded" validate --message-file "$1"',
    '              ;;',
    '          esac',
    '        fi',
    '      fi',
    '      ;;',
    '  esac',
    'fi',
    '',
    'if command -v commitlore >/dev/null 2>&1; then',
    '  exec commitlore validate --message-file "$1"',
    'fi',
    '',
    '# A local devDependency is not on PATH inside a hook, so resolve it the way',
    '# node would: walk up from the working directory.',
    '#',
    '# The loop stops when stripping a component stops making progress, not when',
    '# the result is empty. ${dir%/*} returns its input unchanged once no `/`',
    '# remains, so a drive-letter root settles on `C:` and the walk never ends --',
    '# measured on a Windows runner, where $PWD inside a hook is `C:/Users/...`',
    '# and a real commit therefore never returned.',
    'dir=$PWD',
    'while [ -n "$dir" ]; do',
    '  if [ -x "$dir/node_modules/.bin/commitlore" ]; then',
    '    exec "$dir/node_modules/.bin/commitlore" validate --message-file "$1"',
    '  fi',
    '  parent=${dir%/*}',
    '  if [ "$parent" = "$dir" ]; then',
    '    break',
    '  fi',
    '  dir=$parent',
    'done',
    '',
    '# Passing silently here would report a clean record for a message nothing',
    '# ever read.',
    'echo "commitlore: cannot find the CLI this hook was installed with." >&2',
    'echo "  set COMMITLORE_BIN, or re-run: <path-to>/commitlore hooks install" >&2',
    'exit 1',
    '',
].join('\n');
//# sourceMappingURL=commit-msg.js.map