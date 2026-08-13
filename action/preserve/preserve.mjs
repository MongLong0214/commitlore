#!/usr/bin/env node
/**
 * The runner half of the squash inheritance action (T-602, ADR-0004).
 *
 * A squash merge destroys a branch's trailer blocks. What lands on the base
 * branch is one commit whose message GitHub wrote -- a bulleted list of
 * subjects, in which a `Key: value` line is prose and not a trailer (SPEC §2.1
 * B3) -- and the commits that carried the records stop being reachable from any
 * branch. `commitlore squash-preserve` (T-302) repairs that. This is the thing
 * that remembers to run it, at the one moment it can still be done, without
 * anybody having to.
 *
 * Three exit codes, and the differences are the point:
 *
 *   0  the inheritance ran, or there was nothing to inherit, or the merge was
 *      not a squash and nothing needed doing. All three are reported; none of
 *      them is silent.
 *   1  the record was attached locally and could not be published. The mirror
 *      is only a second channel if it reaches the remote (ADR-0004), so exiting
 *      0 here would put a green check over a record that exists on a runner
 *      about to be deleted.
 *   2  the checkout cannot answer the question -- a shallow clone, a ref that
 *      is not in it, notes left on the remote. Same contract as the lint
 *      action: a partial clone is a partial answer (ADR-0003).
 *
 * Nothing here reaches a host but the git remote the caller already cloned
 * from. There is no GitHub API call in this action at all -- the merge is
 * classified from the git objects, because the event payload does not say which
 * merge method was used (see `classifyMerge`).
 *
 * Inputs arrive as environment variables because a composite action does not
 * put its `inputs` in the environment for you; `action.yml` sets them.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** The mirror a squashed record survives in (SPEC §1, ADR-0004). */
const NOTES_REF = 'refs/notes/commitlore';

/** The identity a note write falls back to when the workflow configured none. */
const BOT_NAME = 'github-actions[bot]';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

/** What a clone needs before it can see anyone else's records (`core/notes.ts`). */
const NOTES_REFSPEC = `+${NOTES_REF}:${NOTES_REF}`;

/**
 * How many times the publish is retried after a rejected push.
 *
 * A rejection here means another merge published its own note between this run
 * reading the mirror and writing it -- ordinary on a busy repository, and the
 * fix is to read again. Three attempts because each one costs a fetch and a
 * push, and a repository merging faster than that in a loop has a problem this
 * action cannot solve by trying harder.
 */
const PUSH_ATTEMPTS = 3;

/** git's own limits, so a hung network cannot hang the job. */
const LS_REMOTE_TIMEOUT_MS = 30_000;
const NETWORK_TIMEOUT_MS = 120_000;

const PUSH_FAILED = 1;
const BLOCKED = 2;

/**
 * A push git refused because the remote moved, as opposed to one it refused
 * because of who is asking. Only the first is worth retrying: re-reading the
 * mirror fixes a race and does nothing at all for a missing permission, and a
 * retry loop over a 403 is three times the log for the same answer.
 *
 * `[remote rejected]` is deliberately not here. That is a server-side hook
 * declining the push, which the next attempt will decline identically.
 */
const RACE_REJECTED = /\[rejected\]|non-fast-forward|fetch first|stale info|cannot lock ref/i;

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

const TOKEN = (process.env.COMMITLORE_TOKEN ?? '').trim();

const PUSH_ENABLED = (process.env.COMMITLORE_PUSH ?? 'true').trim() !== 'false';

const SHORT_SHA = 8;

const short = (sha) => (sha.length > SHORT_SHA ? sha.slice(0, SHORT_SHA) : sha);

/**
 * A token in an error message is a token in a public build log. git does not
 * print the `AUTHORIZATION` header, but it does print URLs, and the next
 * failure mode nobody predicted is the one this is here for.
 */
const redact = (text) => {
  const rendered = String(text ?? '');
  return TOKEN === '' ? rendered : rendered.split(TOKEN).join('***');
};

const firstLine = (text) => redact(text).trim().split('\n')[0] ?? '';

/** Workflow-command payloads are one line; newlines have to be escaped. */
const annotation = (text) =>
  redact(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const warn = (message) => {
  process.stdout.write(`::warning title=CommitLore preserve::${annotation(message)}\n`);
};

const say = (message) => {
  process.stdout.write(`${redact(message)}\n`);
};

/**
 * Refuses to act on a checkout that cannot answer the question. The hints are
 * the fix, spelled out -- a check that fails without saying which line of the
 * caller's workflow to change gets disabled instead of fixed.
 */
const die = (code, message, ...hints) => {
  process.stdout.write(`::error title=CommitLore preserve::${annotation(message)}\n`);
  process.stderr.write(`ERROR: ${redact(message)}\n`);
  for (const hint of hints) if (hint) process.stderr.write(`  ${redact(hint)}\n`);
  process.exit(code);
};

const blocked = (message, ...hints) => die(BLOCKED, message, ...hints);

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
  if (result.status !== 0) {
    blocked(`${what}: ${firstLine(result.stderr) || `git exited ${result.status}`}`);
  }
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
/**
 * Writing a record to `refs/notes/commitlore` creates a commit object, and git
 * refuses to create one without an author and a committer. `actions/checkout`
 * configures neither, so on a default runner the note write failed with
 * `Author identity unknown` *after* the squash had already been detected
 * correctly — this action's entire purpose, unreachable in the configuration it
 * most often runs in.
 *
 * The identity is supplied here rather than in the product. Git's refusal to
 * invent one is correct and worth keeping: a note is a commit, and a commit
 * with a fabricated author is the kind of unattributable record this project
 * exists to argue against. What was missing is CI telling git who it is, which
 * is the integration's job, not the protocol's.
 *
 * Anything the repository already configured wins. `git config` is consulted
 * rather than the environment alone, so a workflow that set `user.name` the
 * ordinary way keeps its own identity.
 */
const hasGitConfig = (key) => {
  const result = git(['config', '--get', key]);
  return result.status === 0 && result.stdout.trim() !== '';
};

const commitIdentityEnv = () => {
  const env = { ...process.env };
  // An empty value is absence, not a choice. Git treats `GIT_COMMITTER_NAME=''`
  // as `empty ident name not allowed` and refuses, so carrying it through would
  // trade one unexplained refusal for another.
  const set = (key) => (env[key] ?? '').trim() !== '';

  if (!hasGitConfig('user.name') && !set('GIT_COMMITTER_NAME')) {
    env['GIT_AUTHOR_NAME'] = BOT_NAME;
    env['GIT_COMMITTER_NAME'] = BOT_NAME;
  }
  if (!hasGitConfig('user.email') && !set('GIT_COMMITTER_EMAIL')) {
    env['GIT_AUTHOR_EMAIL'] = BOT_EMAIL;
    env['GIT_COMMITTER_EMAIL'] = BOT_EMAIL;
  }
  return env;
};

const runCommitlore = (args, options = {}) =>
  spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: WORKSPACE,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    env: commitIdentityEnv(),
    ...options,
  });

const requireWorkTree = () => {
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    blocked(
      'not a git work tree — the records are read out of git itself',
      '→ run actions/checkout before this action',
    );
  }
};

const requireFullClone = () => {
  const shallow = git(['rev-parse', '--is-shallow-repository']);
  if (shallow.status !== 0) {
    blocked(
      `cannot tell whether this checkout is shallow: ${firstLine(shallow.stderr)}`,
      '→ this action needs git 2.15 or newer',
    );
  }
  if (shallow.stdout.trim() !== 'false') {
    blocked(
      'shallow clone — the commits the squash collapsed are not in this checkout',
      '→ actions/checkout@v4 with `fetch-depth: 0`',
      'Inheriting from whatever a shallow clone happens to contain would attach a',
      'record that claims to carry a branch it only saw part of.',
    );
  }
};

/**
 * git notes are not part of a default clone or of what actions/checkout asks
 * for. Here the missing ref is worse than it is for the lint: this action
 * *writes* the mirror, and writing it from a checkout that never read it
 * produces a notes commit with no ancestry in the remote's, which every push
 * after it has to reconcile. Stop instead, and say which line to add.
 *
 * A remote that has no mirror is not a problem -- this run may be the one that
 * creates it. A remote that cannot be reached is not a verdict either; that is
 * reported and the run continues, and the push is where it will be found out.
 */
const requireNotesWhenRemoteHasThem = () => {
  if (resolveRef(NOTES_REF) !== null) return 'present';

  const remote = git(['ls-remote', '--exit-code', 'origin', NOTES_REF], {
    timeout: LS_REMOTE_TIMEOUT_MS,
  });

  // `--exit-code` reports 2 for "no ref matched", the ordinary case for a
  // repository that has never written a note.
  if (remote.status === 2) return 'absent from both';
  if (remote.status !== 0) {
    warn(`could not check origin for ${NOTES_REF}: ${firstLine(remote.stderr) || 'no output'}`);
    return 'unknown';
  }

  blocked(
    `origin carries ${NOTES_REF} and this checkout does not — publishing from here would fork the mirror`,
    '→ add a step after checkout:',
    `     git fetch --no-tags origin '${NOTES_REFSPEC}'`,
  );
};

function resolveRef(ref) {
  const result = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * The base of the range. `origin/<base>` first, for the same reason the lint
 * action prefers it: in a workflow checkout the remote-tracking ref is the
 * branch as it exists on the server, and a local branch of the same name is
 * whatever the checkout left behind. A raw sha falls through to the second
 * candidate, since `origin/<sha>` resolves to nothing.
 *
 * That the base has already moved on -- it now carries the squash commit -- is
 * exactly right. `<base>..<head>` is "reachable from the branch, not from the
 * base", and the squash commit is not an ancestor of the branch, so the range
 * is the branch's own commits either way.
 */
const resolveBase = (baseRef) => {
  const candidates = baseRef.startsWith('origin/') ? [baseRef] : [`origin/${baseRef}`, baseRef];
  for (const candidate of candidates) {
    if (resolveRef(candidate) !== null) return candidate;
  }
  return blocked(
    `cannot resolve the base ref ${JSON.stringify(baseRef)} in this checkout`,
    `→ tried ${candidates.join(', ')}`,
    '→ actions/checkout@v4 with `fetch-depth: 0` brings every branch with it',
  );
};

const parentsOf = (sha) =>
  gitOrDie(
    ['rev-list', '--parents', '-n', '1', '--end-of-options', sha, '--'],
    `cannot read the parents of ${sha}`,
  )
    .trim()
    .split(/\s+/)
    .slice(1)
    .filter((parent) => parent.length > 0);

const isAncestor = (ancestor, descendant) =>
  git(['merge-base', '--is-ancestor', '--end-of-options', ancestor, descendant]).status === 0;

/**
 * The full messages of a set of commits, newest first. `-z` NUL-terminates
 * each one and a commit object cannot contain a NUL, so the boundary is
 * unambiguous even though a message is many lines (the same reason
 * `core/squash.ts` reads its range this way).
 */
const messagesOf = (revs, options = []) => {
  // Every option goes before `--end-of-options`; everything after it is a
  // revision by definition, which is the point of passing caller-shaped strings
  // through it at all.
  const out = gitOrDie(
    ['log', '-z', '--format=%B', ...options, '--end-of-options', ...revs, '--'],
    `cannot read the messages of ${revs.join(' ')}`,
  );
  return out.split('\0').filter((message) => message.length > 0);
};

/**
 * Which merge GitHub performed.
 *
 * **Nothing in the event payload answers this.** The `pull_request` object the
 * webhook carries is the REST pull request resource, and that resource has no
 * field for the merge method: it reports `merged`, `merged_at`,
 * `merge_commit_sha`, `commits`, `base.sha` and `head.sha`, and stops there.
 * What the REST documentation does say is how `merge_commit_sha` differs per
 * method -- "the SHA of the squashed commit on the base branch" for a squash,
 * "the commit that the base branch was updated to" for a rebase, "the SHA of
 * the merge commit" for a merge commit. So `merged == true` is the payload's
 * contribution (the caller's `if:` applies it) and the method is read off the
 * objects those shas name:
 *
 * | Shape at `merge-sha`                          | Verdict        | Inherit? |
 * |-----------------------------------------------|----------------|----------|
 * | two or more parents                           | `merge-commit` | no       |
 * | one parent, `head-ref` is an ancestor         | `fast-forward` | no       |
 * | one parent, the last N messages are the branch's | `rebase`    | no       |
 * | one parent, otherwise                         | `squash`       | yes      |
 *
 * The first three need no inheritance because the records are already
 * reachable: a merge commit keeps the branch as its second parent, a
 * fast-forward *is* the branch, and a rebase replays the commit messages
 * verbatim -- trailer blocks and all -- onto new shas. That last one is why the
 * rebase test compares messages rather than counting commits: what matters is
 * not that a rebase happened but that the messages survived it, and comparing
 * the thing that matters also gets the right answer for a local `git merge
 * --squash` finished with `git commit -C <branch>`, which keeps the message and
 * therefore needs nothing either.
 *
 * When the messages differ, the verdict is `squash` and the record is
 * inherited. That is the safe direction to be wrong in: a redundant note
 * duplicates a record the query engine already dedupes, while a missed squash
 * is the defect (D3) this whole path exists to close.
 */
const classifyMerge = (mergeSha, base, head) => {
  const parents = parentsOf(mergeSha);

  if (parents.length === 0) {
    return { kind: 'unknown', why: `${short(mergeSha)} is a root commit and merged nothing` };
  }
  if (parents.length > 1) {
    return {
      kind: 'merge-commit',
      why: `${short(mergeSha)} has ${parents.length} parents — the branch is still reachable through it`,
    };
  }
  if (isAncestor(head, mergeSha)) {
    return {
      kind: 'fast-forward',
      why: `the head commit ${short(head)} is an ancestor of ${short(mergeSha)} — its records are already in the base`,
    };
  }

  const branch = messagesOf([`${base}..${head}`]);
  if (branch.length === 0) {
    return { kind: 'squash', why: `${base}..${head} holds no commits to compare` };
  }

  const replayed = messagesOf([mergeSha], ['--first-parent', '-n', String(branch.length)]);
  const same =
    replayed.length === branch.length &&
    branch.every((message, index) => message === replayed[index]);

  return same
    ? {
        kind: 'rebase',
        why: `the ${branch.length} commit(s) ending at ${short(mergeSha)} carry the branch's messages verbatim — the trailers came with them`,
      }
    : {
        kind: 'squash',
        why: `${short(mergeSha)} has one parent and does not carry the branch's ${branch.length} message(s) — the trailer blocks were collapsed`,
      };
};

/** The mirrored record on `sha`, or null when the object carries no note. */
const readNote = (sha) => {
  const result = git(['notes', `--ref=${NOTES_REF}`, 'show', '--end-of-options', sha]);
  if (result.status === 0) return result.stdout;
  // 1 is "no note found for object"; anything else is a broken checkout.
  if (result.status === 1) return null;
  return blocked(`cannot read ${NOTES_REF} for ${short(sha)}: ${firstLine(result.stderr)}`);
};

/**
 * Environment for the one command that talks to the remote.
 *
 * In a workflow the push is already authenticated: actions/checkout writes an
 * `http.extraheader` carrying the job's token into the local config, which is
 * what makes `git push origin` work at all. `github-token` is the fallback for
 * a checkout that turned that off (`persist-credentials: false`), and it is
 * consulted *only* when the config carries no header -- a second
 * `AUTHORIZATION` header on the same remote sends both and gets a 400 instead
 * of a push.
 *
 * The header travels in `GIT_CONFIG_*` rather than `git -c`, which would put
 * the token in argv where every other process on the runner can read it, and
 * rather than `git config`, which would leave it in the checkout's config file
 * after this step returns.
 */
const remoteEnv = () => {
  if (TOKEN === '') return {};

  const existing = git(['config', '--get-all', 'http.https://github.com/.extraheader']);
  if (existing.status === 0 && existing.stdout.trim() !== '') return {};

  const origin = git(['remote', 'get-url', 'origin']).stdout.trim();
  if (!origin.startsWith('https://github.com/')) return {};

  const basic = Buffer.from(`x-access-token:${TOKEN}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
};

const pushNotes = () =>
  git(['push', 'origin', `${NOTES_REF}:${NOTES_REF}`], {
    timeout: NETWORK_TIMEOUT_MS,
    env: { ...process.env, ...remoteEnv() },
  });

/**
 * Replaces the local mirror with the remote's, discarding the note this run
 * wrote. That is the point: the note is derived from the range, not authored
 * here, so throwing it away and recomputing it on top of what the remote now
 * says is cheaper and safer than merging two notes trees -- `git notes merge`
 * would need a strategy for a same-object conflict, and the only ones on offer
 * either drop somebody's record (`ours`/`theirs`) or sort the trailer block's
 * lines (`cat_sort_uniq`), which destroys the canonical form of SPEC §2.3.
 *
 * A local-only note on some *other* object would be lost with it. On a runner
 * there is no such thing: whatever this checkout had came from the fetch the
 * caller was required to make.
 */
const refetchNotes = () =>
  git(['fetch', '--no-tags', '--force', 'origin', NOTES_REFSPEC], {
    timeout: NETWORK_TIMEOUT_MS,
    env: { ...process.env, ...remoteEnv() },
  });

/**
 * Runs `squash-preserve` for the range and attaches the result to the merge
 * commit.
 *
 * `--force` is never passed. An existing note is somebody's record, and not
 * overwriting one is this action's contract; the caller has already looked and
 * returned if it found one, so the command refusing here means a note appeared
 * in the window between that look and this write. That is reported as a
 * blocked run rather than resolved, because the only way to resolve it is the
 * `--force` this action does not use.
 */
const preserve = (range, target, carriedIds) => {
  const excluded = carriedIds.flatMap((id) => ['--exclude-record-id', id]);
  const result = runCommitlore(['squash-preserve', range, '--target', target, '--json', ...excluded]);

  if (result.status !== 0) {
    return die(
      BLOCKED,
      `commitlore squash-preserve could not run (exit ${result.status})`,
      firstLine(result.stderr),
      CLI_PATH === ''
        ? '→ check that the commitlore package is installable here'
        : `→ cli-path: ${CLI_PATH}`,
    );
  }

  // Conflicts and a lost identity are warnings the command writes to stderr and
  // never fails over (T-302). They are the caller's to surface, not to swallow.
  for (const line of result.stderr.split('\n')) {
    if (line.trim() !== '') warn(line.trim());
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return die(BLOCKED, 'commitlore squash-preserve did not emit JSON', result.stdout.slice(0, 200));
  }
};

/**
 * The merge message is the first record channel. Parse it with the product's
 * own multi-record grammar rather than treating any `Record-Id:`-shaped prose
 * as a trailer. The IDs are passed to squash-preserve before it writes a note.
 */
const carriedRecordIds = (target) => {
  const message = gitOrDie(
    ['show', '--no-patch', '--format=%B', '--end-of-options', target],
    `cannot read the merge message for ${short(target)}`,
  );
  const parsed = runCommitlore(['parse', '--json'], { input: message });
  if (parsed.status !== 0) {
    blocked(`cannot parse the merge message for ${short(target)}: ${firstLine(parsed.stderr)}`);
  }
  try {
    const answer = JSON.parse(parsed.stdout);
    const blocks = answer.blocks ?? [{ trailers: answer.trailers ?? [] }];
    return [...new Set(
      blocks.flatMap((block) =>
        (block.trailers ?? [])
          .filter((trailer) => trailer.key === 'Record-Id')
          .map((trailer) => trailer.value),
      ),
    )];
  } catch {
    blocked(`commitlore parse did not emit JSON for ${short(target)}`, parsed.stdout.slice(0, 200));
  }
};

const outputs = {};

const setOutput = (key, value) => {
  outputs[key] = String(value);
  const file = process.env.GITHUB_OUTPUT;
  const line = `${key}=${String(value).replace(/\r?\n/g, ' ')}\n`;
  if (file) appendFileSync(file, line);
  process.stdout.write(`  ${line}`);
};

const writeSummary = (lines) => {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, `${lines.join('\n')}\n`);
};

/**
 * A publish that did not happen, reported as one.
 *
 * The outputs are written before the exit so a caller that runs this with
 * `continue-on-error` can still read what happened; a failed step whose outputs
 * are all empty tells the next step nothing except that something went wrong.
 */
const failPush = (records, conflicts, lines) => {
  setOutput('action', 'push-failed');
  setOutput('merge-type', 'squash');
  setOutput('records', records);
  setOutput('conflicts', conflicts);
  setOutput('pushed', 'false');
  const [message, ...hints] = lines;
  die(PUSH_FAILED, message, ...hints);
};

/**
 * Attach and publish, re-reading the mirror before each attempt.
 *
 * The loop is a read-modify-write with optimistic concurrency, and every branch
 * of it reports. `already-inherited` is not a failure and not a no-op silently
 * called success: another run (or this one, re-run on the same merge) got there
 * first, and saying so is the whole difference between an idempotent action and
 * one that quietly did nothing.
 */
const inherit = (range, mergeSha) => {
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt += 1) {
    const existing = readNote(mergeSha);
    if (existing !== null) {
      const lines = existing.split('\n').filter((line) => line.trim() !== '').length;
      say(
        `${short(mergeSha)} already carries a record in ${NOTES_REF} (${lines} trailer(s)) — leaving it alone`,
      );
      return { action: 'already-inherited', records: 0, conflicts: 0, pushed: false };
    }

    const carriedIds = carriedRecordIds(mergeSha);
    const plan = preserve(range, mergeSha, carriedIds);
    const records = plan.sources?.length ?? 0;
    const conflicts = plan.conflicts?.length ?? 0;
    const skipped = plan.skippedRecordIds ?? [];

    if (skipped.length > 0) {
      say(
        `${short(mergeSha)} already carries ${skipped.join(', ')} in its message — skipping it`,
      );
    }

    // A branch that recorded nothing is an ordinary branch (SPEC §4). The
    // command attaches nothing, so there is nothing to publish either.
    if (records === 0) {
      if (skipped.length > 0) {
        say(`all branch records were already carried by ${short(mergeSha)} — attached nothing`);
        return { action: 'already-carried', records: 0, conflicts, pushed: false };
      }
      say(`no records in ${range} — nothing to inherit onto ${short(mergeSha)}`);
      return { action: 'nothing-to-preserve', records: 0, conflicts, pushed: false };
    }

    say(`attached ${records} record(s) from ${range} to ${short(mergeSha)} in ${NOTES_REF}`);

    if (!PUSH_ENABLED) {
      say(`push: false — ${NOTES_REF} was written locally and not published`);
      return { action: 'inherited', records, conflicts, pushed: false };
    }

    const pushed = pushNotes();
    if (pushed.status === 0) {
      say(`published ${NOTES_REF} to origin`);
      return { action: 'inherited', records, conflicts, pushed: true };
    }

    const reason = firstLine(pushed.stderr) || `git push exited ${pushed.status}`;
    const raceable = RACE_REJECTED.test(pushed.stderr ?? '');

    if (!raceable || attempt === PUSH_ATTEMPTS) {
      failPush(records, conflicts, [
        `could not publish ${NOTES_REF} to origin after ${attempt} attempt(s): ${reason}`,
        redact((pushed.stderr ?? '').trim()),
        '→ the record was attached on the runner and is about to be discarded with it',
        '→ permissions: `contents: write`, and a checkout that persisted its credentials',
      ]);
    }

    warn(`push rejected (attempt ${attempt}/${PUSH_ATTEMPTS}): ${reason} — re-reading ${NOTES_REF}`);

    const fetched = refetchNotes();
    if (fetched.status !== 0) {
      failPush(records, conflicts, [
        `push was rejected and ${NOTES_REF} could not be re-read from origin: ${firstLine(fetched.stderr)}`,
        '→ retrying without the remote state would push the same rejected mirror again',
      ]);
    }
  }

  // Unreachable: the last attempt either returns or dies above.
  return { action: 'push-failed', records: 0, conflicts: 0, pushed: false };
};

const main = () => {
  const mergeInput = (process.env.COMMITLORE_MERGE_SHA ?? '').trim();
  if (mergeInput === '') {
    blocked(
      'no merge commit to inherit onto',
      '→ merge-sha defaults to github.event.pull_request.merge_commit_sha',
      '→ gate the job on `github.event.pull_request.merged == true`; an unmerged pull',
      '  request carries a test-merge sha that is not in the repository',
    );
  }

  requireWorkTree();
  requireFullClone();
  const notes = requireNotesWhenRemoteHasThem();

  const mergeSha = resolveRef(mergeInput);
  if (mergeSha === null) {
    blocked(
      `cannot resolve the merge commit ${JSON.stringify(mergeInput)} in this checkout`,
      '→ check out the base branch after the merge:',
      '     actions/checkout@v4 with `ref: ${{ github.event.pull_request.base.ref }}`',
    );
  }

  const baseInput = (process.env.COMMITLORE_BASE_REF ?? '').trim();
  if (baseInput === '') {
    blocked(
      'no base ref to collect from',
      '→ base-ref defaults to github.event.pull_request.base.ref',
    );
  }
  const base = resolveBase(baseInput);

  const headInput = (process.env.COMMITLORE_HEAD_REF ?? '').trim();
  if (headInput === '') {
    blocked(
      'no head ref to collect from',
      '→ head-ref defaults to github.event.pull_request.head.sha',
    );
  }
  const head = resolveRef(headInput);
  if (head === null) {
    blocked(
      `cannot resolve the head ref ${JSON.stringify(headInput)} in this checkout`,
      '→ a squash merge usually deletes the branch, so the head is reachable only',
      '  through the pull request ref. Add a step after checkout:',
      "     git fetch --no-tags --force origin '+refs/pull/<number>/head:refs/commitlore/pr-head'",
    );
  }

  say(`commitlore preserve: ${base}..${head} → ${short(mergeSha)} (${NOTES_REF} ${notes})`);

  const verdict = classifyMerge(mergeSha, base, head);
  say(`merge type: ${verdict.kind} — ${verdict.why}`);

  if (verdict.kind !== 'squash') {
    setOutput('action', 'skipped');
    setOutput('merge-type', verdict.kind);
    setOutput('records', 0);
    setOutput('conflicts', 0);
    setOutput('pushed', 'false');
    writeSummary([
      '### CommitLore — squash inheritance',
      '',
      `Nothing to do: this was a **${verdict.kind}**. ${verdict.why}.`,
    ]);
    return;
  }

  const range = `${base}..${head}`;
  const result = inherit(range, mergeSha);

  setOutput('action', result.action);
  setOutput('merge-type', 'squash');
  setOutput('records', result.records);
  setOutput('conflicts', result.conflicts);
  setOutput('pushed', result.pushed ? 'true' : 'false');

  writeSummary([
    '### CommitLore — squash inheritance',
    '',
    `- merge commit: \`${short(mergeSha)}\``,
    `- range: \`${range}\``,
    `- outcome: **${result.action}** (${result.records} record(s), ${result.conflicts} conflict(s))`,
    `- published to \`${NOTES_REF}\`: ${result.pushed ? 'yes' : 'no'}`,
  ]);
};

main();
