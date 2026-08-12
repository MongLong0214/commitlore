/**
 * #499. The four prerequisite jobs proved things about a commit, and nothing
 * proved the tag still pointed at it when the release was created.
 *
 * Each boundary resolved the tag *name* independently — the ancestry gate, the
 * CI gate, the fresh-clone install gate and `gh release create` each asked the
 * remote what the tag meant at the moment they ran. A ref move between any two
 * of them produced gates that qualified one commit and a release that shipped
 * another, with every check green.
 *
 * These cases move and delete the tag at each boundary. A workflow that binds
 * one canonical sha refuses all of them; the workflow that resolved the name
 * repeatedly could not have noticed.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { afterAll, describe, expect, it } from 'vitest';

import { REQUIRED_CHECKS } from '../scripts/check-exact-head-ci.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const TAG_BINDING = join(REPO_ROOT, 'scripts', 'check-tag-binding.mjs');
const RELEASE_TARGET = join(REPO_ROOT, 'scripts', 'check-release-target.mjs');
const EXACT_HEAD_CI = join(REPO_ROOT, 'scripts', 'check-exact-head-ci.mjs');
const RELEASE_WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'release.yml');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

const TAG = 'v9.9.9';
const REF = `refs/tags/${TAG}`;

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (label: string): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `commitlore-binding-${label}-`));
  scratch.push(dir);
  return dir;
};

const git = (cwd: string, args: string[]): string => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout;
};

const commit = (repo: string, message: string): string => {
  writeFileSync(join(repo, 'file.txt'), message);
  git(repo, ['add', 'file.txt']);
  git(repo, [
    '-c',
    'user.name=Release gate',
    '-c',
    'user.email=release-gate@example.invalid',
    'commit',
    '--quiet',
    '-m',
    message,
  ]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
};

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const run = (script: string, args: string[], cwd = REPO_ROOT): RunResult => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', shell: false });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

/**
 * An upstream with two commits on main and a tag on the first. `clone` is a
 * consumer of that remote, so `ls-remote` from it observes the live ref the
 * way the publish step does rather than a snapshot taken earlier.
 */
const upstream = (label: string, annotated: boolean): { clone: string; first: string; second: string } => {
  const origin = join(tempDir(label), 'origin');
  git(tempDir(`${label}-mk`), ['init', '--quiet', '--bare', '--initial-branch=main', origin]);

  const work = join(tempDir(`${label}-work`), 'work');
  git(tempDir(`${label}-clonedir`), ['clone', '--quiet', origin, work]);
  git(work, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  const first = commit(work, 'first');
  const second = commit(work, 'second');
  git(work, ['push', '--quiet', 'origin', 'main']);

  if (annotated) {
    git(work, [
      '-c',
      'user.name=Release gate',
      '-c',
      'user.email=release-gate@example.invalid',
      'tag',
      '-a',
      TAG,
      '-m',
      'release',
      first,
    ]);
  } else {
    git(work, ['tag', TAG, first]);
  }
  git(work, ['push', '--quiet', 'origin', REF]);

  return { clone: work, first, second };
};

const moveTag = (work: string, to: string, annotated: boolean): void => {
  git(work, ['tag', '-d', TAG]);
  if (annotated) {
    git(work, [
      '-c',
      'user.name=Release gate',
      '-c',
      'user.email=release-gate@example.invalid',
      'tag',
      '-a',
      TAG,
      '-m',
      'moved',
      to,
    ]);
  } else {
    git(work, ['tag', TAG, to]);
  }
  git(work, ['push', '--quiet', '--force', 'origin', REF]);
};

describe('#499 the published tag is the commit the gates qualified', () => {
  it('accepts a tag that still resolves to the qualified commit', () => {
    const { clone, first } = upstream('accept', false);

    const result = run(TAG_BINDING, [TAG, first], clone);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('tag binding accepted');
  });

  it('accepts an annotated tag by its commit rather than its tag object', () => {
    const { clone, first } = upstream('annotated', true);

    // The tag object sha is what a naive comparison would reach for; refusing
    // on it would reject every annotated release for the wrong reason.
    const tagObject = git(clone, ['rev-parse', REF]).trim();
    expect(tagObject).not.toBe(first);

    const result = run(TAG_BINDING, [TAG, first], clone);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('(annotated)');
  });

  it('refuses when the tag moved to another commit after qualification', () => {
    const { clone, first, second } = upstream('moved', false);
    moveTag(clone, second, false);

    const result = run(TAG_BINDING, [TAG, first], clone);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`now resolves to ${second}`);
    expect(result.stderr).toContain('Refusing to publish a commit nothing checked');
  });

  it('refuses a moved annotated tag, where the peeled commit is what changed', () => {
    const { clone, first, second } = upstream('moved-annotated', true);
    moveTag(clone, second, true);

    const result = run(TAG_BINDING, [TAG, first], clone);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`now resolves to ${second}`);
  });

  it('refuses a same-name tag on another main commit even when CI passed on the original', () => {
    // Every upstream gate is genuinely satisfied for the original commit here:
    // both commits are main descendants, and the six required check runs exist
    // at `first` and concluded success. The CI gate passes on exactly the
    // evidence a release would present. None of that is about the commit the
    // tag now names, which is the split this ticket exists to close — so the
    // case has to run those gates rather than assert their premises.
    const { clone, first, second } = upstream('same-name', false);

    expect(run(RELEASE_TARGET, [first, 'main'], clone).status).toBe(0);
    expect(run(RELEASE_TARGET, [second, 'main'], clone).status).toBe(0);

    const green = join(tempDir('same-name-ci'), 'check-runs.json');
    writeFileSync(
      green,
      JSON.stringify({
        total_count: REQUIRED_CHECKS.length,
        check_runs: REQUIRED_CHECKS.map((name) => ({
          name,
          status: 'completed',
          conclusion: 'success',
          head_sha: first,
          // The gate requires the producing app, not just the name (#571).
          app: { slug: 'github-actions' },
        })),
      }),
    );
    const ci = run(EXACT_HEAD_CI, ['owner', 'repo', first, '--from-file', green], clone);
    expect(ci.status).toBe(0);
    expect(ci.stdout).toContain('all 6 required checks succeeded');

    moveTag(clone, second, false);

    // The ancestry gate and the CI gate both still hold for `first`; only the
    // binding check can see that the tag no longer names it.
    expect(run(RELEASE_TARGET, [first, 'main'], clone).status).toBe(0);
    expect(run(EXACT_HEAD_CI, ['owner', 'repo', first, '--from-file', green], clone).status).toBe(0);

    const result = run(TAG_BINDING, [TAG, first], clone);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`now resolves to ${second}`);
  });

  // Paired with the workflow-shape case asserting the resolver is handed
  // `$GITHUB_SHA`: this one shows the script answers for the commit it is
  // given, not for whatever the tag names now. Neither half claims the other's
  // property, and only together do they close the window.
  it('answers for the commit it is handed, not the one the tag now names', () => {
    // The window this closes: a move landing between the push and the first
    // job. Resolving the tag name here would hand every downstream gate the
    // attacker's commit and they would all agree, greenly, on the wrong one.
    const { clone, first, second } = upstream('pre-resolver', false);
    moveTag(clone, second, false);

    // The workflow passes GITHUB_SHA — the commit the tag pointed at when the
    // push happened — so the resolver still answers the original commit even
    // though the live tag now names another.
    const resolved = run(RELEASE_TARGET, [first, 'main'], clone);
    expect(resolved.status).toBe(0);
    expect(resolved.stdout).toContain(first);
    expect(resolved.stdout).not.toContain(second);

    // And publication refuses, because the live tag no longer agrees with the
    // commit every gate qualified. The release is withheld rather than
    // silently retargeted.
    const publication = run(TAG_BINDING, [TAG, first], clone);
    expect(publication.status).toBe(1);
    expect(publication.stderr).toContain(`now resolves to ${second}`);
  });

  it('refuses when the tag was deleted between qualification and publication', () => {
    const { clone, first } = upstream('deleted', false);
    git(clone, ['push', '--quiet', '--delete', 'origin', REF]);

    const result = run(TAG_BINDING, [TAG, first], clone);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not exist');
  });

  it('refuses a missing tag rather than treating an empty listing as nothing wrong', () => {
    const result = run(TAG_BINDING, [TAG, '0'.repeat(40), '--from-stdin'], REPO_ROOT);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('publication never creates it');
  });

  it('refuses an abbreviated expected sha rather than comparing prefixes', () => {
    const result = run(TAG_BINDING, [TAG, 'abc1234', '--from-stdin'], REPO_ROOT);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not a full 40-character sha');
  });

  describe('ambiguous or partial listings are refused rather than resolved', () => {
    const listing = (contents: string): string => {
      const dir = tempDir('listing');
      const file = join(dir, 'ls-remote.txt');
      writeFileSync(file, contents);
      return file;
    };

    const SHA_A = 'a'.repeat(40);
    const SHA_B = 'b'.repeat(40);

    it('refuses --from-file together with --from-stdin', () => {
      const file = listing(`${SHA_A}\t${REF}\n`);

      const result = run(TAG_BINDING, [TAG, SHA_A, '--from-file', file, '--from-stdin'], REPO_ROOT);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('mutually exclusive');
    });

    it('refuses a positional remote combined with a seam', () => {
      const file = listing(`${SHA_A}\t${REF}\n`);

      const result = run(TAG_BINDING, [TAG, SHA_A, 'origin', '--from-file', file], REPO_ROOT);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('cannot be combined');
    });

    it('refuses a repeated --from-file rather than keeping the last path', () => {
      const first = listing(`${SHA_A}\t${REF}\n`);
      const second = listing(`${SHA_B}\t${REF}\n`);

      const result = run(TAG_BINDING, [TAG, SHA_A, '--from-file', first, '--from-file', second], REPO_ROOT);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('given more than once');
    });

    it('refuses a repeated --from-stdin', () => {
      const result = run(TAG_BINDING, [TAG, SHA_A, '--from-stdin', '--from-stdin'], REPO_ROOT);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('given more than once');
    });

    it('refuses two rows for the same ref instead of taking the first', () => {
      const file = listing(`${SHA_A}\t${REF}\n${SHA_B}\t${REF}\n`);

      const result = run(TAG_BINDING, [TAG, SHA_A, '--from-file', file], REPO_ROOT);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('more than once');
    });

    it('refuses two peeled rows even when one of them matches', () => {
      const file = listing(`${SHA_A}\t${REF}\n${SHA_B}\t${REF}^{}\n${SHA_A}\t${REF}^{}\n`);

      const result = run(TAG_BINDING, [TAG, SHA_A, '--from-file', file], REPO_ROOT);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('more than once');
    });

    it('refuses a peeled row with no tag-object row', () => {
      const file = listing(`${SHA_A}\t${REF}^{}\n`);

      const result = run(TAG_BINDING, [TAG, SHA_A, '--from-file', file], REPO_ROOT);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('cannot exist without its tag object');
    });

    it('refuses a line carrying more than one sha and ref', () => {
      // `split(/\s+/, 2)` discarded everything past the first pair, so a line
      // saying two contradictory things was read as the first and accepted.
      const file = listing(`${SHA_A}\t${REF} ${SHA_B}\t${REF}\n`);

      const result = run(TAG_BINDING, [TAG, SHA_A, '--from-file', file], REPO_ROOT);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('more than one sha and ref');
    });

    it('refuses a listing carrying refs that were never requested', () => {
      const file = listing(`${SHA_A}\t${REF}\n${SHA_B}\trefs/tags/v0.0.1\n`);

      const result = run(TAG_BINDING, [TAG, SHA_A, '--from-file', file], REPO_ROOT);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('refs this check did not ask for');
    });

    it('still accepts the one shape git actually produces for an annotated tag', () => {
      const file = listing(`${SHA_B}\t${REF}\n${SHA_A}\t${REF}^{}\n`);

      const result = run(TAG_BINDING, [TAG, SHA_A, '--from-file', file], REPO_ROOT);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('(annotated)');
    });
  });

  it('refuses an unparseable listing instead of reading it as absent', () => {
    const payload = tempDir('malformed');
    const file = join(payload, 'ls-remote.txt');
    writeFileSync(file, 'not-a-sha refs/tags/v9.9.9\n');

    const result = run(TAG_BINDING, [TAG, '0'.repeat(40), '--from-file', file], REPO_ROOT);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('could not parse');
  });
});

describe('#499 every release boundary consumes one canonical sha', () => {
  const workflow = load(readFileSync(RELEASE_WORKFLOW, 'utf8')) as {
    jobs: Record<string, { needs?: string | string[]; outputs?: Record<string, string>; steps: unknown[]; env?: Record<string, string> }>;
  };

  const CANONICAL = '${{ needs.release-target.outputs.commit }}';

  const needsOf = (job: string): string[] => {
    const declared = workflow.jobs[job]?.needs;
    if (declared === undefined) return [];
    return Array.isArray(declared) ? declared : [declared];
  };

  const checkoutRefs = (job: string): unknown[] =>
    (workflow.jobs[job]?.steps as { uses?: string; with?: { ref?: unknown } }[])
      .filter((step) => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout'))
      .map((step) => step.with?.ref);

  it('resolves the canonical commit exactly once, in the job that owns it', () => {
    const raw = readFileSync(RELEASE_WORKFLOW, 'utf8');
    const resolutions = raw.split('\n').filter((line) => line.includes('check-release-target.mjs'));

    expect(resolutions).toHaveLength(1);
    expect(workflow.jobs['release-target']?.outputs?.['commit']).toBe('${{ steps.ancestry.outputs.sha }}');
  });

  // Anchoring on the live tag would leave a window before this job starts in
  // which a move redefines the release, and every gate downstream would then
  // agree on the wrong commit. The event sha is what the tag pointed at when
  // the push happened and cannot be edited afterwards.
  it('anchors the resolver on the immutable event sha, not the live tag', () => {
    const raw = readFileSync(RELEASE_WORKFLOW, 'utf8');
    const resolution = raw.split('\n').find((line) => line.includes('check-release-target.mjs'));

    expect(resolution).toContain('"$GITHUB_SHA"');
    expect(resolution).not.toContain('GITHUB_REF_NAME');
    expect(checkoutRefs('release-target')).toEqual(['${{ github.sha }}']);
  });

  // The weaker assertion this replaces only checked that `publish.needs` named
  // four jobs. Four jobs that each resolve the tag themselves satisfy that and
  // still publish an unqualified commit, which is how the defect shipped.
  it.each(['version-consistency', 'exact-head-ci', 'install-gate', 'publish'])(
    'checks %s out at the canonical sha, never at the tag ref',
    (job) => {
      expect(needsOf(job)).toContain('release-target');
      const refs = checkoutRefs(job);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(ref).toBe(CANONICAL);
    },
  );

  it('gives the CI gate the canonical sha rather than the event sha', () => {
    const raw = readFileSync(RELEASE_WORKFLOW, 'utf8');
    const line = raw.split('\n').find((entry) => entry.includes('check-exact-head-ci.mjs'));

    expect(line).toBeDefined();
    expect(line).toContain(CANONICAL);
  });

  it('clones the install gate onto the canonical sha instead of the tag name', () => {
    const raw = readFileSync(RELEASE_WORKFLOW, 'utf8');

    expect(raw).not.toContain('git clone --quiet --branch "$GITHUB_REF_NAME"');
    expect(raw).toContain('checkout --quiet --detach "$RELEASE_COMMIT"');
    expect(workflow.jobs['install-gate']?.env?.['RELEASE_COMMIT']).toBe(CANONICAL);
  });

  // What makes the published release the qualified commit is the live-equality
  // check plus the no-bypass ruleset, with `--verify-tag` refusing to create a
  // tag that is not there. `--target` is asserted because it should be passed,
  // not because it binds anything: `gh` documents it as the target for
  // AUTOMATIC tag creation, and `--verify-tag` means none happens here.
  it('re-reads the live tag before publication and refuses to create a missing one', () => {
    const raw = readFileSync(RELEASE_WORKFLOW, 'utf8');

    expect(raw).toContain('check-tag-binding.mjs "$GITHUB_REF_NAME" "$RELEASE_COMMIT"');
    expect(raw).toContain('--verify-tag');
    expect(workflow.jobs['publish']?.env?.['RELEASE_COMMIT']).toBe(CANONICAL);
  });

  it('passes the canonical target as defence for a dropped --verify-tag, not as the binding', () => {
    const raw = readFileSync(RELEASE_WORKFLOW, 'utf8');

    expect(raw).toContain('--target "$RELEASE_COMMIT"');
  });

  // The gates run mutable `@v4` actions. A workflow-global `contents: write`
  // would give every one of them a token that can create the release, and an
  // action whose contents changed under the same reference could publish
  // before any gate finished — the ordering below would still be declared and
  // would no longer be a constraint.
  it('grants release-write to the publishing job alone', () => {
    const raw = readFileSync(RELEASE_WORKFLOW, 'utf8');
    const parsed = load(raw) as {
      permissions?: Record<string, string>;
      jobs: Record<string, { permissions?: Record<string, string> }>;
    };

    expect(parsed.permissions?.['contents']).toBe('read');

    for (const [name, job] of Object.entries(parsed.jobs)) {
      if (name === 'publish') continue;
      expect(job.permissions?.['contents'] ?? 'read').toBe('read');
    }

    expect(parsed.jobs['publish']?.permissions?.['contents']).toBe('write');
  });

  // Scoping the release-write grant removed the worst consequence of a changed
  // action; it did not stop one from running. A digest names one immutable
  // tree, so an action cannot become something else under the same reference.
  it('references every action by digest rather than a movable tag', () => {
    const unpinned: string[] = [];
    for (const file of readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith('.yml'))) {
      const raw = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
      for (const line of raw.split('\n')) {
        const match = /uses:\s*(\S+)/.exec(line);
        if (match === null) continue;
        const ref = match[1] ?? '';
        if (ref.startsWith('./')) continue;
        if (!/@[0-9a-f]{40}$/.test(ref)) unpinned.push(`${file}: ${ref}`);
      }
    }

    expect(unpinned).toEqual([]);
  });

  it('grants no privilege for an action the workflow does not contain', () => {
    const raw = readFileSync(RELEASE_WORKFLOW, 'utf8');
    const parsed = load(raw) as { permissions?: Record<string, string> };

    // `id-token` and `attestations` were granted for an attestation action that
    // is not here. Unused privilege is still available to every step present.
    expect(raw).not.toContain('attest-build-provenance');
    expect(parsed.permissions?.['id-token']).toBeUndefined();
    expect(parsed.permissions?.['attestations']).toBeUndefined();
  });

  it('orders the binding check before the release is created', () => {
    // Read the job's own steps rather than searching the file: an earlier
    // comment mentions `gh release create`, and a text search finds prose.
    const steps = workflow.jobs['publish']?.steps as { name?: string; run?: string }[];
    const binding = steps.findIndex((step) => (step.run ?? '').includes('check-tag-binding.mjs'));
    const create = steps.findIndex((step) => (step.run ?? '').includes('gh release create'));

    expect(binding).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThanOrEqual(0);
    expect(binding).toBeLessThan(create);
  });
});
