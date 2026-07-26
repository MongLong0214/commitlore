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
 * absolute path into the repository.
 *
 * There is no `npx` fallback on purpose. `npx --no` still queries the registry
 * when the package is not installed locally, which would put a network call on
 * every commit and make offline commits fail. The local `node_modules/.bin`
 * walk covers the same case without leaving the machine.
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
    '  exec "$COMMITLORE_BIN" validate --message-file "$1"',
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
    '  case "$recorded" in',
    '    *.mjs|*.js)',
    '      # The interpreter is recorded as an absolute path too. A bare `node`',
    "      # here dies with 127 whenever the hook's PATH lacks it, which is the",
    '      # same environment this whole branch exists to survive.',
    '      recorded_node=$(git config --local --get commitlore.node 2>/dev/null || true)',
    '      if [ -x "$recorded_node" ]; then',
    '        exec "$recorded_node" "$recorded" validate --message-file "$1"',
    '      fi',
    '      if command -v node >/dev/null 2>&1; then',
    '        exec node "$recorded" validate --message-file "$1"',
    '      fi',
    '      ;;',
    '    *) exec "$recorded" validate --message-file "$1" ;;',
    '  esac',
    'fi',
    '',
    'if command -v commitlore >/dev/null 2>&1; then',
    '  exec commitlore validate --message-file "$1"',
    'fi',
    '',
    '# A local devDependency is not on PATH inside a hook, so resolve it the way',
    '# node would: walk up from the working directory.',
    'dir=$PWD',
    'while [ -n "$dir" ]; do',
    '  if [ -x "$dir/node_modules/.bin/commitlore" ]; then',
    '    exec "$dir/node_modules/.bin/commitlore" validate --message-file "$1"',
    '  fi',
    '  dir=${dir%/*}',
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