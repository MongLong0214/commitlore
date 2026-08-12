#!/usr/bin/env node
/**
 * Refuses a release unless every named CI check succeeded at its exact commit.
 *
 * A green branch, a recent green workflow, or a passing local suite is not a
 * substitute for a successful check run at the SHA a tag resolves to. This
 * script names the required check runs up front and treats every other state —
 * including a missing run — as a blocking failure.
 *
 * Usage:
 *   node scripts/check-exact-head-ci.mjs <owner> <repo> <sha>
 *   node scripts/check-exact-head-ci.mjs <owner> <repo> <sha> --from-file <check-runs.json>
 *   node scripts/check-exact-head-ci.mjs <owner> <repo> <sha> --from-stdin
 *
 * `--from-file` and `--from-stdin` are test seams. Their JSON is the response
 * body from GET /repos/{owner}/{repo}/commits/{sha}/check-runs (or a raw array
 * of its `check_runs` entries). Without either seam the script calls GitHub.
 *
 * Exit codes follow SPEC §10:
 *   0  every explicitly required check completed successfully at `sha`
 *   1  a required check is absent, belongs to another SHA, or is not success
 *   2  bad input, unreadable payload, or an API/repository failure
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// This is intentionally a fixed allowlist, not a list inferred from whatever
// happened to report at a SHA. A missing check is the failure this gate exists
// to catch, so presence cannot define the requirement.
export const REQUIRED_CHECKS = Object.freeze([
  'check (22)',
  'check (24)',
  'git-matrix (ubuntu-latest)',
  'git-matrix (macos-latest)',
  'install-script',
  'install-ps1',
]);

class GateError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

const usage = () => {
  throw new GateError(
    'usage: node scripts/check-exact-head-ci.mjs <owner> <repo> <sha> [--from-file <check-runs.json> | --from-stdin]',
  );
};

const parseArgs = (argv) => {
  const positional = [];
  let fromFile = null;
  let fromStdin = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--from-file') {
      const path = argv[index + 1];
      if (!path || fromFile !== null) usage();
      fromFile = path;
      index += 1;
    } else if (arg === '--from-stdin') {
      if (fromStdin) usage();
      fromStdin = true;
    } else if (arg.startsWith('--')) {
      usage();
    } else {
      positional.push(arg);
    }
  }

  if (fromFile !== null && fromStdin) usage();
  if (positional.length !== 3 || positional.some((value) => value === '')) usage();
  return { owner: positional[0], repo: positional[1], sha: positional[2], fromFile, fromStdin };
};

const readStdin = async () => {
  let body = '';
  for await (const chunk of process.stdin) body += chunk;
  return body;
};

const parsePayload = (text, source) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new GateError(`ERROR: ${source} is not valid JSON: ${error.message}`);
  }
};

const checkRunsFrom = (payload, source) => {
  if (Array.isArray(payload)) return payload;
  if (payload !== null && typeof payload === 'object' && Array.isArray(payload.check_runs)) {
    return payload.check_runs;
  }
  throw new GateError(`ERROR: ${source} does not contain a check_runs array.`);
};

const networkPayload = async (owner, repo, sha) => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new GateError('ERROR: GITHUB_TOKEN is required to query the exact-head CI checks.');
  }

  const apiBase = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}/check-runs`;
  const checkRuns = [];
  let page = 1;
  let totalCount = null;

  do {
    const response = await fetch(`${apiBase}${path}?per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      throw new GateError(`ERROR: GitHub check-runs API returned ${response.status} ${response.statusText} for ${sha}.`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new GateError(`ERROR: GitHub check-runs API returned invalid JSON: ${error.message}`);
    }
    const pageRuns = checkRunsFrom(payload, 'GitHub check-runs API response');
    checkRuns.push(...pageRuns);
    if (typeof payload.total_count === 'number') totalCount = payload.total_count;
    if (pageRuns.length === 0) break;
    page += 1;
  } while (checkRuns.length < (totalCount ?? Number.POSITIVE_INFINITY));

  return checkRuns;
};

// The only producer whose check runs mean "this repository's CI ran". A check
// run's name is not evidence of who wrote it: any GitHub App installed on the
// repository may create one, choose `check (22)` as its name, and conclude it
// `success`. Matching on the name alone accepted that as CI (#571). The slug is
// GitHub's own identifier for the Actions app and is not settable by a caller.
const REQUIRED_APP_SLUG = 'github-actions';

const checkRequiredRuns = (checkRuns, sha) => {
  const problems = [];

  for (const required of REQUIRED_CHECKS) {
    const named = checkRuns.filter((run) => run !== null && typeof run === 'object' && run.name === required);
    // Split rather than filter: a run bearing a required check's name from some
    // other app is a finding, not something to pass over quietly. Dropping it
    // silently would report "required check is absent" and lose the reason.
    const matching = named.filter((run) => run.app?.slug === REQUIRED_APP_SLUG);
    for (const foreign of named.filter((run) => !matching.includes(run))) {
      problems.push(
        `${required}: reported by app "${String(foreign.app?.slug ?? 'none')}", expected "${REQUIRED_APP_SLUG}"`,
      );
    }
    if (matching.length === 0) {
      problems.push(`${required}: required check is absent`);
      continue;
    }

    for (const run of matching) {
      if (run.head_sha !== sha) {
        problems.push(`${required}: reported head SHA "${String(run.head_sha)}", expected "${sha}"`);
      }
      if (run.status !== 'completed') {
        problems.push(`${required}: status "${String(run.status)}", expected "completed"`);
      }
      if (run.conclusion !== 'success') {
        problems.push(`${required}: conclusion "${String(run.conclusion)}", expected "success"`);
      }
    }
  }

  return problems;
};

const main = async () => {
  const { owner, repo, sha, fromFile, fromStdin } = parseArgs(process.argv.slice(2));
  let payload;
  let source;

  if (fromFile !== null) {
    source = `payload file ${fromFile}`;
    try {
      payload = parsePayload(readFileSync(fromFile, 'utf8'), source);
    } catch (error) {
      if (error instanceof GateError) throw error;
      throw new GateError(`ERROR: could not read ${source}: ${error.message}`);
    }
  } else if (fromStdin) {
    source = 'stdin payload';
    payload = parsePayload(await readStdin(), source);
  } else {
    source = 'GitHub check-runs API response';
    payload = { check_runs: await networkPayload(owner, repo, sha) };
  }

  const checkRuns = checkRunsFrom(payload, source);
  const problems = checkRequiredRuns(checkRuns, sha);
  if (problems.length > 0) {
    console.error(`ERROR: exact-head CI did not pass for ${owner}/${repo}@${sha}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('  Every required check must be present, completed, and concluded success at this exact SHA.');
    process.exitCode = 1;
    return;
  }

  console.log(`exact-head CI accepted: all ${REQUIRED_CHECKS.length} required checks succeeded at ${owner}/${repo}@${sha}`);
};

const invokedAsScript = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = error instanceof GateError ? error.exitCode : 2;
  });
}
