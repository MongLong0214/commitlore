import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const WRITER = 'scripts/write-canonical-artifact-manifest.mjs';
const VERIFIER = 'scripts/verify-canonical-artifact.mjs';
const CANONICAL_COMMAND = 'docker run --rm --platform linux/amd64 -v "$PWD":/w -w /w node:24-bookworm sh -c "npm ci && npm run build"';

let copy = '';

const run = (script: string, ...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { cwd: copy, encoding: 'utf8' });

const runWithEnv = (script: string, env: NodeJS.ProcessEnv, ...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { cwd: copy, encoding: 'utf8', env: { ...process.env, ...env } });

beforeAll(() => {
  copy = mkdtempSync(join(tmpdir(), 'commitlore-canonical-artifact-'));
  for (const path of ['dist', 'src', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json']) {
    cpSync(join(ROOT, path), join(copy, path), { recursive: true });
  }
});

afterAll(() => rmSync(copy, { recursive: true, force: true }));

describe('canonical artifact contract', () => {
  it('records and verifies the complete dist tree while naming only the runtime bundle', () => {
    expect(run(WRITER).status).toBe(0);
    const manifest = JSON.parse(readFileSync(join(copy, 'installer', 'canonical-artifact.json'), 'utf8'));
    expect(manifest.builder.command).toBe(CANONICAL_COMMAND);
    expect(manifest.runtimeAssets).toEqual(['dist/commitlore.mjs']);
    expect(manifest.artifact.files.length).toBeGreaterThanOrEqual(250);
    expect(run(VERIFIER).status).toBe(0);
  });

  it('rejects a non-canonical byte with the exact canonical build command, then passes after restoration', () => {
    const bundle = join(copy, 'dist', 'commitlore.mjs');
    const original = readFileSync(bundle);
    writeFileSync(bundle, Buffer.concat([original, Buffer.from('\n// non-canonical test byte\n')]));

    const rejected = run(VERIFIER);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('canonical artifact verification failed');
    expect(rejected.stderr).toContain(CANONICAL_COMMAND);

    writeFileSync(bundle, original);
    expect(run(VERIFIER).status).toBe(0);
  });
});

describe('canonical artifact CI and release provenance', () => {
  // T-1503. CI rebuilds before it verifies, so on a pull request that changes
  // `src/` and nothing else all three checksum comparisons fail together and
  // `git diff` is never reached -- which is how #720 failed, and why removing
  // the diff line alone would not have moved it.
  describe('--contract-only, the mode a source-only pull request is checked in', () => {
    it('passes when source moved and the committed bundle did not', () => {
      expect(run(WRITER).status).toBe(0);
      const source = join(copy, 'src', 'cli.ts');
      const original = readFileSync(source);
      writeFileSync(source, `${original.toString()}\n// a source-only change\n`);
      try {
        expect(run(VERIFIER).status, 'the strict mode is supposed to reject this').toBe(1);
        const relaxed = run(VERIFIER, '--contract-only');
        expect(relaxed.status, relaxed.stderr).toBe(0);
        // A reader scanning a log for the strict line must not find it here.
        expect(relaxed.stdout).toContain('checksums not compared');
        expect(relaxed.stdout).not.toContain('canonical artifact verified');
      } finally {
        writeFileSync(source, original);
      }
    });

    it('still refuses a manifest whose declared contract was edited', () => {
      // The platform, image, build command and input lists do not move when
      // source moves, so a pull request has no honest reason to touch them.
      // Without this the relaxed mode would be a way to land a manifest that
      // names a different builder.
      expect(run(WRITER).status).toBe(0);
      const path = join(copy, 'installer', 'canonical-artifact.json');
      const original = readFileSync(path, 'utf8');
      const edited = JSON.parse(original);
      edited.builder.platform = 'linux/arm64';
      writeFileSync(path, JSON.stringify(edited, null, 2));
      // Source moves too, so the two modes have to disagree about something.
      // Editing only the manifest leaves strict and relaxed reporting the same
      // line, and a test both modes pass cannot tell which one ran.
      const source = join(copy, 'src', 'cli.ts');
      const sourceOriginal = readFileSync(source);
      writeFileSync(source, `${sourceOriginal.toString()}\n// a source-only change\n`);
      try {
        const result = run(VERIFIER, '--contract-only');
        expect(result.status, 'a tampered contract passed the relaxed mode').toBe(1);
        expect(result.stderr).toContain('manifest does not declare linux/amd64');
        expect(
          result.stderr,
          'the relaxed mode reported a checksum it is supposed to skip, so strict ran instead',
        ).not.toContain('source checksum does not match this checkout');
      } finally {
        writeFileSync(path, original);
        writeFileSync(source, sourceOriginal);
      }
    });

    it('refuses to be combined with a release, where the checksums are the reason', () => {
      expect(run(WRITER).status).toBe(0);
      const result = runWithEnv(VERIFIER, { RELEASE_COMMIT: 'a'.repeat(40) }, '--contract-only');
      expect(result.status, 'the weaker mode was reachable from the release path').toBe(2);
      expect(result.stderr).toContain('cannot be combined with RELEASE_COMMIT');
    });
  });

  it('builds and compares the canonical artifact twice in CI', () => {
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('Canonical dist is reproducible and matches its manifest');
    expect(ci.match(/npm run build:canonical/g)).toHaveLength(2);
    expect(ci).toContain('cmp "$first" "$second"');
    expect(ci).toContain('npm run artifact:verify');
    expect(ci).toContain('test "$(find "$ship/dist" -type f | wc -l | tr -d \' \')" = 1');
  });

  it('requires release publication to carry the canonical digest for its qualified source SHA', () => {
    const release = load(readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8')) as {
      jobs: Record<string, { needs?: string | string[]; outputs?: Record<string, string>; steps?: Array<{ run?: string }> }>;
    };
    const artifact = release.jobs['canonical-artifact'];
    const publish = release.jobs.publish;
    expect(artifact.needs).toBe('release-target');
    expect(artifact.outputs).toMatchObject({ source_sha: '${{ steps.provenance.outputs.source_sha }}', artifact_sha256: '${{ steps.provenance.outputs.artifact_sha256 }}' });
    expect(publish.needs).toContain('canonical-artifact');
    const publishRuns = publish.steps?.map((step) => step.run ?? '').join('\n') ?? '';
    expect(publishRuns).toContain('CANONICAL_SOURCE_SHA');
    expect(publishRuns).toContain('CANONICAL_ARTIFACT_SHA256');
    expect(publishRuns).toContain('Canonical dist/commitlore.mjs SHA-256');
  });
});
