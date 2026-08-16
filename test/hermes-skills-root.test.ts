/**
 * #686: the skills root comes from `--data-root`, not from where the bundle sits.
 *
 * `installedPath` resolves against the running bundle. That is right when the
 * bundle is the installed one and wrong the moment it is not — running a
 * checkout's `dist/` while pointing `--data-root` at the real installation wrote
 * the checkout's path into a permanent config.
 *
 * The failure that produces is not a missing file today. It is a config bound to
 * a tree that will be deleted or switched, after which the skills vanish while
 * `mcp_servers` stays valid: the half-configured state #684 was about, reached
 * through a different door.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { runHermesInstall } from '../src/commands/hermes.js';
import { runtimeIdentity } from '../src/core/runtime-identity.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const scratchDir = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `cl-skills-${label}-`));
  scratch.push(dir);
  return dir;
};

/** A data root holding this version's skills, the way a real install leaves it. */
const installedDataRoot = (): { dataRoot: string; skills: string } => {
  const dataRoot = scratchDir('data');
  const skills = join(dataRoot, `v${runtimeIdentity().version}`, 'hermes', 'skills');
  mkdirSync(skills, { recursive: true });
  writeFileSync(join(skills, 'commitlore-query.md'), '# skill\n', 'utf8');
  return { dataRoot, skills };
};

const hermesProfile = (): string => {
  const home = scratchDir('hermes');
  mkdirSync(join(home, '.hermes'), { recursive: true });
  return join(home, '.hermes', 'config.yaml');
};

describe('#686 where hermes install points the skills directory', () => {
  it('writes the versioned directory under --data-root, not the running bundle', () => {
    const { dataRoot, skills } = installedDataRoot();
    const configPath = hermesProfile();

    const result = runHermesInstall({
      configPath,
      dataRoot,
      detected: true,
      wrapperPath: '/usr/local/bin/commitlore',
    });

    expect(result.exitCode, result.report.join(' | ')).toBe(0);

    const written = readFileSync(configPath, 'utf8');
    expect(written, 'the data root this install was told about').toContain(skills);
    // The specific failure: a path under the checkout that produced the bundle.
    expect(written, 'never a path derived from where the bundle happens to sit').not.toContain(
      join(process.cwd(), 'hermes', 'skills'),
    );
  });

  // The fallback has to keep working: an installation invoking its own bundle is
  // the case `installedPath` was always correct for, and most runs are that.
  it('falls back to the running installation when the data root has no skills', () => {
    const dataRoot = scratchDir('empty');
    const configPath = hermesProfile();
    const skills = scratchDir('explicit');
    writeFileSync(join(skills, 'commitlore-query.md'), '# skill\n', 'utf8');

    const result = runHermesInstall({
      configPath,
      dataRoot,
      skillsDir: skills,
      detected: true,
      wrapperPath: '/usr/local/bin/commitlore',
    });

    expect(result.exitCode, result.report.join(' | ')).toBe(0);
    expect(readFileSync(configPath, 'utf8'), 'an explicit --skills-dir still wins').toContain(skills);
  });
});
