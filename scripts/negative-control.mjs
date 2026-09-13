#!/usr/bin/env node
/**
 * Revert each implementation hunk a commit made, and report the ones no test
 * noticed (#961).
 *
 * Twice in one day a suite was green on code that was broken. A cap made a
 * resumable scan converge in zero calls instead of four and all nine of its
 * tests passed, because their injected clock never took the path the cap broke.
 * Two other regression tests asserted the right property against SQL written in
 * the test rather than against the implementation, so reverting the fix they
 * guarded changed nothing. Both were found by reverting the fix by hand.
 *
 * This does that mechanically for one commit: for every hunk it made under
 * `src/`, put the old lines back, run the test files the commit added or
 * changed, and see whether anything goes red. A hunk nothing notices is a
 * change with no test behind it — which is a finding, not necessarily a defect:
 * a comment, a message, a rename and a refactor all land here honestly.
 *
 * It is deliberately not a CI gate. A gate on this would be answered by writing
 * tests that fail for any mutation, which is not the same as tests that check
 * the property. Run it when you are about to write `Verified:` and want to know
 * whether the sentence is true.
 *
 * Usage:
 *   node scripts/negative-control.mjs                 # HEAD
 *   node scripts/negative-control.mjs <commit>
 *   node scripts/negative-control.mjs <commit> --tests test/a.test.ts,test/b.test.ts
 *
 * What it will not do: run against a dirty tree. Every hunk is applied and
 * reversed in the working tree, so an uncommitted change of yours would be
 * indistinguishable from the mutation and could be lost.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

const argv = process.argv.slice(2);
const commit = argv.find((a) => !a.startsWith('--')) ?? 'HEAD';
const testsFlag = argv.indexOf('--tests');
const explicitTests =
  testsFlag === -1 ? null : (argv[testsFlag + 1] ?? '').split(',').filter((s) => s !== '');

const dirty = git(['status', '--porcelain']).trim();
if (dirty !== '') {
  process.stderr.write(
    'negative-control: the working tree has changes. This applies and reverses patches in it,\n' +
      'so an uncommitted change cannot be told apart from the mutation. Commit or stash first.\n',
  );
  process.exit(2);
}

const sha = git(['rev-parse', commit]).trim();
const subject = git(['log', '-1', '--format=%s', sha]).trim();

const changed = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha])
  .split('\n')
  .filter((p) => p !== '');

const implementation = changed.filter((p) => p.startsWith('src/'));
const tests = explicitTests ?? changed.filter((p) => /^test\/.*\.test\.ts$/.test(p));

if (implementation.length === 0) {
  process.stdout.write(`${sha.slice(0, 12)} ${subject}\n  no src/ changes — nothing to mutate\n`);
  process.exit(0);
}
if (tests.length === 0) {
  process.stdout.write(
    `${sha.slice(0, 12)} ${subject}\n` +
      `  ${String(implementation.length)} implementation file(s) changed and no test file was added or\n` +
      '  changed. Every hunk below is unguarded by construction; pass --tests to name the\n' +
      '  suites that should have caught it.\n',
  );
  process.exit(1);
}

/**
 * The commit's diff split into one patch per hunk.
 *
 * Per hunk rather than per file, because a commit that fixes one thing and
 * tidies another would otherwise report the pair as guarded when only the fix
 * is. `-U0` so a hunk is the changed lines and nothing else; adjacent hunks
 * then stay separable.
 */
const hunkPatches = () => {
  const patch = git(['diff', '-U0', `${sha}^`, sha, '--', ...implementation]);
  const out = [];
  let header = null;
  let current = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current !== null) out.push(current);
      current = null;
      header = [line];
      continue;
    }
    if (header !== null && current === null && !line.startsWith('@@')) {
      header.push(line);
      continue;
    }
    if (line.startsWith('@@')) {
      if (current !== null) out.push(current);
      current = { header: [...(header ?? [])], hunk: [line], label: line };
      continue;
    }
    if (current !== null) current.hunk.push(line);
  }
  if (current !== null) out.push(current);
  return out.map((entry) => ({
    label: `${entry.header[0]?.replace('diff --git a/', '').split(' ')[0] ?? '?'} ${entry.label}`,
    text: `${[...entry.header, ...entry.hunk].join('\n')}\n`,
  }));
};

const scratch = mkdtempSync(join(tmpdir(), 'commitlore-negctl-'));
const runTests = () => {
  const result = spawnSync('npx', ['vitest', 'run', ...tests], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    env: { ...process.env, CI: '1' },
  });
  return result.status === 0;
};

/**
 * Does any named test read the built bundle?
 *
 * It matters because a source-only mutation leaves such a test running the
 * unmutated `dist/`, and a control that measures nothing is worse than none.
 * Matched on the word rather than on `dist/`, because these files reach it as
 * `join(HERE, '..', 'dist', 'commitlore.mjs')` as often as as a path literal.
 * `git grep` exits 1 for "no match", which is an answer and not a failure.
 */
const needsBuild = (() => {
  const found = spawnSync('git', ['grep', '-l', '-e', 'dist', '--', ...tests], { encoding: 'utf8' });
  return found.status === 0 && found.stdout.trim() !== '';
})();
/**
 * Returns false when the mutated source does not build.
 *
 * This is not a detail. A failed build leaves the *previous* bundle on disk, so
 * a test that spawns `dist/commitlore.mjs` runs unmutated code and passes --
 * and the hunk is reported as unguarded when nothing was ever tested. The first
 * run of this script did exactly that, on a reversed import line, and called it
 * a finding.
 */
const build = () => {
  if (!needsBuild) return true;
  return spawnSync('npm', ['run', 'build'], { encoding: 'utf8', stdio: 'ignore' }).status === 0;
};

process.stdout.write(`${sha.slice(0, 12)} ${subject}\n`);
process.stdout.write(`  tests: ${tests.join(' ')}\n`);
if (needsBuild) process.stdout.write('  (a test reads dist/, so each mutation is rebuilt)\n');

// The control is only meaningful if the tests pass unmutated. A suite that is
// already red reports every hunk as guarded, for the wrong reason.
build();
if (!runTests()) {
  process.stderr.write(
    '\nnegative-control: the named tests do not pass on the unmutated commit, so every\n' +
      'mutation below would look guarded. Fix that first.\n',
  );
  rmSync(scratch, { recursive: true, force: true });
  process.exit(2);
}

const unguarded = [];
const patches = hunkPatches();
for (const [at, patch] of patches.entries()) {
  const file = join(scratch, `h-${String(at)}.patch`);
  writeFileSync(file, patch.text);
  let applied = false;
  try {
    git(['apply', '--reverse', '--unidiff-zero', file]);
    applied = true;
  } catch {
    process.stdout.write(`  ?  ${patch.label} — could not be reversed in isolation, skipped\n`);
    continue;
  }
  try {
    if (!build()) {
      // The mutation does not compile, which is its own kind of guarded: no
      // build means no bundle, and nothing downstream could have run it.
      process.stdout.write(`  guarded    ${patch.label} (the mutation does not build)\n`);
      continue;
    }
    const green = runTests();
    process.stdout.write(`  ${green ? 'UNGUARDED' : 'guarded  '}  ${patch.label}\n`);
    if (green) unguarded.push(patch.label);
  } finally {
    if (applied) git(['apply', '--unidiff-zero', file]);
  }
}
build();
rmSync(scratch, { recursive: true, force: true });

if (unguarded.length === 0) {
  process.stdout.write(`\nevery one of ${String(patches.length)} hunk(s) is noticed by a named test.\n`);
  process.exit(0);
}
process.stdout.write(
  `\n${String(unguarded.length)} of ${String(patches.length)} hunk(s) changed nothing any named test could see.\n` +
    'That is a finding to explain, not a verdict: a comment, a message, a rename or a\n' +
    'refactor belongs here. A behaviour change does not.\n',
);
process.exit(1);
