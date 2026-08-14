/**
 * #597 signer authority is an integration boundary, not a status-string unit.
 *
 * These commits are signed by two throwaway GPG keys. Git itself verifies them
 * through the temporary keyring; no test doubles a `%G?` or `%GF` result.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prepareCaptureContext } from '../src/core/capture-prepare.js';
import { beforeChange } from '../src/core/before-change.js';
import { guard } from '../src/core/guard.js';
import { buildInjection } from '../src/core/inject.js';
import { runQuery } from '../src/core/query.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];
const TRUSTED_AUTHOR = 'maintainer@example.invalid';
const OUTSIDER_AUTHOR = 'outsider@example.invalid';
const PROPOSAL = 'move the session store to shared Redis cache';

let repo = '';
let gpgHome = '';
let approvedFingerprint = '';
let unapprovedFingerprint = '';
let originalGpgHome: string | undefined;

const git = (args: string[], input?: string): string =>
  execFileSync('git', args, {
    cwd: repo,
    env: process.env,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

const fingerprintFor = (email: string): string => {
  const listing = execFileSync('gpg', ['--batch', '--with-colons', '--list-secret-keys', email], {
    env: process.env,
    encoding: 'utf8',
  });
  const fingerprint = listing
    .split('\n')
    .find((line) => line.startsWith('fpr:'))
    ?.split(':')[9];
  if (fingerprint === undefined || fingerprint === '') throw new Error(`no fingerprint for ${email}`);
  return fingerprint;
};

const makeKey = (name: string, email: string): string => {
  execFileSync(
    'gpg',
    ['--batch', '--passphrase', '', '--quick-generate-key', `${name} <${email}>`, 'rsa2048', 'sign', '0'],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return fingerprintFor(email);
};

const commitRecord = (opts: {
  readonly filename: string;
  readonly recordId: string;
  readonly author: string;
  readonly signingKey: string;
  readonly title: string;
}): string => {
  writeFileSync(join(repo, opts.filename), `${opts.recordId}\n`);
  git(['add', opts.filename]);
  git(
    [
      'commit',
      '--no-verify',
      `-S${opts.signingKey}`,
      `--author=${opts.author}`,
      '-m',
      `${opts.title}\n\nRuled-out: shared Redis cache | keep session state local\nRecord-Id: ${opts.recordId}\nProvenance: authored`,
    ],
  );
  return git(['rev-parse', 'HEAD']).trim();
};

const signedPolicy = () => ({
  trustedAuthors: [TRUSTED_AUTHOR],
  requireSignedDirective: true,
  trustedSignerFingerprints: [approvedFingerprint],
});

const recordsById = (): Map<string, string | undefined> =>
  new Map(
    runQuery({ cwd: repo, noIndex: true, ...signedPolicy() }).records.map((record) => [record.recordId ?? '', record.trust]),
  );

beforeAll(() => {
  repo = createTestRepo({ path: mkdtempSync(join(tmpdir(), 'cl-signer-authority-')) });
  gpgHome = mkdtempSync(join(tmpdir(), 'cl-signer-authority-gpg-'));
  scratch.push(repo, gpgHome);
  originalGpgHome = process.env.GNUPGHOME;
  process.env.GNUPGHOME = gpgHome;

  execFileSync('chmod', ['700', gpgHome]);
  approvedFingerprint = makeKey('Approved signer', TRUSTED_AUTHOR);
  unapprovedFingerprint = makeKey('Unapproved signer', OUTSIDER_AUTHOR);
  git(['config', 'user.name', 'Maintainer']);
  git(['config', 'user.email', TRUSTED_AUTHOR]);
  git(['config', '--local', 'commit.gpgSign', 'false']);
  git(['config', '--local', 'commitlore.trustedAuthor', TRUSTED_AUTHOR]);
  git(['config', '--local', 'commitlore.requireSignedDirective', 'true']);
  git(['config', '--local', '--add', 'commitlore.trustedSigner', approvedFingerprint]);

  commitRecord({
    filename: 'unapproved.ts',
    recordId: 'r-unapproved597',
    author: `Maintainer <${TRUSTED_AUTHOR}>`,
    signingKey: unapprovedFingerprint,
    title: 'unapproved signer',
  });
  commitRecord({
    filename: 'forged.ts',
    recordId: 'r-forged597',
    author: `Maintainer <${TRUSTED_AUTHOR}>`,
    signingKey: unapprovedFingerprint,
    title: 'forged author header',
  });
  const approvedCommit = commitRecord({
    filename: 'approved.ts',
    recordId: 'r-approved597',
    author: `Maintainer <${TRUSTED_AUTHOR}>`,
    signingKey: approvedFingerprint,
    title: 'approved signer',
  });

  // `git notes` creates a commit for the notes ref. Sign it explicitly so the
  // notes declaration is authenticated by its actual writer, not its target.
  git(['-c', `user.signingkey=${approvedFingerprint}`, '-c', 'commit.gpgSign=true', 'notes', '--ref=commitlore', 'add', '-m', [
    'Ruled-out: shared Redis cache | keep note session state local',
    'Record-Id: r-approved-note597',
    'Provenance: authored',
  ].join('\n'), approvedCommit]);
  // `git notes add` itself does not offer a signing flag. Rewrite its newly
  // created notes-ref commit with the identical tree and parent, signed by the
  // approved key, so the real notes-writer attribution has a verified signer.
  const unsignedNotesHead = git(['rev-parse', 'refs/notes/commitlore']).trim();
  const notesTree = git(['rev-parse', `${unsignedNotesHead}^{tree}`]).trim();
  const parents = git(['show', '-s', '--format=%P', unsignedNotesHead])
    .trim()
    .split(' ')
    .filter((parent) => parent !== '');
  const signedNotesHead = git([
    'commit-tree',
    `-S${approvedFingerprint}`,
    notesTree,
    ...parents.flatMap((parent) => ['-p', parent]),
    '-m',
    "Notes added by 'git notes add'",
  ]).trim();
  git(['update-ref', 'refs/notes/commitlore', signedNotesHead, unsignedNotesHead]);
}, 30_000);

afterAll(() => {
  if (originalGpgHome === undefined) delete process.env.GNUPGHOME;
  else process.env.GNUPGHOME = originalGpgHome;
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

describe('#597 signer authority with real Git signatures', () => {
  it('Git verifies both throwaway keys before grading them', () => {
    const output = git(['log', '--format=%H%x00%G?%x00%GF', '-3']);
    expect(output).toContain(`G\0${approvedFingerprint}`);
    expect(output).toContain(`G\0${unapprovedFingerprint}`);
  });

  it('grades a valid signature by an unapproved key as claim', () => {
    const grades = recordsById();
    expect(grades.get('r-unapproved597')).toBe('claim');
  });

  it('grades a forged trusted author header signed by an unapproved key as claim', () => {
    const grades = recordsById();
    expect(grades.get('r-forged597')).toBe('claim');
  });

  it('grades an approved signer directive on both commit and notes records', () => {
    const grades = recordsById();
    expect(grades.get('r-approved597')).toBe('directive');
    expect(grades.get('r-approved-note597')).toBe('directive');
  });

  it('serves the approved commit at the same grade on every core record route', () => {
    const query = runQuery({ cwd: repo, noIndex: true, ...signedPolicy() });
    expect(query.records.find((record) => record.recordId === 'r-approved597')?.trust).toBe('directive');

    const injection = buildInjection({
      cwd: repo,
      path: 'approved.ts',
      at: new Date('2100-01-01T00:00:00Z'),
      noIndex: true,
      ...signedPolicy(),
    });
    expect(injection.text).toMatch(/\[directive\]\s+r-approved597/);

    const guarded = guard({
      cwd: repo,
      paths: ['approved.ts'],
      proposal: PROPOSAL,
      ...signedPolicy(),
    });
    expect(guarded.matches.find((match) => match.recordId === 'r-approved597')?.trust).toBe('directive');

    const before = beforeChange({
      cwd: repo,
      path: 'approved.ts',
      proposal: PROPOSAL,
      at: new Date(),
      ...signedPolicy(),
    });
    expect(before.active_decisions.find((record) => record.recordId === 'r-approved597')?.trust).toBe('directive');
    expect(before.possible_revival_matches.find((match) => match.recordId === 'r-approved597')?.trust).toBe('directive');

    writeFileSync(join(repo, 'approved.ts'), 'export const approved = true;\n');
    git(['add', 'approved.ts']);
    const advisory = prepareCaptureContext({
      cwd: repo,
      transcript: `We ruled out ${PROPOSAL}.`,
      ...signedPolicy(),
    }).guard_advisory;
    expect(advisory?.matches.find((match) => match.recordId === 'r-approved597')?.trust).toBe('directive');
  });
});
