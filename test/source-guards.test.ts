/**
 * T-201 acceptance criterion: trailer boundaries are decided by git, never by
 * this codebase. `git log --grep` matches commit *text*, so a `--grep`-based
 * lookup re-implements the line matching SPEC §2.1 B3 exists to forbid.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readSourceFiles } from './fixtures.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sources = readSourceFiles();

describe('source guards', () => {
  it('reads the source tree', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it('contains no --grep anywhere under src/', () => {
    const offenders = sources
      .filter(([, contents]) => contents.includes('--grep'))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('parses trailers by delegating to git interpret-trailers', () => {
    const trailersSource = sources.find(([path]) => path === 'core/trailers.ts');
    expect(trailersSource).toBeDefined();
    expect(trailersSource?.[1]).toContain('interpret-trailers');
  });

  it('spawns git without a shell', () => {
    const gitSource = sources.find(([path]) => path === 'core/git.ts');
    expect(gitSource?.[1]).toContain('shell: false');
    expect(gitSource?.[1]).not.toMatch(/shell:\s*true/);
  });
});

/**
 * #395: an orphaned `scripts/commitlore-bootstrap.sh` ran
 * `npm install "commitlore@$VERSION"` against a name npm returns 404 for.
 * Nothing referenced it, which was the whole of its safety — but the plugin is
 * distributed as a git clone (ADR-0011), so the file was on disk, executable,
 * in every checkout. A stale doc or a curious user turns an unclaimed registry
 * name into arbitrary code.
 *
 * Deleting it fixes today. This is what stops it coming back: ADR-0026 keeps
 * ADR-0011's registry-free distribution intact, so nothing this repository
 * ships should install from a public registry at all.
 *
 * Scoped to what the project executes, and deliberately not to prose:
 * `docs/` and `README*` describe `npm` in ADRs and comparisons, and a
 * documentation guard would fire on those.
 */
describe('#395 nothing this repository ships installs from a public registry', () => {
  const shipped = (): { path: string; body: string }[] => {
    const out: { path: string; body: string }[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          walk(rel);
        } else if (/\.(sh|ps1|mjs|js|ts)$/.test(entry.name)) {
          out.push({ path: rel, body: readFileSync(join(REPO_ROOT, rel), 'utf8') });
        }
      }
    };
    for (const root of ['scripts', 'hooks', 'src']) {
      if (existsSync(join(REPO_ROOT, root))) walk(root);
    }
    return out;
  };

  it('finds files to check, so the rule is not vacuous', () => {
    expect(shipped().length).toBeGreaterThan(5);
  });

  /**
   * The hazard is fetching a *named* package from a public registry. A bare
   * `npm install` resolves this project's own declared dependencies from its
   * lockfile and fetches nothing by name — `doctor` prints exactly that as the
   * remedy for an unbuilt checkout, and a rule that fired on it would be
   * telling the truth about the wrong thing. So the rule is: a package
   * argument, not the verb.
   */
  const registryFetches = (body: string): boolean => {
    // Continuations first. The script that prompted this rule put `npm install`
    // and its package argument on different physical lines, joined by a
    // trailing backslash — a line-at-a-time scan walks straight past it, which
    // a test below pins so the gap cannot reopen.
    const joined = body.replace(/\\\n\s*/g, ' ');
    for (const raw of joined.split('\n')) {
      const line = raw.trim();
      // `name@version` anywhere on an install line is unambiguous.
      if (/\bnpm\s+(?:install|i)\b/.test(line) && /[a-z][\w.-]*@[\w^~*.$-]/.test(line)) return true;
      // `npx <name>` runs a package fetched by name unless it is a flag.
      if (/\bnpx\s+(?:--yes\s+|-y\s+)?[a-z@][\w@./-]*/.test(line)) return true;
      // `npm install <name>` without a version: a bare token after the verb
      // that is neither a flag, a shell operator, nor a path.
      const m = /\bnpm\s+(?:install|i)\s+(.*)$/.exec(line);
      if (m) {
        const rest = m[1].split(/\s+/).filter((t) => t !== '' && !t.startsWith('-'));
        const first = rest[0];
        if (first !== undefined && /^["']?[a-z@][\w@./-]*["']?$/.test(first)) return true;
      }
    }
    return false;
  };

  it('the rule separates a package fetch from installing declared dependencies', () => {
    expect(registryFetches('npm install "commitlore@$VERSION"')).toBe(true);
    expect(registryFetches('npm install --prefix "$D" --omit=optional "commitlore@0.2.0"')).toBe(
      true,
    );
    expect(registryFetches('npx --yes commitlore init')).toBe(true);
    expect(registryFetches('npm install lodash')).toBe(true);
    // The shape the deleted script actually had: the verb and the package
    // argument on different physical lines, joined by a trailing backslash.
    expect(
      registryFetches(
        'npm install --prefix "$D" --no-audit \\\n  --omit=optional "commitlore@$VERSION" >log 2>&1',
      ),
    ).toBe(true);
    // Not fetches:
    expect(registryFetches('npm install && npm run build')).toBe(false);
    expect(registryFetches('npm ci')).toBe(false);
    expect(registryFetches('npm run build')).toBe(false);
  });

  it('no shipped script fetches a package from a public registry', () => {
    const offenders = shipped()
      .filter(({ body }) => registryFetches(body))
      .map(({ path }) => path);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the bootstrap script that prompted this rule is gone', () => {
    expect(existsSync(join(REPO_ROOT, 'scripts/commitlore-bootstrap.sh'))).toBe(false);
  });
});
