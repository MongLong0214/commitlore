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
/** The shape the installer will consider. A pre-release is not one. */
const RELEASE_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;
export const parseReleaseVersion = (value) => {
    const match = RELEASE_TAG.exec(value.trim());
    if (match === null)
        return null;
    const [, major = '', minor = '', patch = ''] = match;
    return { major: Number(major), minor: Number(minor), patch: Number(patch) };
};
/**
 * `-1`, `0`, `1` for older, same, newer. Callers that cannot parse both sides
 * do not get a number, because there is no honest one to give.
 */
const compare = (left, right) => {
    if (left.major !== right.major)
        return left.major < right.major ? -1 : 1;
    if (left.minor !== right.minor)
        return left.minor < right.minor ? -1 : 1;
    if (left.patch !== right.patch)
        return left.patch < right.patch ? -1 : 1;
    return 0;
};
/**
 * Is `candidate` newer than `running`?
 *
 * False when either side does not parse. A pre-release does not parse, so
 * `1.2.0-rc.1` is never newer than anything -- which is the same answer the
 * installer gives by filtering it out before it ranks, and the right one for a
 * notice: an operator on `1.2.0` must not be told an `rc` supersedes it.
 */
export const isNewerRelease = (candidate, running) => {
    const a = parseReleaseVersion(candidate);
    const b = parseReleaseVersion(running);
    if (a === null || b === null)
        return false;
    return compare(a, b) > 0;
};
/**
 * The newest tag from a list, by the installer's rule: anything that is not
 * `vMAJOR.MINOR.PATCH` is dropped rather than ranked. `null` when nothing
 * survives -- the installer dies there, but a passive notice has nothing to
 * say and must not invent something.
 */
export const newestRelease = (tags) => {
    let best = null;
    for (const tag of tags) {
        const version = parseReleaseVersion(tag);
        if (version === null)
            continue;
        if (best === null || compare(version, best.version) > 0)
            best = { tag, version };
    }
    return best?.tag ?? null;
};
//# sourceMappingURL=release-version.js.map