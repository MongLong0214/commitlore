#!/usr/bin/env node
/**
 * The runner half of the PR lint action: everything that happens before a
 * comment is posted.
 *
 * Two exit codes, and the difference matters:
 *
 *   0  the lint ran. Whether it found violations is an output, not an exit
 *      code, because the comment step runs after this one and a PR that fails
 *      the lint is exactly the PR that needs the comment.
 *   2  the lint could not run against what it was asked to check — a shallow
 *      clone, a base ref that is not in the checkout, notes that were left on
 *      the remote. Every one of these would otherwise produce a green check
 *      over less history than the caller thinks was read (ADR-0003: the
 *      records live in git, so a partial clone is a partial answer).
 *
 * There is no code path here that reaches the network on its own. It spawns
 * git and the commitlore CLI; the only GitHub API call in this action is the
 * comment upsert, which the workflow makes through actions/github-script.
 *
 * Inputs arrive as environment variables because a composite action does not
 * put its `inputs` in the environment for you; `action.yml` sets them.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildComment, MAX_COMMENT_CHARS } from './comment.mjs';

/** The mirror `commitlore context` reads besides the commit messages (ADR-0004). */
const NOTES_REF = 'refs/notes/commitlore';

/**
 * A PR that renames a directory can change thousands of paths, and every one
 * of them is another argument to a single git walk. The cap is reported in the
 * comment rather than applied quietly.
 */
const MAX_PATHS = 300;

/** git's own limit on `ls-remote`, so a hung network cannot hang the check. */
const LS_REMOTE_TIMEOUT_MS = 30_000;

const BLOCKED = 2;

const WORKSPACE = process.env.COMMITLORE_WORKSPACE || process.cwd();

const CLI_PATH = (process.env.COMMITLORE_CLI ?? '').trim();

// Required, because there is no fallback: see the note on the runner below.
if (CLI_PATH === '') {
  console.error(
    'commitlore: cli-path is required. Point it at a built dist/commitlore.mjs — ' +
      'for example, check this repository out at a tag and pass that path. ' +
      'There is no published npm package to fall back to.',
  );
  process.exit(1);
}

const firstLine = (text) => (text ?? '').trim().split('\n')[0] ?? '';

/** Workflow-command payloads are one line; newlines have to be escaped. */
const annotation = (text) =>
  String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const warn = (message) => {
  process.stdout.write(`::warning title=CommitLore lint::${annotation(message)}\n`);
};

/**
 * Refuses to report on a checkout that cannot answer the question. The hints
 * are the fix, spelled out — a check that fails without saying which line of
 * the caller's workflow to change gets disabled instead of fixed.
 */
const die = (message, ...hints) => {
  process.stdout.write(`::error title=CommitLore lint::${annotation(message)}\n`);
  process.stderr.write(`ERROR: ${message}\n`);
  for (const hint of hints) if (hint) process.stderr.write(`  ${hint}\n`);
  process.exit(BLOCKED);
};

const git = (args, options = {}) =>
  spawnSync('git', args, {
    cwd: WORKSPACE,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });

const gitOrDie = (args, what) => {
  const result = git(args);
  if (result.status !== 0) die(`${what}: ${firstLine(result.stderr) || `git exited ${result.status}`}`);
  return result.stdout;
};

/**
 * Runs the CLI the caller pointed at.
 *
 * There is no fallback, and there was never a working one. The removed branch
 * ran `npx --yes commitlore`, but this package is `"private": true` and has
 * never been published (ADR-0011: distribution is a git clone, not a registry),
 * so `commitlore` on npm is an **unclaimed name**. The fallback could not
 * succeed legitimately and could succeed for whoever registered it first --
 * inside a workflow holding the caller's token and a checked-out workspace
 * whose `.git/config` carries an authorization header.
 *
 * `cli-path` is required now. An action that cannot find its CLI must say so,
 * not reach for a name on a public registry.
 */
const runCommitlore = (args) =>
  spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd: WORKSPACE,
        encoding: 'utf8',
        shell: false,
        maxBuffer: 64 * 1024 * 1024,
      });

const requireWorkTree = () => {
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    die(
      'not a git work tree — the lint reads the records out of git itself',
      '→ run actions/checkout before this action',
    );
  }
};

const requireFullClone = () => {
  const shallow = git(['rev-parse', '--is-shallow-repository']);
  if (shallow.status !== 0) {
    die(
      `cannot tell whether this checkout is shallow: ${firstLine(shallow.stderr)}`,
      '→ this action needs git 2.15 or newer',
    );
  }
  if (shallow.stdout.trim() !== 'false') {
    die(
      'shallow clone — the base of this pull request is not in this checkout',
      '→ actions/checkout@v4 with `fetch-depth: 0`',
      'Linting what a shallow clone happens to contain would report a green check',
      'over fewer commits than the pull request contains.',
    );
  }
};

const resolveRef = (ref) => {
  const result = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  return result.status === 0 ? result.stdout.trim() : null;
};

/**
 * The base of the comparison. `origin/<base>` first: in a workflow checkout the
 * remote-tracking ref is the branch as it exists on the server, and a local
 * branch of the same name — if one is even present — is whatever the checkout
 * left behind.
 */
const resolveBase = (baseRef) => {
  const candidates = baseRef.startsWith('origin/') ? [baseRef] : [`origin/${baseRef}`, baseRef];
  for (const candidate of candidates) {
    if (resolveRef(candidate) !== null) return candidate;
  }
  die(
    `cannot resolve the base ref ${JSON.stringify(baseRef)} in this checkout`,
    `→ tried ${candidates.join(', ')}`,
    '→ actions/checkout@v4 with `fetch-depth: 0` brings every branch with it',
  );
};

/**
 * git notes are not part of a default clone or of what actions/checkout asks
 * for, and a record that lives only in the mirror is invisible without them —
 * which is precisely the shape `squash-preserve` writes. So: if the remote has
 * the mirror and this checkout does not, stop. Saying "no active constraints"
 * because the ref was never asked for is the failure this check exists for.
 *
 * A remote that has no mirror is not a problem, and a remote that cannot be
 * reached is not a verdict — that one is reported and the run continues.
 */
const requireNotesWhenRemoteHasThem = () => {
  if (resolveRef(NOTES_REF) !== null) return 'present';

  const remote = git(['ls-remote', '--exit-code', 'origin', NOTES_REF], {
    timeout: LS_REMOTE_TIMEOUT_MS,
  });

  // `--exit-code` reports 2 for "no ref matched", which is the ordinary case
  // for a repository that has never written a note.
  if (remote.status === 2) return 'absent from both';
  if (remote.status !== 0) {
    warn(`could not check origin for ${NOTES_REF}: ${firstLine(remote.stderr) || 'no output'}`);
    return 'unknown';
  }

  die(
    `origin carries ${NOTES_REF} and this checkout does not — records in the mirror would be missed`,
    '→ add a step after checkout:',
    `     git fetch --no-tags origin '+${NOTES_REF}:${NOTES_REF}'`,
  );
};

const changedPaths = (base, head) => {
  const out = gitOrDie(
    ['diff', '--name-only', '-z', '--end-of-options', `${base}...${head}`, '--'],
    'cannot list the paths this pull request changes',
  );
  return out.split('\0').filter((path) => path.length > 0);
};

const countCommits = (base, head) => {
  const out = gitOrDie(
    ['rev-list', '--count', '--end-of-options', `${base}..${head}`, '--'],
    'cannot count the commits in this range',
  );
  return Number(out.trim()) || 0;
};

/**
 * `validate` exits 1 for violations and 2 for a bad invocation, so only 2 is a
 * failure of this action (SPEC §6).
 */
const validateRange = (base, head) => {
  const result = runCommitlore(['validate', '--range', `${base}..${head}`, '--json']);
  if (result.status !== 0 && result.status !== 1) {
    die(
      `commitlore validate could not run (exit ${result.status})`,
      firstLine(result.stderr),
      CLI_PATH === '' ? '→ check that the commitlore package is installable here' : `→ cli-path: ${CLI_PATH}`,
    );
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return { violations: parsed.violations ?? [], secrets: parsed.secrets ?? [] };
  } catch {
    return die('commitlore validate did not emit JSON', result.stdout.slice(0, 200));
  }
};

/**
 * The constraint summary is informational (PRD F6): a query that fails says so
 * in the comment and does not fail the check. It is never dropped silently —
 * "no constraints" and "could not read the constraints" are different answers.
 */
const readContext = (paths) => {
  if (paths.length === 0) return { context: null, error: null };

  const result = runCommitlore(['context', '--json', '--', ...paths]);
  if (result.status !== 0) {
    const error = firstLine(result.stderr) || `commitlore context exited ${result.status}`;
    warn(`active constraints not read: ${error}`);
    return { context: null, error };
  }
  try {
    return { context: JSON.parse(result.stdout), error: null };
  } catch {
    warn('commitlore context did not emit JSON');
    return { context: null, error: 'commitlore context did not emit JSON' };
  }
};

const setOutput = (key, value) => {
  const file = process.env.GITHUB_OUTPUT;
  const line = `${key}=${String(value).replace(/\r?\n/g, ' ')}\n`;
  if (file) appendFileSync(file, line);
  process.stdout.write(`  ${line}`);
};

const writeSummary = (body) => {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, `${body.split('\n').filter((line) => !line.startsWith('<!--')).join('\n')}\n`);
};

const main = () => {
  const baseInput = (process.env.COMMITLORE_BASE_REF ?? '').trim();
  if (baseInput === '') {
    die(
      'no base ref to compare against',
      '→ base-ref defaults to github.base_ref, which is only set on pull_request events',
    );
  }

  requireWorkTree();
  requireFullClone();
  const notes = requireNotesWhenRemoteHasThem();

  const base = resolveBase(baseInput);
  const headInput = (process.env.COMMITLORE_HEAD_REF ?? '').trim();
  const head = headInput === '' ? 'HEAD' : headInput;
  if (resolveRef(head) === null) {
    die(
      `cannot resolve the head ref ${JSON.stringify(head)} in this checkout`,
      '→ actions/checkout@v4 with `fetch-depth: 0`',
    );
  }

  process.stdout.write(`commitlore lint: ${base}..${head} (${NOTES_REF} ${notes})\n`);

  const commits = countCommits(base, head);
  const { violations, secrets } = validateRange(base, head);
  const allChanged = changedPaths(base, head);
  const queried = allChanged.slice(0, MAX_PATHS);
  const { context, error } = readContext(queried);

  const maxChars = Number(process.env.COMMITLORE_MAX_COMMENT_CHARS) || MAX_COMMENT_CHARS;
  const { body, truncated, omitted } = buildComment({
    baseRef: base,
    headRef: head,
    commits,
    violations,
    secrets,
    changedPaths: queried,
    changedTotal: allChanged.length,
    context,
    contextError: error,
    maxChars,
  });

  const bodyFile = join(process.env.RUNNER_TEMP || tmpdir(), 'commitlore-lint-comment.md');
  writeFileSync(bodyFile, body, 'utf8');
  writeSummary(body);

  setOutput('violations', violations.length);
  setOutput('secrets', secrets.length);
  setOutput('records', context?.counts?.records ?? 0);
  setOutput('changed-paths', allChanged.length);
  setOutput('body-file', bodyFile);
  setOutput('truncated', truncated ? 'true' : 'false');

  if (truncated) warn(`the comment was truncated — ${omitted} line(s) omitted`);
};

main();
