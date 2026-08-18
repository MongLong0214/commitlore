/**
 * Does this commit ask for a canonical rebuild, or is it one? (T-1501, #719)
 *
 * `canonical-rebuild.yml` opens a pull request carrying a rebuilt `dist/` when a
 * push to `main` leaves the committed bundle behind its source. That pull
 * request's own merge is a push to `main` touching exactly `dist/` and the
 * manifest — so without this the feature answers itself forever.
 *
 * It lives here rather than inline in the workflow because the shape it has to
 * recognise **does not exist in this repository's history**. Every pull request
 * currently carries its own `dist/`, which is #719's complaint, so a
 * squash-merged commit touching only the bundle is something this feature will
 * create and nothing has yet. A guard whose only subject is its own output has
 * no observation behind it, and #691 is the record of what that costs: "the
 * test was measuring a copy of the logic rather than the copy that runs."
 * The workflow calls this file; `test/canonical-rebuild-guard.test.ts` drives
 * the same file against real commits it builds.
 *
 * Usage: node scripts/canonical-rebuild-guard.mjs [<ref>] [--cwd <dir>]
 * Prints `skip=1` or `skip=0` and exits 0. Exits 2 when it cannot decide.
 */

import { spawnSync } from 'node:child_process';

const ARTIFACT_PATHS = [/^dist\//, /^installer\/canonical-artifact\.json$/];

/**
 * The paths a commit changed, first-parent only.
 *
 * `--first-parent` matters: a merge commit's default diff is against every
 * parent at once, and a merge that resolved only `dist/` — this repository has
 * one, `bd297e1` — would report exactly the artifact paths while being nothing
 * like a rebuild. Reading a merge as a rebuild is the direction that loops.
 */
export const changedPaths = (ref = 'HEAD', cwd = process.cwd()) => {
  const run = spawnSync(
    'git',
    ['show', '--first-parent', '--name-only', '--format=', ref],
    { cwd, encoding: 'utf8', shell: false },
  );
  if (run.status !== 0) return null;
  return [...new Set(run.stdout.split('\n').map((l) => l.trim()).filter(Boolean))].sort();
};

/**
 * Whether the workflow should stand down for this commit.
 *
 * An empty path list is deliberately **not** a skip. No paths is no evidence,
 * and reading it as proof of a rebuild would silently pass over a push that
 * needs one — the failure would be a `main` whose bundle never catches up,
 * reported as a workflow that ran and found nothing to do.
 */
export const isRebuildCommit = (paths) =>
  paths !== null && paths.length > 0 && paths.every((p) => ARTIFACT_PATHS.some((r) => r.test(p)));

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const cwdAt = args.indexOf('--cwd');
  const cwd = cwdAt >= 0 ? args[cwdAt + 1] : process.cwd();
  // The index to skip only exists when --cwd was given. Deriving it from -1
  // makes it 0, which silently drops a ref passed as the first argument -- the
  // ordinary way to call this.
  const skipIndex = cwdAt >= 0 ? cwdAt + 1 : -1;
  const ref = args.find((a, i) => !a.startsWith('--') && i !== skipIndex) ?? 'HEAD';

  const paths = changedPaths(ref, cwd);
  if (paths === null) {
    process.stderr.write(`canonical-rebuild-guard: cannot read ${ref}\n`);
    process.exit(2);
  }
  const skip = isRebuildCommit(paths);
  process.stderr.write(
    `canonical-rebuild-guard: ${ref} touched ${paths.length} path(s)${paths.length ? `: ${paths.join(', ')}` : ''}\n`,
  );
  process.stdout.write(`skip=${skip ? '1' : '0'}\n`);
}
