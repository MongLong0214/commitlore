#!/usr/bin/env node
/**
 * Refuses publication unless the live tag still resolves to the commit the
 * release gates qualified.
 *
 * Every gate before this one proves something about a commit. None of them
 * proves the tag still points at it. A tag is a mutable ref: it can be moved
 * or deleted between the job that qualified it and the job that publishes,
 * and each boundary that resolves the tag *name* again can be answered with a
 * different commit than the last one got. This script is the last-moment
 * binding check, and it asks the remote rather than the local checkout,
 * because a checkout is a snapshot of what the tag meant when it was taken.
 *
 * An annotated tag has two refs: the tag object and its peeled `^{}` commit.
 * The peeled line is the commit, and the one to compare — comparing the tag
 * object SHA would refuse every annotated tag for the wrong reason.
 *
 * Usage:
 *   node scripts/check-tag-binding.mjs <tag-name> <expected-sha> [remote]
 *   node scripts/check-tag-binding.mjs <tag-name> <expected-sha> --from-file <ls-remote.txt>
 *   node scripts/check-tag-binding.mjs <tag-name> <expected-sha> --from-stdin
 *
 * `--from-file` and `--from-stdin` are test seams. Their content is the output
 * of `git ls-remote --tags <remote> refs/tags/<tag>`, verbatim.
 *
 * Exit codes follow SPEC §10:
 *   0  the live tag exists and resolves to the expected commit
 *   1  the tag is missing, or resolves to a different commit
 *   2  the inputs were unusable, or the remote could not be read
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const usage = () => {
  console.error(
    'usage: node scripts/check-tag-binding.mjs <tag-name> <expected-sha> [remote | --from-file <path> | --from-stdin]',
  );
  process.exit(2);
};

const parseArgs = (argv) => {
  const positional = [];
  let fromFile = null;
  let fromStdin = false;
  let remote = 'origin';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--from-file') {
      // Repeating the flag is the same ambiguity as passing two sources: the
      // caller named two listings and only one gets checked. Keeping the last
      // one silently would make which listing was verified depend on argument
      // order rather than on anything the caller stated.
      if (fromFile !== null) {
        console.error('ERROR: --from-file was given more than once.');
        console.error('  Two listings are two questions; pass the one to check.');
        process.exit(2);
      }
      fromFile = argv[index + 1] ?? null;
      if (fromFile === null) usage();
      index += 1;
    } else if (arg === '--from-stdin') {
      if (fromStdin) {
        console.error('ERROR: --from-stdin was given more than once.');
        console.error('  There is one stdin; a repeated flag means the invocation was not what its author thought.');
        process.exit(2);
      }
      fromStdin = true;
    } else if (arg.startsWith('--')) {
      usage();
    } else {
      positional.push(arg);
    }
  }

  // Two sources are not a preference to resolve, they are a caller who does
  // not know which listing is being checked. Silently picking one would decide
  // that on their behalf, and the wrong choice is a release published against
  // a tag nobody looked at.
  if (fromFile !== null && fromStdin) {
    console.error('ERROR: --from-file and --from-stdin are mutually exclusive.');
    console.error('  Pass exactly one listing; choosing between them is not this script\'s decision to make.');
    process.exit(2);
  }
  if (positional.length === 3 && (fromFile !== null || fromStdin)) {
    console.error(`ERROR: a remote ("${positional[2]}") cannot be combined with --from-file or --from-stdin.`);
    console.error('  The seam replaces the remote query; supplying both leaves the checked source ambiguous.');
    process.exit(2);
  }

  if (positional.length === 3) remote = positional[2];
  else if (positional.length !== 2) usage();

  return { tag: positional[0], expected: positional[1], remote, fromFile, fromStdin };
};

const readStdin = () => {
  try {
    return readFileSync(0, 'utf8');
  } catch (error) {
    console.error(`ERROR: could not read the ls-remote payload from stdin: ${error.message}`);
    process.exit(2);
  }
};

const { tag, expected, remote, fromFile, fromStdin } = parseArgs(process.argv.slice(2));

if (!/^[0-9a-f]{40}$/.test(expected)) {
  console.error(`ERROR: expected commit "${expected}" is not a full 40-character sha.`);
  console.error('  The qualified commit must be passed exactly, not abbreviated or named.');
  process.exit(2);
}

const ref = `refs/tags/${tag}`;

let payload;
let source;
if (fromFile !== null) {
  try {
    payload = readFileSync(fromFile, 'utf8');
  } catch (error) {
    console.error(`ERROR: could not read ${fromFile}: ${error.message}`);
    process.exit(2);
  }
  source = fromFile;
} else if (fromStdin) {
  payload = readStdin();
  source = 'stdin payload';
} else {
  // BOTH patterns, always. `ls-remote --tags <remote> refs/tags/<tag>` returns
  // only the tag object for an annotated tag — the peeled `^{}` line appears
  // solely when that ref is asked for by name. Requesting one pattern would
  // therefore compare an annotated release against its tag object sha and
  // refuse every one of them for a reason that has nothing to do with the
  // commit. Because both are always requested, a missing peeled line now means
  // the tag really is lightweight rather than merely unasked-for.
  const result = spawnSync('git', ['ls-remote', '--tags', '--', remote, ref, `${ref}^{}`], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    console.error(`ERROR: could not read ${ref} from remote "${remote}".`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(2);
  }
  payload = result.stdout;
  source = `${remote} ${ref}`;
}

// `<sha>\t<ref>`, one per line. An annotated tag adds a second line whose ref
// carries the `^{}` suffix and whose sha is the commit the tag points at.
const rows = payload
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .map((line) => {
    const [sha, name] = line.split(/\s+/, 2);
    return { sha, name };
  });

const malformed = rows.find(({ sha, name }) => !/^[0-9a-f]{40}$/.test(sha ?? '') || (name ?? '') === '');
if (malformed !== undefined) {
  console.error(`ERROR: could not parse the tag listing from ${source}.`);
  console.error(`  offending line: ${malformed.sha ?? ''} ${malformed.name ?? ''}`);
  process.exit(2);
}

// Only two refs can legitimately appear. Anything else means the listing is
// not the one that was asked for, and reading a familiar row out of an
// unfamiliar payload is how a check ends up answering about the wrong tag.
const peeledRef = `${ref}^{}`;
const unexpected = rows.filter(({ name }) => name !== ref && name !== peeledRef);
if (unexpected.length > 0) {
  console.error(`ERROR: the listing from ${source} carries refs this check did not ask for.`);
  for (const row of unexpected) console.error(`  unexpected: ${row.name}`);
  process.exit(2);
}

const peeledRows = rows.filter(({ name }) => name === peeledRef);
const plainRows = rows.filter(({ name }) => name === ref);

// A ref resolves to one object. Two rows for one name is a contradiction, and
// picking either would be a guess presented as a verification.
if (plainRows.length > 1 || peeledRows.length > 1) {
  console.error(`ERROR: ${source} reports the same ref more than once, so it does not identify one commit.`);
  for (const row of [...plainRows, ...peeledRows]) console.error(`  ${row.sha} ${row.name}`);
  process.exit(2);
}

const [peeled] = peeledRows;
const [plain] = plainRows;

// Absence is a refusal, not an empty success. A release that publishes past a
// tag it could not find would create the reference it was supposed to verify,
// which is the inversion these gates exist to remove.
if (peeled === undefined && plain === undefined) {
  console.error(`ERROR: ${ref} does not exist on "${remote}".`);
  console.error('  Refusing to publish a release for a tag that is not there; publication never creates it.');
  process.exit(1);
}

// A peeled ref only exists because a tag object points at it, so git never
// reports one without the other. A payload that does is truncated or
// assembled, and trusting its commit would mean trusting the part that is
// missing to have said the same thing.
if (peeled !== undefined && plain === undefined) {
  console.error(`ERROR: ${source} reports ${peeledRef} with no ${ref} row.`);
  console.error('  A peeled ref cannot exist without its tag object; this listing is incomplete.');
  process.exit(2);
}

const live = (peeled ?? plain).sha;
const kind = peeled === undefined ? 'lightweight' : 'annotated';

if (live !== expected) {
  console.error(`ERROR: ${ref} now resolves to ${live}, but the release gates qualified ${expected}.`);
  console.error('  The tag moved after qualification. Refusing to publish a commit nothing checked.');
  process.exit(1);
}

console.log(`tag binding accepted: ${ref} (${kind}) still resolves to ${expected} on "${remote}"`);
