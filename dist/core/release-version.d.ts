/**
 * Ranking release tags, the way the installer already does (T-1601, #742).
 *
 * `install.sh` picks the newest tag with no `sort -V` -- that flag is a
 * GNU/BSD extension and the script is POSIX sh. It zero-pads the three fields
 * so a plain lexical sort becomes a numeric one, and it considers only
 * `vMAJOR.MINOR.PATCH`:
 *
 *   grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$'
 *   awk -F. '{ printf "%010d %010d %010d %s\n", maj, $2, $3, $0 }' | sort | tail -1
 *
 * This is the same ranking in TypeScript, and `test/release-version.test.ts`
 * feeds both the same tag list and asserts they pick the same winner. Two
 * rankings that disagree is a defect with no symptom until the day it has one
 * -- and the day is `v9` versus `v10`, which is what the padding exists for.
 *
 * Everything here answers rather than throws. `runtimeIdentity` reports
 * `0.0.0-unknown` when the manifest cannot be read, and "we do not know what
 * is running" must never turn into "you are out of date". `gh` takes the same
 * line: its comparison requires both sides to parse before it will say
 * anything (`update.go`), and silence is the safe direction for a notice
 * nobody asked for.
 */
export interface ReleaseVersion {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
}
export declare const parseReleaseVersion: (value: string) => ReleaseVersion | null;
/**
 * Is `candidate` newer than `running`?
 *
 * False when either side does not parse. A pre-release does not parse, so
 * `1.2.0-rc.1` is never newer than anything -- which is the same answer the
 * installer gives by filtering it out before it ranks, and the right one for a
 * notice: an operator on `1.2.0` must not be told an `rc` supersedes it.
 */
export declare const isNewerRelease: (candidate: string, running: string) => boolean;
/**
 * The newest tag from a list, by the installer's rule: anything that is not
 * `vMAJOR.MINOR.PATCH` is dropped rather than ranked. `null` when nothing
 * survives -- the installer dies there, but a passive notice has nothing to
 * say and must not invent something.
 */
export declare const newestRelease: (tags: readonly string[]) => string | null;
