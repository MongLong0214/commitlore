/**
 * CDEB-02 acceptance (#445, PRD §6): two materializations of one frozen bundle
 * are provably the same repository, the notes mirror survives the trip, and
 * the prohibited control constructions of §6.3 cannot pass the digest gate.
 *
 * The mutation case is the one that matters most. `bench/workspace.ts` can
 * build a history with its trailer blocks stripped (`seedRecords: false`) —
 * exactly the OFF-arm construction §6.3 forbids — so the test constructs that
 * shape independently and proves the same-history gate names the divergence
 * rather than merely failing.
 */

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  createRepositoryBundle,
  identityOfMaterialization,
  materializeBundle,
  sameHistoryMismatches,
} from '../bench/cdeb/freeze/repository-bundle.ts';
import { gitOrThrow } from '../bench/git.ts';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const temp = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `cdeb-mat-${label}-`));
  scratch.push(dir);
  return dir;
};

const RECORD_TRAILERS = [
  'Limit: the v1 runtime has no network egress outside the app subnet',
  'Ruled-out: shared Redis cache | ops refuses another stateful dependency',
  'Record-Id: r-cdeb01',
  'Provenance: authored',
].join('\n');

/**
 * A source repository shaped like a CDEB corpus repository: two commits, one
 * carrying a record in its trailers, plus a record in the notes mirror.
 * `stripTrailers` builds the §6.3 forbidden variant of the same content.
 */
const sourceRepo = (label: string, stripTrailers = false): string => {
  const dir = createTestRepo({ path: temp(label) });
  gitOrThrow(dir, ['config', 'user.email', 'corpus@example.invalid']);
  gitOrThrow(dir, ['config', 'user.name', 'corpus']);

  writeFileSync(join(dir, 'pricing.ts'), 'export const price = 1;\n');
  gitOrThrow(dir, ['add', '-A']);
  const body = stripTrailers
    ? 'feat: cache sessions in process'
    : `feat: cache sessions in process\n\n${RECORD_TRAILERS}`;
  gitOrThrow(dir, ['commit', '--quiet', '-m', body]);

  writeFileSync(join(dir, 'pricing.ts'), 'export const price = 2;\n');
  gitOrThrow(dir, ['add', '-A']);
  gitOrThrow(dir, ['commit', '--quiet', '-m', 'chore: bump the price']);

  gitOrThrow(dir, [
    'notes',
    '--ref=commitlore',
    'add',
    '-m',
    'Warn: session entries must stay under 4KB\nRecord-Id: r-cdeb02\nProvenance: authored',
    'HEAD',
  ]);
  return dir;
};

describe('#445 the frozen repository materializer', () => {
  it('proves two materializations of one bundle are the same repository', () => {
    const source = sourceRepo('same');
    const bundle = join(temp('same-bundle'), 'repo.bundle');
    const identity = createRepositoryBundle('repo-a', source, bundle);

    expect(identity.bundle_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.snapshot_commit).toMatch(/^[0-9a-f]{40}$/);

    const on = materializeBundle(identity, bundle, join(temp('same-on'), 'wt'));
    const off = materializeBundle(identity, bundle, join(temp('same-off'), 'wt'));

    // The §6.2 gate: every identity field equal, or the arms are not one
    // experiment. This is the proof, not an assertion.
    expect(sameHistoryMismatches(on, off)).toEqual([]);
    expect(on.head).toBe(identity.snapshot_commit);
  });

  it('carries the notes mirror through the bundle', () => {
    const source = sourceRepo('notes');
    const bundle = join(temp('notes-bundle'), 'repo.bundle');
    const identity = createRepositoryBundle('repo-a', source, bundle);
    const target = join(temp('notes-on'), 'wt');
    materializeBundle(identity, bundle, target);

    // The record is readable in the materialization — a mirror that did not
    // survive would make every notes-sourced record silently absent, which is
    // an OFF arm by accident.
    const note = gitOrThrow(target, ['notes', '--ref=commitlore', 'show', identity.snapshot_commit]);
    expect(note).toContain('r-cdeb02');
    const message = gitOrThrow(target, ['log', '--format=%B', '-1', `${identity.snapshot_commit}~1`]);
    expect(message).toContain('r-cdeb01');
  });

  /**
   * The sealed-corpus property (PRD §5). `--all` was the obvious way to build
   * the bundle and would have packed every branch in the source — including,
   * for CDEB-P, the branch holding its own prompts and oracles. An agent in the
   * materialization could then have read the answers with `git show`.
   */
  it('carries only the snapshot and the notes mirror — no other branch is reachable', () => {
    const source = sourceRepo('sealed');
    // A second branch holding something the study would want sealed.
    gitOrThrow(source, ['checkout', '--quiet', '-b', 'sealed-answers']);
    writeFileSync(join(source, 'answers.txt'), 'the rejected approach is the shared cache\n');
    gitOrThrow(source, ['add', '-A']);
    gitOrThrow(source, ['commit', '--quiet', '-m', 'chore: answers']);
    const snapshot = gitOrThrow(source, ['rev-parse', 'HEAD~1']).trim();
    gitOrThrow(source, ['checkout', '--quiet', '-']);

    const bundle = join(temp('sealed-bundle'), 'repo.bundle');
    const identity = createRepositoryBundle('repo-a', source, bundle, snapshot);
    const target = join(temp('sealed-wt'), 'wt');
    materializeBundle(identity, bundle, target);

    expect(identity.snapshot_commit).toBe(snapshot);
    // The branch is not a ref, and its blob is not reachable by any means.
    const refs = gitOrThrow(target, ['for-each-ref', '--format=%(refname)']);
    expect(refs).not.toContain('sealed-answers');
    const objects = gitOrThrow(target, ['rev-list', '--all', '--objects']);
    expect(objects).not.toContain('answers.txt');
    // And the notes mirror still made the trip.
    expect(gitOrThrow(target, ['notes', '--ref=commitlore', 'show', snapshot])).toContain('r-cdeb02');
  });

  it('refuses a bundle whose bytes do not match the freeze', () => {
    const source = sourceRepo('tamper');
    const bundle = join(temp('tamper-bundle'), 'repo.bundle');
    const identity = createRepositoryBundle('repo-a', source, bundle);

    const bytes = readFileSync(bundle);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    writeFileSync(bundle, bytes);

    expect(() => materializeBundle(identity, bundle, join(temp('tamper-wt'), 'wt'))).toThrow(
      /bundle digest .* does not match the frozen/,
    );
  });

  it('refuses a missing bundle rather than materializing nothing', () => {
    const source = sourceRepo('missing');
    const bundle = join(temp('missing-bundle'), 'repo.bundle');
    const identity = createRepositoryBundle('repo-a', source, bundle);
    rmSync(bundle);

    expect(() => materializeBundle(identity, bundle, join(temp('missing-wt'), 'wt'))).toThrow(
      /bundle .* is missing/,
    );
  });

  /**
   * The §6.3 mutation: the same content with its trailer block stripped — what
   * `bench/workspace.ts` builds for the M-series OFF arm — must not be able to
   * stand in for the real history. The gate names the divergence.
   */
  it('a trailer-stripped history cannot pass the same-history gate', () => {
    const real = sourceRepo('real');
    const stripped = sourceRepo('stripped', true);

    const realBundle = join(temp('real-bundle'), 'repo.bundle');
    const strippedBundle = join(temp('stripped-bundle'), 'repo.bundle');
    const realIdentity = createRepositoryBundle('repo-a', real, realBundle);
    const strippedIdentity = createRepositoryBundle('repo-a', stripped, strippedBundle);

    const realMat = materializeBundle(realIdentity, realBundle, join(temp('real-wt'), 'wt'));
    const strippedMat = materializeBundle(
      strippedIdentity,
      strippedBundle,
      join(temp('stripped-wt'), 'wt'),
    );

    const mismatches = sameHistoryMismatches(realMat, strippedMat);
    expect(mismatches).not.toEqual([]);
    // Stripping trailers rewrites every descendant sha, but the message digest
    // is the field that names the *kind* of divergence.
    expect(mismatches).toContain('commit_message_digest');
  });
});
