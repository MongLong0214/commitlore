/**
 * T-1601 (#742): the ranking must be the installer's, not a second one.
 *
 * `install.sh` picks the newest tag with a zero-padded lexical sort because it
 * is POSIX sh and cannot rely on `sort -V`. If this TypeScript ranking
 * disagrees anywhere, the notice tells an operator a different story from the
 * one the installer will act on, and nothing surfaces that until the day it
 * matters -- which is `v9` against `v10`.
 *
 * So the central test does not restate the rule. It runs the installer's own
 * pipeline and asserts both pick the same tag.
 */

import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { isNewerRelease, newestRelease, parseReleaseVersion } from '../src/core/release-version.js';

/** The exact pipeline from `install.sh`, fed a tag list on stdin. */
const installerPick = (tags: readonly string[]): string =>
  execFileSync(
    'sh',
    [
      '-c',
      `grep -E '^v[0-9]+\\.[0-9]+\\.[0-9]+$' ` +
        `| awk -F. '{ maj = $1; sub(/^v/, "", maj); printf "%010d %010d %010d %s\\n", maj + 0, $2 + 0, $3 + 0, $0 }' ` +
        `| sort | tail -n 1 | awk '{ print $4 }'`,
    ],
    { input: `${tags.join('\n')}\n`, encoding: 'utf8' },
  ).trim();

describe('T-1601 release ranking', () => {
  const CORPUS = [
    'v0.8.0', 'v1.0.1', 'v1.0.2', 'v1.1.1', 'v1.1.2', 'v1.1.3', 'v1.1.4',
    'v1.1.9', 'v1.1.10', 'v1.2.0', 'v1.99.99', 'v2.0.0', 'v9.0.0', 'v10.0.0',
    'v1.2.0-rc.1', 'nightly', 'v1.2', 'release-1.1.4',
  ];

  it('picks the same winner as install.sh, on the list install.sh would see', () => {
    expect(newestRelease(CORPUS)).toBe(installerPick(CORPUS));
  });

  it.each([
    ['v1.1.10', 'v1.1.9'],
    ['v1.2.0', 'v1.1.99'],
    ['v2.0.0', 'v1.99.99'],
    ['v10.0.0', 'v9.0.0'],
  ])('%s is newer than %s', (newer, older) => {
    expect(isNewerRelease(newer, older)).toBe(true);
    expect(isNewerRelease(older, newer)).toBe(false);
  });

  it('does not call a prerelease newer than its release', () => {
    // The installer drops it before ranking; here it simply fails to parse, so
    // the notice stays quiet rather than telling somebody on 1.2.0 that an rc
    // supersedes them.
    expect(isNewerRelease('v1.2.0-rc.1', 'v1.2.0')).toBe(false);
    expect(parseReleaseVersion('v1.2.0-rc.1')).toBeNull();
  });

  it('does not call an equal version newer', () => {
    expect(isNewerRelease('v1.1.4', '1.1.4')).toBe(false);
    expect(isNewerRelease('1.1.4', 'v1.1.4')).toBe(false);
  });

  it('never turns "we do not know what is running" into "you are out of date"', () => {
    // `runtimeIdentity` reports this when the manifest cannot be read.
    expect(isNewerRelease('v9.9.9', '0.0.0-unknown')).toBe(false);
    expect(parseReleaseVersion('0.0.0-unknown')).toBeNull();
  });

  it.each(['', 'main', 'v1', 'v1.2', 'vX.Y.Z', '1.1.4.5'])(
    'answers "not newer" for %o rather than throwing',
    (bad) => {
      expect(() => isNewerRelease(bad, 'v1.0.0')).not.toThrow();
      expect(isNewerRelease(bad, 'v1.0.0')).toBe(false);
      expect(isNewerRelease('v1.0.0', bad)).toBe(false);
    },
  );

  it('has nothing to say when no tag is a release', () => {
    expect(newestRelease(['nightly', 'v1.2', 'v1.2.0-rc.1'])).toBeNull();
  });
});
