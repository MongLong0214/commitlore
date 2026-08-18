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

const run = (script: string) => spawnSync(process.execPath, [script], { cwd: copy, encoding: 'utf8' });

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
