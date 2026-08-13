/**
 * #303: a user-facing message must not send someone after a package the product
 * does not carry.
 *
 * `index --help` documented exit 2 as "conflicting flags, or better-sqlite3 is
 * not installed". ADR-0012 replaced `better-sqlite3` with `node:sqlite`
 * specifically so there is no native dependency, and `package.json` declares no
 * runtime dependencies at all — so that message named a package that is not part
 * of the product and never will be. The one place a failing user is sent has to
 * be somewhere real.
 *
 * Comments that explain *why* a dependency was dropped are legitimate and are
 * deliberately not covered: this asserts strings that reach a user, which are the
 * ones with a cost attached.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const declared = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.devDependencies ?? {}),
]);

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
};

/** Lines that end up in front of a user: help text, stderr, thrown messages. */
const userFacingLines = (body: string): string[] =>
  body
    .split('\n')
    .filter((line) => {
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return false;
      return /Exit codes:|addHelpText|stderr\.write|new Error\(|\.description\(/.test(code);
    });

describe('#303 user-facing text names only packages the manifest carries', () => {
  it('no help text, error or diagnostic names an undeclared package', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(REPO_ROOT, 'src'))) {
      const body = readFileSync(file, 'utf8');
      for (const line of userFacingLines(body)) {
        // Any bare package-looking token this project once used but no longer declares.
        for (const suspect of ['better-sqlite3', 'node-gyp', 'prebuild-install']) {
          if (line.includes(suspect) && !declared.has(suspect)) {
            offenders.push(`${file.replace(REPO_ROOT + '/', '')}: ${line.trim().slice(0, 100)}`);
          }
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('better-sqlite3 is genuinely not a declared dependency, so the rule has teeth', () => {
    expect(declared.has('better-sqlite3')).toBe(false);
    // Not "no dependencies at all" -- #606 moved the packages the bundle
    // actually imports into `dependencies` so the production audit examines
    // them. The rule this test protects is narrower: the specific package this
    // project once used and removed must not quietly come back.
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain('better-sqlite3');
  });
});

/**
 * #359: the same failure mode, one step further in. `--diff` was documented as
 * defaulting to empty. It once did, and that was the defect: prepare hashes
 * `git diff --cached`, an empty diff never matched it, and every record came
 * back `source-mismatch`. Line 97 was rewritten to default to the staged diff;
 * the help string it contradicts was left behind.
 *
 * Nothing caught it because nothing read the string. A caller does, and
 * concludes they must pass `--diff` for verification to see anything — the
 * opposite of the truth.
 */
describe('#359 capture --diff documents the default it actually has', () => {
  const captureSource = readFileSync(join(REPO_ROOT, 'src/commands/capture.ts'), 'utf8');
  const diffOption = captureSource
    .split('\n')
    .find((line) => line.includes(".option('--diff <path>'"));

  it('the option line exists to be checked', () => {
    expect(diffOption).toBeDefined();
  });

  it('does not tell the caller the default is empty', () => {
    expect(diffOption).not.toMatch(/defaults? to empty/i);
  });

  it('names the staged diff, which is what omitting the flag uses', () => {
    expect(diffOption).toMatch(/staged/i);
  });

  // Teeth: the sentence above is only worth asserting while the code still
  // behaves that way. If the default ever moves off the staged diff, this fails
  // and the help text has to be re-decided rather than quietly drifting again.
  it('omitting --diff genuinely reads the staged diff', () => {
    expect(captureSource).toContain("execGitOrThrow(['diff', '--cached']");
  });
});
