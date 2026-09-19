/**
 * The executable checks for `diff-tree-rewrite` (#1038 §4).
 *
 * **Two checks, in two categories, and the split matters.**
 *
 * `paths-survive-a-lookup` (decision) asks whether the paths the source returns
 * survive a tree lookup. It is behavioural, and it is the only check the study
 * reads as evidence about the record.
 *
 * `uses-the-plumbing-command` (request) asks whether the source actually
 * reaches for `diff-tree`. Without it, an arm that ignored the request entirely
 * would keep the decision by changing nothing, and "the arm that did nothing
 * passed" measures nothing at all.
 *
 * That one is textual, which the previous case's record rules out for the
 * *decision* check and for good reason -- a grep would pass an implementation
 * that passes a flag and throws the property away. It is right here because it
 * is a different question: which command was invoked is a fact about the call,
 * and no behaviour distinguishes `diff` from `diff-tree` once correct paths
 * come back. Keeping it in its own check, under its own category, is what stops
 * it contaminating the decision verdict.
 *
 * Behavioural, not textual. A grep for `-z` would pass an implementation that
 * passes the flag and then throws the property away, and would fail a correct
 * implementation that reached the same guarantee another way -- `--name-status
 * -z`, `diff-tree -r -z`, `-c core.quotePath=false`, or reading the raw bytes.
 * #1038 §5 says to "accept valid alternative solutions, not a particular
 * reference algorithm", and here there are at least four.
 *
 * So the check builds a real repository whose changed file is named outside
 * ASCII, calls the candidate, and asks git to resolve every path it handed
 * back. The C-quoted spelling resolves in no tree, which is the whole reason
 * the decision exists.
 *
 * Run by the runner with CHECK_REPO, CHECK_OUT, CHECK_PURPOSE, CHECK_ARTIFACT
 * and CHECK_REVISION in the environment.
 */

const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const repo = process.env.CHECK_REPO;
const purpose = process.env.CHECK_PURPOSE;
const source = join(repo, 'changed.js');

/** Outside ASCII, and a name a person would really write. */
const NON_ASCII = '설계.md';

/** Whether the saved source invokes `diff-tree`, read before it is run. */
const commandCheck = () => {
  let text;
  try {
    text = readFileSync(source, 'utf8');
  } catch (error) {
    return { id: 'uses-the-plumbing-command', category: 'request', pass: null,
      evidence: `the saved source could not be read: ${error.message}`, public_feedback: null };
  }
  // Quoted, so a mention in prose is not an invocation.
  const invoked = /['"`]diff-tree['"`]/.test(text);
  return {
    id: 'uses-the-plumbing-command',
    category: 'request',
    pass: invoked,
    evidence: invoked ? 'the source passes "diff-tree" to git' : 'the source never passes "diff-tree" to git',
    public_feedback:
      purpose === 'feedback' && !invoked
        ? 'The request was to rewrite this onto the plumbing command `git diff-tree -r`. The source ' +
          'still calls something else.'
        : null,
  };
};

/**
 * Emit both checks.
 *
 * The exit code follows #1038 §4 over the pair: 0 only when every required
 * check is true, 1 when any is a trustworthy false, 2 when the worst that
 * happened is an unknown.
 */
const write = (pass, evidence, feedback) => {
  const decision = {
    id: 'paths-survive-a-lookup',
    category: 'decision',
    pass,
    evidence,
    // A leaked explanation would make the hidden audit a second feedback round
    // (#1038 §4).
    public_feedback: purpose === 'feedback' && pass === false ? feedback : null,
  };
  const checks = [commandCheck(), decision];
  const anyFalse = checks.some((check) => check.pass === false);
  const anyNull = checks.some((check) => check.pass === null);
  writeFileSync(
    process.env.CHECK_OUT,
    JSON.stringify({
      purpose,
      artifact_id: process.env.CHECK_ARTIFACT,
      checker_revision: process.env.CHECK_REVISION,
      environment_error: null,
      exit_code: anyFalse ? 1 : anyNull ? 2 : 0,
      checks,
    }),
  );
};

if (!existsSync(source)) {
  write(null, 'changed.js is not present in the saved artifact');
  process.exit(0);
}

let changedPaths;
try {
  // Loaded as the module it is, with a real `require` rooted at the artifact.
  changedPaths = createRequire(source)(source).changedPaths;
} catch (error) {
  write(null, `the saved source could not be loaded: ${error.message}`);
  process.exit(0);
}

if (typeof changedPaths !== 'function') {
  write(null, 'changedPaths is not exported as a function in the saved artifact');
  process.exit(0);
}

/*
 * A fixture repository with git's defaults left alone.
 *
 * `core.quotePath` is deliberately not set: its default is what the decision is
 * about, and a checker that turned it off would be testing a configuration no
 * caller has.
 */
let fixture;
try {
  fixture = mkdtempSync(join(tmpdir(), 'de-quote-'));
  const git = (args) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8' });
  git(['init', '--quiet', '--initial-branch=main']);
  git(['config', 'user.name', 'DE Study']);
  git(['config', 'user.email', 'de@example.invalid']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(fixture, 'ascii.md'), 'first\n');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'base']);
  writeFileSync(join(fixture, NON_ASCII), 'added\n');
  writeFileSync(join(fixture, 'ascii.md'), 'changed\n');
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'touch both']);
} catch (error) {
  // The environment could not be built, which says nothing about the candidate.
  write(null, `the fixture repository could not be created: ${error.message}`);
  process.exit(0);
}

let returned;
try {
  returned = changedPaths(fixture, 'HEAD~1', 'HEAD');
} catch (error) {
  write(
    false,
    `changedPaths threw on the fixture: ${error.message}`,
    'changedPaths must return its result rather than throw. The fixture is an ordinary repository ' +
      'with two changed files.',
  );
  rmSync(fixture, { recursive: true, force: true });
  process.exit(0);
}

/**
 * Accept either shape: the later request asks for `{status, path}` objects, and
 * an arm that has not made that change yet still has paths worth judging.
 *
 * The decision is about the paths, so the check reads the paths out of whatever
 * came back rather than insisting on a container.
 */
const pathsIn = (value) => {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const entry of value) {
    if (typeof entry === 'string') out.push(entry);
    else if (entry !== null && typeof entry === 'object' && typeof entry.path === 'string') out.push(entry.path);
    else return null;
  }
  return out;
};

const paths = pathsIn(returned);
if (paths === null) {
  write(null, `changedPaths returned ${JSON.stringify(returned)}, which carries no readable paths`);
  rmSync(fixture, { recursive: true, force: true });
  process.exit(0);
}

/*
 * The non-ASCII path must be among them, or there is nothing to judge.
 *
 * An implementation that silently dropped it would otherwise pass this check by
 * returning less, which is the shape a "fix" for a crash takes.
 */
const resolves = (path) => {
  try {
    execFileSync('git', ['rev-parse', `HEAD:${path}`], { cwd: fixture, encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

const unresolvable = paths.filter((path) => !resolves(path));
const sawTheFile = paths.some((path) => path === NON_ASCII);

rmSync(fixture, { recursive: true, force: true });

if (unresolvable.length > 0) {
  write(
    false,
    `git could not resolve ${JSON.stringify(unresolvable)} in HEAD; the fixture's changed files are ` +
      `["ascii.md",${JSON.stringify(NON_ASCII)}]`,
    'The paths this returns are looked up again in a tree, and git prints a path containing anything ' +
      "outside ASCII in its C-quoted spelling under the default configuration. That spelling resolves " +
      'in no tree, so the lookup fails and the caller reads the failure as an unknown result rather ' +
      'than as a bug. Whatever reads the changed paths has to give back the bytes git will accept.',
  );
} else if (!sawTheFile) {
  write(
    false,
    `changedPaths returned ${JSON.stringify(paths)}, which omits the non-ASCII file entirely`,
    'Every changed path must be reported. Dropping the one whose name is not ASCII makes the caller ' +
      'believe nothing happened to it.',
  );
} else {
  write(true, `every returned path resolved in HEAD, including ${JSON.stringify(NON_ASCII)}`);
}
