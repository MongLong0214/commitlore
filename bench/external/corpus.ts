/**
 * The pinned corpus of `bench/EXTERNAL-CORPUS.md` §3.
 *
 * The SHAs are the whole provenance story for this measurement. An external
 * repository moves every day, so a figure that named only a repository would be
 * unreproducible within a week. `resolveCorpus` therefore refuses a clone whose
 * `HEAD` is not the pinned SHA rather than measuring whatever is there — the
 * same fail-loud rule ADR-0018 applies to harness identity.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { git } from '../deterministic/shared.ts';
import type { CorpusIdentity } from './types.ts';

export interface PinnedCorpus {
  readonly name: string;
  /** The clone directory name under the corpus root. */
  readonly dir: string;
  readonly upstream: string;
  readonly licence: string;
  readonly ref: string;
  readonly calibration: boolean;
}

/**
 * The four externals, plus this repository at the exact commit that produced
 * the 81.7% and 42.0% rows in `bench/DECISION-DELIVERY.md` §9. The calibration
 * entry is measured only by §4; it is not backfilled and not re-delivered.
 */
export const PINNED_CORPORA: readonly PinnedCorpus[] = [
  {
    name: 'django/django',
    dir: 'django',
    upstream: 'https://github.com/django/django',
    licence: 'BSD-3-Clause',
    ref: '60121939f6b225c7a719dd561e372e1d8e5e2c4a',
    calibration: false,
  },
  {
    name: 'sympy/sympy',
    dir: 'sympy',
    upstream: 'https://github.com/sympy/sympy',
    licence: 'BSD-3-Clause',
    ref: '2af2aca14684997bfce7bcd7224a90b29b6d0f11',
    calibration: false,
  },
  {
    name: 'scikit-learn/scikit-learn',
    dir: 'scikit-learn',
    upstream: 'https://github.com/scikit-learn/scikit-learn',
    licence: 'BSD-3-Clause',
    ref: '5799d3eac08bda44fbce3309e641cbf98c5d312a',
    calibration: false,
  },
  {
    name: 'psf/requests',
    dir: 'requests',
    upstream: 'https://github.com/psf/requests',
    licence: 'Apache-2.0',
    ref: '414f0513c33883adf6f2b46901d4f0b38a455851',
    calibration: false,
  },
  {
    name: 'MongLong0214/commitlore',
    dir: '.',
    upstream: 'https://github.com/MongLong0214/commitlore',
    licence: 'MIT',
    ref: 'b3f569210554aab815a48c21ddef90dce029ba98',
    calibration: true,
  },
];

export interface ResolvedCorpus {
  readonly pinned: PinnedCorpus;
  readonly root: string;
  readonly identity: CorpusIdentity;
}

/**
 * Corpus facts read from the pinned ref, not typed into the method document.
 * A commit count or a date range that a person transcribed is one more figure
 * nobody checked.
 */
export const describeCorpus = (root: string, pinned: PinnedCorpus): CorpusIdentity => {
  const resolved = git(root, ['rev-parse', `${pinned.ref}^{commit}`]).stdout.trim();
  if (resolved !== pinned.ref) {
    throw new Error(`${pinned.name}: ${pinned.ref} resolves to ${resolved}, not itself`);
  }
  const commits = Number(git(root, ['rev-list', '--count', pinned.ref]).stdout.trim());
  const instants = git(root, ['log', '--format=%cI', pinned.ref]).stdout.trim().split('\n');
  const last = instants[0];
  const first = instants[instants.length - 1];
  if (last === undefined || first === undefined) throw new Error(`${pinned.name}: empty history`);
  return {
    name: pinned.name,
    upstream: pinned.upstream,
    licence: pinned.licence,
    ref: pinned.ref,
    commits,
    first_commit_at: first,
    last_commit_at: last,
    calibration: pinned.calibration,
  };
};

/**
 * The externals are measured with `HEAD` at the pinned SHA, because
 * `measureDecisionDelivery` reads the working tree through `git ls-files` and
 * `git check-attr`. The calibration corpus is this checkout, whose `HEAD` is
 * deliberately *not* the pinned ref — §4 reads it at `ref` through `ls-tree`
 * and never touches the working tree.
 */
export const resolveCorpus = (
  corpusRoot: string,
  repoRoot: string,
  pinned: PinnedCorpus,
): ResolvedCorpus => {
  const root = pinned.calibration ? repoRoot : join(corpusRoot, pinned.dir);
  if (!existsSync(join(root, '.git'))) {
    throw new Error(`${pinned.name}: no clone at ${root}`);
  }
  if (!pinned.calibration) {
    const head = git(root, ['rev-parse', 'HEAD']).stdout.trim();
    if (head !== pinned.ref) {
      throw new Error(
        `${pinned.name}: clone is at ${head}, not the pinned ${pinned.ref}; ` +
          'check out the pinned SHA or update bench/EXTERNAL-CORPUS.md §3',
      );
    }
    // The delivery metric reads the working tree through `git ls-files` and
    // `git check-attr`, so a dirty clone would put files in the evaluation set
    // that the pinned SHA does not contain.
    const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.trim();
    if (status !== '') {
      throw new Error(`${pinned.name}: clone is not clean:\n${status.split('\n').slice(0, 10).join('\n')}`);
    }
  }
  return { pinned, root, identity: describeCorpus(root, pinned) };
};
