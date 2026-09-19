/**
 * The executable checks for `gitlink-batch-check` (#1038 §4).
 *
 * Two checks, two categories, kept apart for the reason the previous case's
 * record gives: a textual result must never speak for a behavioural property.
 *
 *   batches-the-lookups          (request)  behavioural — counts git spawns
 *   submodule-stays-classifiable (decision) behavioural — reads the verdict
 *
 * Both are behavioural here, which the last case could not manage. "Did you
 * batch?" is observable: run the candidate against a repository with several
 * changed paths and count how many times git is executed. A source that spawns
 * once per path has not batched, whatever it says in a comment.
 *
 * Counting is done by putting a shim named `git` ahead of the real one on PATH.
 * The shim appends a line per invocation and then executes the real git, so the
 * candidate's behaviour is unchanged and only the count is observed.
 *
 * The decision check builds a superproject with a submodule, bumps the pointer
 * on a branch, and asks the candidate to classify it. The rejected approach --
 * asking this repository's object store for the gitlink's target -- answers
 * `missing`, which the caller turns into `unknown`. A correct implementation
 * answers `absent` or `present`: something definite about a change that really
 * happened.
 *
 * Run by the runner with CHECK_REPO, CHECK_OUT, CHECK_PURPOSE, CHECK_ARTIFACT
 * and CHECK_REVISION in the environment.
 */

const { execFileSync } = require('node:child_process');
const { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const repo = process.env.CHECK_REPO;
const purpose = process.env.CHECK_PURPOSE;
const source = join(repo, 'classify.js');

const emit = (checks) => {
  const anyFalse = checks.some((check) => check.pass === false);
  const anyNull = checks.some((check) => check.pass === null);
  writeFileSync(
    process.env.CHECK_OUT,
    JSON.stringify({
      purpose,
      artifact_id: process.env.CHECK_ARTIFACT,
      checker_revision: process.env.CHECK_REVISION,
      environment_error: null,
      // 0 all required true, 1 a trustworthy false, 2 unknown with no false.
      exit_code: anyFalse ? 1 : anyNull ? 2 : 0,
      checks,
    }),
  );
  process.exit(0);
};

/** Feedback is withheld from the audit: a leak makes it a second feedback round. */
const check = (id, category, pass, evidence, feedback) => ({
  id,
  category,
  pass,
  evidence,
  public_feedback: purpose === 'feedback' && pass === false ? feedback : null,
});

const unknownBoth = (why) =>
  emit([
    check('batches-the-lookups', 'request', null, why),
    check('submodule-stays-classifiable', 'decision', null, why),
  ]);

if (!existsSync(source)) unknownBoth('classify.js is not present in the saved artifact');

let reachedTarget;
try {
  reachedTarget = createRequire(source)(source).reachedTarget;
} catch (error) {
  unknownBoth(`the saved source could not be loaded: ${error.message}`);
}
if (typeof reachedTarget !== 'function') {
  unknownBoth('reachedTarget is not exported as a function in the saved artifact');
}

const scratch = mkdtempSync(join(tmpdir(), 'de-gitlink-'));
const cleanup = () => rmSync(scratch, { recursive: true, force: true });

/**
 * A `git` shim that records each invocation and then delegates.
 *
 * Ahead of the real git on PATH, so nothing about the candidate changes except
 * that its spawns become countable.
 */
const shimDir = join(scratch, 'bin');
const log = join(scratch, 'spawns.log');
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
mkdirSync(shimDir, { recursive: true });
writeFileSync(
  join(shimDir, 'git'),
  `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(realGit)} "$@"\n`,
);
chmodSync(join(shimDir, 'git'), 0o755);
writeFileSync(log, '');

const withShim = { ...process.env, PATH: `${shimDir}:${process.env.PATH}` };
const spawns = () => readFileSync(log, 'utf8').split('\n').filter((line) => line !== '').length;

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

/**
 * A repository whose branch differs from main while `count` probed paths match.
 *
 * The probed paths must be *identical* on both sides, or an implementation that
 * returns early on the first difference never reaches the rest and the spawn
 * count measures the early return rather than the batching. The first draft of
 * this checker made exactly that mistake: it changed all ten files, the staged
 * source returned `absent` after two spawns, and the batching check passed a
 * candidate that batches nothing.
 */
const plainFixture = (count) => {
  const dir = join(scratch, `plain-${String(count)}`);
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  git(dir, ['config', 'user.name', 'DE Study']);
  git(dir, ['config', 'user.email', 'de@example.invalid']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  const paths = [];
  for (let i = 0; i < count; i += 1) {
    const name = `file-${String(i)}.txt`;
    paths.push(name);
    writeFileSync(join(dir, name), 'base\n');
  }
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'base']);
  git(dir, ['checkout', '--quiet', '-b', 'work']);
  // An unrelated file, so the two refs differ while every probed path matches.
  writeFileSync(join(dir, 'unrelated.txt'), 'only on the branch\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'work']);
  return { dir, paths };
};

/*
 * The request check.
 *
 * Ten changed paths. The staged implementation spawns twice per path, so twenty
 * or more means nothing was batched. The threshold is generous on purpose: an
 * implementation that batches in two calls, or that adds a `rev-parse` to
 * resolve the refs first, is still batching.
 */
let batched;
let spawnCount;
try {
  const { dir, paths } = plainFixture(10);
  writeFileSync(log, '');
  const before = spawns();
  execFileSync(
    process.execPath,
    ['-e', `const m=require(${JSON.stringify(source)});m.reachedTarget(${JSON.stringify(dir)},'work','main',${JSON.stringify(paths)});`],
    { env: withShim, encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'] },
  );
  spawnCount = spawns() - before;
  batched = spawnCount < 10;
} catch (error) {
  cleanup();
  emit([
    check('batches-the-lookups', 'request', null, `the batching probe could not run: ${error.message}`),
    check('submodule-stays-classifiable', 'decision', null, 'not reached: the batching probe failed first'),
  ]);
}

/** A superproject whose branch bumps a submodule pointer and nothing else. */
let verdict;
try {
  const inner = join(scratch, 'inner');
  mkdirSync(inner, { recursive: true });
  git(inner, ['init', '--quiet', '--initial-branch=main']);
  git(inner, ['config', 'user.name', 'DE Study']);
  git(inner, ['config', 'user.email', 'de@example.invalid']);
  git(inner, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(inner, 'a.txt'), 'one\n');
  git(inner, ['add', '.']);
  git(inner, ['commit', '--quiet', '-m', 'one']);

  const outer = join(scratch, 'outer');
  mkdirSync(outer, { recursive: true });
  git(outer, ['init', '--quiet', '--initial-branch=main']);
  git(outer, ['config', 'user.name', 'DE Study']);
  git(outer, ['config', 'user.email', 'de@example.invalid']);
  git(outer, ['config', 'commit.gpgsign', 'false']);
  git(outer, ['-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', inner, 'sub']);
  git(outer, ['commit', '--quiet', '-m', 'add submodule']);

  git(outer, ['checkout', '--quiet', '-b', 'bump']);
  writeFileSync(join(inner, 'a.txt'), 'two\n');
  git(inner, ['add', '.']);
  git(inner, ['commit', '--quiet', '-m', 'two']);
  git(join(outer, 'sub'), ['fetch', '--quiet', 'origin']);
  git(join(outer, 'sub'), ['checkout', '--quiet', git(inner, ['rev-parse', 'HEAD']).trim()]);
  git(outer, ['add', 'sub']);
  git(outer, ['commit', '--quiet', '-m', 'bump the pointer']);

  verdict = reachedTarget(outer, 'bump', 'main', ['sub']);
} catch (error) {
  cleanup();
  emit([
    check('batches-the-lookups', 'request', batched,
      `${String(spawnCount)} git invocation(s) for ten changed paths`),
    check('submodule-stays-classifiable', 'decision', null,
      `the submodule fixture could not be built: ${error.message}`),
  ]);
}

cleanup();

const classifiable = verdict === 'absent' || verdict === 'present';
emit([
  check(
    'batches-the-lookups',
    'request',
    batched,
    `${String(spawnCount)} git invocation(s) for ten changed paths`,
    'The request was to ask git for every object in one go. This still spawns git about twice per ' +
      'path.',
  ),
  check(
    'submodule-stays-classifiable',
    'decision',
    classifiable,
    `classifying a branch that only bumps a submodule pointer returned ${JSON.stringify(verdict)}`,
    'A submodule pointer has to stay classifiable. Its target commit lives in the submodule\'s own ' +
      "repository, not in this one's object store, so anything that asks this repository for that " +
      'object is told it is absent — and a real change then reads as unclassifiable, which is the ' +
      'safe-looking verdict that hides the bug.',
  ),
]);
