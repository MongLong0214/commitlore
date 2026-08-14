/**
 * #653: the index caches a signature status, and a signature status is not a
 * property of the repository.
 *
 * `%G?` is the verdict of whichever process ran `git log`, and it depends on
 * the keys that process could reach. Cache it and the index answers a question
 * about a past keyring — ADR-0003 calls the index a derived cache of what git
 * already holds, and this value is not derivable from the repository at all.
 *
 * What this file asserts is the cause, not the symptom. "Two routes disagree"
 * would go green for the wrong reason: any change that happens to make them
 * agree — including one that stops the scan path from grading at all — would
 * satisfy it. The claim under test is narrower and is the thing a fix has to
 * deliver: **a cached signature verdict does not survive a change to the
 * keyring that produced it.**
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runQuery } from '../src/core/query.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];
const AUTHOR = 'signer@example.invalid';

let repo = '';
let gpgHome = '';
let emptyGpgHome = '';
let fingerprint = '';
let originalGpgHome: string | undefined;

const git = (args: string[]): string =>
  execFileSync('git', args, { cwd: repo, env: process.env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

const policy = () => ({
  trustedAuthors: [AUTHOR],
  requireSignedDirective: true,
  trustedSignerFingerprints: [fingerprint],
});

const trustOf = (opts: { readonly noIndex?: boolean }): string | undefined =>
  runQuery({ cwd: repo, ...(opts.noIndex === true ? { noIndex: true } : {}), ...policy() }).records.find(
    (record) => record.recordId === 'r-idxgen653',
  )?.trust;

beforeAll(() => {
  repo = createTestRepo({ path: mkdtempSync(join(tmpdir(), 'cl-index-signature-')) });
  gpgHome = mkdtempSync(join(tmpdir(), 'cl-index-signature-gpg-'));
  emptyGpgHome = mkdtempSync(join(tmpdir(), 'cl-index-signature-nokeys-'));
  scratch.push(repo, gpgHome, emptyGpgHome);
  originalGpgHome = process.env.GNUPGHOME;

  execFileSync('chmod', ['700', gpgHome]);
  execFileSync('chmod', ['700', emptyGpgHome]);
  process.env.GNUPGHOME = gpgHome;
  execFileSync(
    'gpg',
    ['--batch', '--passphrase', '', '--quick-generate-key', `Signer <${AUTHOR}>`, 'rsa2048', 'sign', '0'],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const listing = execFileSync('gpg', ['--batch', '--with-colons', '--list-secret-keys', AUTHOR], {
    env: process.env,
    encoding: 'utf8',
  });
  fingerprint = listing.split('\n').find((line) => line.startsWith('fpr:'))?.split(':')[9] ?? '';
  if (fingerprint === '') throw new Error('no fingerprint for the throwaway signing key');

  git(['config', 'user.name', 'Signer']);
  git(['config', 'user.email', AUTHOR]);
  git(['config', '--local', 'user.signingkey', fingerprint]);
  git(['config', '--local', 'commitlore.trustedAuthor', AUTHOR]);
  git(['config', '--local', 'commitlore.requireSignedDirective', 'true']);
  git(['config', '--local', '--add', 'commitlore.trustedSigner', fingerprint]);

  writeFileSync(join(repo, 'store.ts'), 'export const value = 0;\n');
  git(['add', 'store.ts']);
  git([
    '-c',
    'commit.gpgSign=true',
    'commit',
    '--quiet',
    '--no-verify',
    '-m',
    [
      'Keep session state local',
      '',
      'Limit: one writer at a time',
      'Blast: local',
      'Undo: easy',
      'Certainty: firm',
      'Provenance: authored',
      'Record-Id: r-idxgen653',
    ].join('\n'),
  ]);

  // Guard the fixture: git itself must call this signature good and name this
  // signer, or every assertion below would be about a broken fixture.
  expect(git(['log', '-1', '--format=%G?']).trim()).toBe('G');
  expect(git(['log', '-1', '--format=%GF']).trim()).toBe(fingerprint);
});

afterAll(() => {
  if (originalGpgHome === undefined) delete process.env.GNUPGHOME;
  else process.env.GNUPGHOME = originalGpgHome;
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('#653 a cached signature verdict does not outlive its keyring', () => {
  it('recomputes the signature status when the keyring that produced it is gone', () => {
    // Warm the index where the signing key cannot be reached. Nothing about the
    // repository has changed; only the verifier's reach has.
    process.env.GNUPGHOME = emptyGpgHome;
    expect(git(['log', '-1', '--format=%G?']).trim()).not.toBe('G');
    expect(trustOf({})).toBe('claim');

    // The keys are reachable again.
    process.env.GNUPGHOME = gpgHome;

    // Guard the guard: with the keyring back, the repository does support a
    // directive right now. Without this, an index that answered `claim` for
    // some unrelated reason would look like the defect under test.
    expect(trustOf({ noIndex: true })).toBe('directive');

    // The claim: the index must not still be answering from the keyring it had
    // when it was warmed.
    expect(trustOf({})).toBe('directive');
  });
});
