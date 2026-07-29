/**
 * Dogfooding, enforced.
 *
 * A protocol whose own repository violates it is a protocol nobody has reason
 * to adopt. This suite runs the validator over this repository's real history
 * and fails the build when a record we wrote does not conform.
 *
 * The adoption point is **derived, not configured**. It is the oldest commit
 * whose record declares `CommitLore-Version:`. Everything before it predates
 * the vocabulary (this repository ran under two retired names) and is left
 * alone; everything from it forward is held to the spec. Nothing here needs
 * updating when the history grows -- which is the point, because a hand-
 * maintained cutoff is the first thing to go stale.
 *
 * When this fails there are exactly two honest resolutions, and the choice
 * gets recorded either way (see CONTRIBUTING.md):
 *   1. the commit was wrong  -> fix the practice
 *   2. the rule was wrong    -> change the spec, add a fixture, say why
 * Editing this test to look away is neither.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runValidate } from '../src/commands/validate.js';
import { findDanglingRefs, findIdCollisions } from '../src/core/stale.js';
import { parseCommitMessage } from '../src/core/trailers.js';
import { validateRecord } from '../src/core/schema.js';
import { RECORD_ID_RE, type Trailer } from '../src/core/types.js';
import { createTestRepo } from './git-fixtures.js';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

const git = (args: string[]): string =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

interface HistoryEntry {
  sha: string;
  parents: string[];
  subject: string;
  trailers: Trailer[];
}

/**
 * Whole history, oldest first. The `%x00` separator survives every character a
 * commit message can legally contain, which `\n` does not.
 */
const readHistory = (): HistoryEntry[] => {
  const raw = git(['log', '--reverse', '--format=%H%x00%P%x00%s%x00%B%x1e']);
  return raw
    .split('\x1e')
    .map((chunk) => chunk.replace(/^\n/, ''))
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const [sha = '', parents = '', subject = '', body = ''] = chunk.split('\x00');
      return {
        sha,
        parents: parents.split(' ').filter(Boolean),
        subject,
        trailers: parseCommitMessage(body),
      };
    });
};

const isShallow = (): boolean => {
  try {
    return git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
  } catch {
    return false;
  }
};

const history = isShallow() ? [] : readHistory();

/**
 * The oldest record that declares the current protocol version. Records older
 * than this used a retired vocabulary and are out of scope by construction.
 */
const adoptionIndex = history.findIndex((entry) =>
  entry.trailers.some((t) => t.key === 'CommitLore-Version'),
);

// Commits with more than one parent are excluded: their platform-generated
// merge messages carry no authored decision, so requiring a record would
// require one nobody wrote.
const inScope =
  adoptionIndex === -1
    ? []
    : history.slice(adoptionIndex).filter((entry) => entry.parents.length <= 1);
const withRecords = inScope.filter((entry) => entry.trailers.length > 0);

const validateHistory = (messages: string[]) => {
  const repo = createTestRepo({ path: mkdtempSync(join(tmpdir(), 'commitlore-dogfood-')) });
  try {
    const records = messages.map((message, index) => {
      const file = `record-${index}.txt`;
      writeFileSync(join(repo, file), `${file}\n`);
      execFileSync('git', ['add', file], { cwd: repo });
      execFileSync('git', ['commit', '-q', '--no-verify', '-F', '-'], { cwd: repo, input: message });
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
      return { sha, source: 'commit' as const, trailers: parseCommitMessage(message) };
    });
    return {
      records,
      result: runValidate({ commit: 'HEAD', cwd: repo }),
    };
  } finally {
    // The result has already read the repository; keep temporary histories out of the workspace.
    rmSync(repo, { recursive: true, force: true });
  }
};

describe('dogfooding: this repository obeys its own protocol', () => {
  it('has a full clone to check against', () => {
    // A shallow clone silently reduces this suite to nothing, which would look
    // identical to passing. CI must use fetch-depth: 0.
    expect(
      isShallow(),
      'shallow clone: history is truncated, so dogfooding cannot be checked. Use fetch-depth: 0.',
    ).toBe(false);
    expect(history.length).toBeGreaterThan(0);
  });

  it('has adopted the protocol in its own history', () => {
    expect(
      adoptionIndex,
      'no commit declares CommitLore-Version: -- the repository does not use the protocol it defines',
    ).toBeGreaterThanOrEqual(0);
  });

  it('records enough of its own history to be meaningful', () => {
    // Guards against the suite passing because the range happens to be empty.
    expect(withRecords.length).toBeGreaterThanOrEqual(3);
  });

  it('every in-scope record validates with zero violations', () => {
    const offenders = withRecords
      .map((entry) => ({ entry, violations: validateRecord(entry.trailers) }))
      .filter(({ violations }) => violations.length > 0)
      .map(
        ({ entry, violations }) =>
          `${entry.sha.slice(0, 7)} ${entry.subject}\n` +
          violations
            .map((v) => `      ${v.rule}: ${v.key}=${JSON.stringify(v.value)} want ${v.want}`)
            .join('\n'),
      );
    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([]);
  });

  it('every in-scope record carries a Record-Id', () => {
    // Without an identity a record cannot be superseded, chained, or expired --
    // it is inert. SPEC sections 3.2 and 5.
    const missing = withRecords
      .filter((entry) => !entry.trailers.some((t) => t.key === 'Record-Id'))
      .map((entry) => `${entry.sha.slice(0, 7)} ${entry.subject}`);
    expect(missing, `\n${missing.join('\n')}\n`).toEqual([]);
  });

  it('Record-Ids are unique across the history', () => {
    const collisions = findIdCollisions(
      withRecords.map((entry) => ({ ...entry, source: 'commit' as const })),
    ).map((violation) => violation.value);
    expect(collisions, `\n${collisions.join('\n')}\n`).toEqual([]);
  });

  it('keeps duplicate detection and validate aligned across succession histories', () => {
    const undeclared = validateHistory([
      'first\n\nRecord-Id: r-dupid1\n',
      'second\n\nRecord-Id: r-dupid1\n',
    ]);
    expect(findIdCollisions(undeclared.records).map((violation) => violation.value)).toEqual(['r-dupid1']);
    expect(undeclared.result.code).toBe(1);
    expect(undeclared.result.violations).toContainEqual(
      expect.objectContaining({ rule: 'duplicate-id', value: 'r-dupid1' }),
    );

    const succeeded = validateHistory([
      'first\n\nRecord-Id: r-success1\n',
      'replacement\n\nSupersedes: r-success1\nRecord-Id: r-success1\n',
    ]);
    expect(findIdCollisions(succeeded.records)).toEqual([]);
    expect(findDanglingRefs(succeeded.records)).toEqual([]);
    expect(succeeded.result.code).toBe(0);
    expect(succeeded.result.violations).toEqual([]);

    const dangling = validateHistory(['replacement\n\nSupersedes: r-missing1\nRecord-Id: r-success3\n']);
    expect(findDanglingRefs(dangling.records).map((violation) => violation.value)).toEqual(['r-missing1']);
    expect(dangling.result.code).toBe(1);
    expect(dangling.result.violations).toContainEqual(
      expect.objectContaining({ rule: 'dangling-ref', value: 'r-missing1' }),
    );
  });

  it('Follows: and Supersedes: resolve to a Record-Id that exists', () => {
    // The dangling-ref class of SPEC section 6, checked against real history
    // rather than a fixture. A reference that goes nowhere is a broken chain,
    // and context assembly would silently return less than it should.
    //
    // The lookup spans the *whole* history, not just the in-scope range. A
    // decision chain does not begin when the tooling is adopted: this repo's
    // first CommitLore-Version record legitimately follows a record written
    // under the previous vocabulary. Restricting the lookup to in-scope
    // records reported that valid reference as dangling -- the first defect
    // this suite caught was in the suite itself.
    const known = new Set<string>();
    for (const entry of history) {
      for (const t of entry.trailers) {
        if (t.key === 'Record-Id') known.add(t.value);
      }
    }
    const dangling: string[] = [];
    for (const entry of withRecords) {
      for (const t of entry.trailers) {
        if (t.key !== 'Follows' && t.key !== 'Supersedes') continue;
        if (!RECORD_ID_RE.test(t.value)) {
          dangling.push(`${entry.sha.slice(0, 7)} ${t.key}: ${t.value} (malformed)`);
        } else if (!known.has(t.value)) {
          dangling.push(`${entry.sha.slice(0, 7)} ${t.key}: ${t.value} (no such record)`);
        }
      }
    }
    expect(dangling, `\n${dangling.join('\n')}\n`).toEqual([]);
  });

  it('Evidence: paths that look repo-relative actually exist', () => {
    // The harvest verifier's job (T-404), applied to the records we wrote by
    // hand. A citation nobody can follow is decoration.
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    const { resolve } = require('node:path') as typeof import('node:path');
    const broken: string[] = [];
    for (const entry of withRecords) {
      for (const t of entry.trailers) {
        if (t.key !== 'Evidence') continue;
        if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(t.value)) continue; // URL
        const path = t.value.split('#')[0] ?? '';
        if (!existsSync(resolve(REPO_ROOT, path))) {
          broken.push(`${entry.sha.slice(0, 7)} Evidence: ${t.value}`);
        }
      }
    }
    expect(broken, `\n${broken.join('\n')}\n`).toEqual([]);
  });
});
