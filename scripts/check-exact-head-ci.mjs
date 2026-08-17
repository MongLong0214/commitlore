#!/usr/bin/env node
/**
 * Refuses a release unless the CI workflow's required jobs succeeded at its
 * exact commit.
 *
 * A check-run name only proves that a GitHub App emitted that name. It does not
 * identify the workflow, event, run attempt, or Actions job that produced it.
 * This gate therefore reads the CI workflow record, one of its push runs at
 * the candidate SHA, and the jobs from that exact run attempt. Missing or
 * non-success evidence is a blocking failure.
 *
 * Usage:
 *   node scripts/check-exact-head-ci.mjs <owner> <repo> <sha>
 *   node scripts/check-exact-head-ci.mjs <owner> <repo> <sha> --from-file <workflow-evidence.json>
 *   node scripts/check-exact-head-ci.mjs <owner> <repo> <sha> --from-stdin
 *
 * `--from-file` and `--from-stdin` are test seams. Their JSON has `workflow`,
 * `workflow_runs`, and `jobs` keyed by "<run id>:<attempt>". Without a seam
 * the script reads those objects from the GitHub Actions REST API.
 *
 * Exit codes follow SPEC §10:
 *   0  CI's required jobs completed successfully at `sha`
 *   1  CI workflow/run/job evidence is absent or fails this verdict
 *   2  bad input, unreadable payload, or an API/repository failure
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const CI_WORKFLOW_FILE = 'ci.yml';
export const CI_WORKFLOW_PATH = `.github/workflows/${CI_WORKFLOW_FILE}`;
export const CI_WORKFLOW_NAME = 'CI';
export const CI_EVENT = 'push';
const CI_WORKFLOW_FILE_PATH = fileURLToPath(new URL(`../${CI_WORKFLOW_PATH}`, import.meta.url));

// This digest locks the workflow body which the API has run. The Actions API
// reports job and step metadata, but cannot attest to the semantics of a
// shell command; without this lock replacing every job body with `true` would
// still look like a real successful run. Update deliberately with the CI
// workflow when its reviewed job contract changes.
export const EXPECTED_CI_WORKFLOW_SHA256 = '2d33e8811f8ab845939cf6c265343e51e2866c0013650a062cb0d40f9bd37205';

// Fixed rather than inferred from returned jobs: absence must fail rather
// than define itself away. `lint` only runs for pull requests and is therefore
// deliberately not a member of the push-event release contract.
//
// That exclusion is about which contexts exist on a main commit, not about
// whether `lint` ran. It is one of the eleven required status checks on the
// `main` branch protection, so it is evaluated on the pull request's head and
// has to pass before anything reaches main; the squash then produces a new
// commit that carries no `lint` context for this gate to find. Ten here plus
// `lint` is the eleven that protection requires.
//
// Written down because the shorter version reads as a hole: a reader took it
// that way on 2026-08-17 and asked whether main could be pushed unlinted. The
// release gate not requiring `lint` is not the same as main never being
// linted, and saying only the first invites someone to add `lint` to this
// list, which would block every release.
export const REQUIRED_CHECKS = Object.freeze([
  'check (22.23.2)',
  'check (24)',
  'audit',
  'git-matrix (ubuntu-latest)',
  'git-matrix (macos-latest)',
  'install-script',
  'install-ps1',
  'install-macos',
  'install-alpine (linux/amd64)',
  'install-alpine (linux/arm64)',
]);

class GateError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

const usage = () => {
  throw new GateError(
    'usage: node scripts/check-exact-head-ci.mjs <owner> <repo> <sha> [--from-file <workflow-evidence.json> | --from-stdin]',
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

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const workflowEvidenceFrom = (payload, source) => {
  if (!isObject(payload)) throw new GateError(`ERROR: ${source} is not a workflow-evidence object.`);
  if (!isObject(payload.workflow)) throw new GateError(`ERROR: ${source} does not contain a workflow object.`);
  if (!Array.isArray(payload.workflow_runs)) {
    throw new GateError(`ERROR: ${source} does not contain a workflow_runs array.`);
  }
  if (!isObject(payload.jobs)) throw new GateError(`ERROR: ${source} does not contain jobs keyed by run attempt.`);
  return payload;
};

const jobsFrom = (payload, source) => {
  if (Array.isArray(payload)) return payload;
  if (isObject(payload) && Array.isArray(payload.jobs)) return payload.jobs;
  throw new GateError(`ERROR: ${source} does not contain a jobs array.`);
};

const workflowDigest = (source) => createHash('sha256').update(source).digest('hex');

export const workflowIntegrityProblems = (source) => {
  const actual = workflowDigest(source);
  return actual === EXPECTED_CI_WORKFLOW_SHA256
    ? []
    : [`${CI_WORKFLOW_PATH}: SHA-256 "${actual}", expected reviewed workflow "${EXPECTED_CI_WORKFLOW_SHA256}"`];
};

const localWorkflowIntegrity = () => {
  try {
    return workflowIntegrityProblems(readFileSync(CI_WORKFLOW_FILE_PATH, 'utf8'));
  } catch (error) {
    throw new GateError(`ERROR: could not read ${CI_WORKFLOW_PATH}: ${error.message}`);
  }
};

const api = async (owner, repo, path) => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new GateError('ERROR: GITHUB_TOKEN is required to query the CI workflow evidence.');

  const apiBase = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
  const response = await fetch(`${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new GateError(`ERROR: GitHub Actions API returned ${response.status} ${response.statusText} for ${path}.`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new GateError(`ERROR: GitHub Actions API returned invalid JSON: ${error.message}`);
  }
};

const paged = async (owner, repo, path, arrayKey) => {
  const values = [];
  let page = 1;
  let totalCount = null;
  do {
    const separator = path.includes('?') ? '&' : '?';
    const payload = await api(owner, repo, `${path}${separator}per_page=100&page=${page}`);
    if (!isObject(payload) || !Array.isArray(payload[arrayKey])) {
      throw new GateError(`ERROR: GitHub Actions API response for ${path} does not contain ${arrayKey}.`);
    }
    values.push(...payload[arrayKey]);
    if (typeof payload.total_count === 'number') totalCount = payload.total_count;
    if (payload[arrayKey].length === 0) break;
    page += 1;
  } while (values.length < (totalCount ?? Number.POSITIVE_INFINITY));
  return values;
};

const networkEvidence = async (owner, repo, sha) => {
  // GitHub accepts the workflow file name here and returns its stable numeric
  // ID. The later run must name that ID as well as its path and display name.
  const workflow = await api(owner, repo, `/actions/workflows/${encodeURIComponent(CI_WORKFLOW_FILE)}`);
  if (!isObject(workflow) || !Number.isSafeInteger(workflow.id)) {
    throw new GateError('ERROR: GitHub Actions API did not return a workflow with a numeric ID.');
  }
  const query = new URLSearchParams({ event: CI_EVENT, head_sha: sha });
  const workflowRuns = await paged(owner, repo, `/actions/workflows/${workflow.id}/runs?${query}`, 'workflow_runs');
  const jobs = {};
  for (const run of workflowRuns) {
    if (!isObject(run) || !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt)) continue;
    const key = `${run.id}:${run.run_attempt}`;
    // This endpoint binds the verdict to this attempt, rather than the latest
    // attempt a rerun might create after we listed workflow runs.
    jobs[key] = { jobs: await paged(owner, repo, `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs') };
  }
  return { workflow, workflow_runs: workflowRuns, jobs };
};

const runPath = (run) => {
  if (typeof run.path !== 'string') return null;
  // GitHub's REST examples show "path@ref", while the live API also returns
  // the bare repository-relative path. Both forms bind the same workflow;
  // anything else is rejected rather than guessed from a check-run name.
  if (run.path === CI_WORKFLOW_PATH) return run.path;
  const at = run.path.indexOf('@');
  if (at <= 0 || at === run.path.length - 1) return null;
  return run.path.slice(0, at);
};

const value = (entry, key) => String(entry?.[key] ?? 'none');

const runProblems = (workflow, run, sha) => {
  const problems = [];
  const label = `workflow run ${value(run, 'id')}`;
  if (run.workflow_id !== workflow.id) problems.push(`${label}: workflow ID "${value(run, 'workflow_id')}", expected "${workflow.id}"`);
  if (runPath(run) !== CI_WORKFLOW_PATH) problems.push(`${label}: path "${value(run, 'path')}", expected ${CI_WORKFLOW_PATH}@<ref>`);
  if (run.name !== CI_WORKFLOW_NAME) problems.push(`${label}: name "${value(run, 'name')}", expected "${CI_WORKFLOW_NAME}"`);
  if (run.event !== CI_EVENT) problems.push(`${label}: event "${value(run, 'event')}", expected "${CI_EVENT}"`);
  if (run.head_sha !== sha) problems.push(`${label}: head SHA "${value(run, 'head_sha')}", expected "${sha}"`);
  if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
    problems.push(`${label}: run attempt "${value(run, 'run_attempt')}", expected a positive integer`);
  }
  if (run.status !== 'completed') problems.push(`${label}: status "${value(run, 'status')}", expected "completed"`);
  if (run.conclusion !== 'success') problems.push(`${label}: conclusion "${value(run, 'conclusion')}", expected "success"`);
  return problems;
};

const jobProblems = (jobs, run, sha) => {
  const problems = [];
  const label = `workflow run ${run.id} attempt ${run.run_attempt}`;
  const actual = jobs.filter(isObject);
  for (const job of actual) {
    if (!REQUIRED_CHECKS.includes(job.name)) problems.push(`${label}: unexpected job "${value(job, 'name')}"`);
  }
  for (const required of REQUIRED_CHECKS) {
    const matching = actual.filter((job) => job.name === required);
    if (matching.length === 0) {
      problems.push(`${label}: ${required}: required job is absent`);
      continue;
    }
    if (matching.length > 1) problems.push(`${label}: ${required}: reported ${matching.length} times`);
    for (const job of matching) {
      if (job.head_sha !== sha) problems.push(`${label}: ${required}: head SHA "${value(job, 'head_sha')}", expected "${sha}"`);
      if (job.status !== 'completed') problems.push(`${label}: ${required}: status "${value(job, 'status')}", expected "completed"`);
      if (job.conclusion !== 'success') problems.push(`${label}: ${required}: conclusion "${value(job, 'conclusion')}", expected "success"`);
      if (typeof job.started_at !== 'string' || typeof job.completed_at !== 'string') {
        problems.push(`${label}: ${required}: has no recorded execution timestamps`);
      }
    }
  }
  return problems;
};

const checkWorkflowEvidence = (evidence, sha) => {
  const problems = [];
  const { workflow, workflow_runs: workflowRuns, jobs } = evidence;
  if (workflow.path !== CI_WORKFLOW_PATH) problems.push(`workflow path "${value(workflow, 'path')}", expected "${CI_WORKFLOW_PATH}"`);
  if (workflow.name !== CI_WORKFLOW_NAME) problems.push(`workflow name "${value(workflow, 'name')}", expected "${CI_WORKFLOW_NAME}"`);
  if (!Number.isSafeInteger(workflow.id)) problems.push(`workflow ID "${value(workflow, 'id')}", expected a numeric ID`);
  if (problems.length > 0) return problems;

  if (workflowRuns.length === 0) return ['required CI workflow run is absent'];
  const rejectedRuns = [];
  for (const run of workflowRuns) {
    if (!isObject(run)) {
      rejectedRuns.push('workflow run entry is not an object');
      continue;
    }
    const runFailures = runProblems(workflow, run, sha);
    if (runFailures.length > 0) {
      rejectedRuns.push(...runFailures);
      continue;
    }
    const key = `${run.id}:${run.run_attempt}`;
    try {
      const jobFailures = jobProblems(jobsFrom(jobs[key], `jobs for ${key}`), run, sha);
      if (jobFailures.length === 0) return [];
      rejectedRuns.push(...jobFailures);
    } catch (error) {
      if (error instanceof GateError) rejectedRuns.push(error.message.replace(/^ERROR: /, ''));
      else throw error;
    }
  }
  return ['no CI workflow run satisfied the exact-head verdict', ...rejectedRuns];
};

const main = async () => {
  const { owner, repo, sha, fromFile, fromStdin } = parseArgs(process.argv.slice(2));
  const integrityProblems = localWorkflowIntegrity();
  if (integrityProblems.length > 0) {
    console.error(`ERROR: exact-head CI did not pass for ${owner}/${repo}@${sha}:`);
    for (const problem of integrityProblems) console.error(`  - ${problem}`);
    console.error('  The reviewed CI workflow contents must be unchanged.');
    process.exitCode = 1;
    return;
  }

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
    source = 'GitHub Actions API response';
    payload = await networkEvidence(owner, repo, sha);
  }

  const problems = checkWorkflowEvidence(workflowEvidenceFrom(payload, source), sha);
  if (problems.length > 0) {
    console.error(`ERROR: exact-head CI did not pass for ${owner}/${repo}@${sha}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('  A completed CI push run, its exact attempt, and every required job must succeed at this SHA.');
    process.exitCode = 1;
    return;
  }

  const accepted = payload.workflow_runs.find((run) => {
    if (!isObject(run) || runProblems(payload.workflow, run, sha).length > 0) return false;
    try {
      return jobProblems(jobsFrom(payload.jobs[`${run.id}:${run.run_attempt}`], `jobs for ${run.id}:${run.run_attempt}`), run, sha).length === 0;
    } catch {
      return false;
    }
  });
  console.log(
    `exact-head CI accepted: ${CI_WORKFLOW_NAME} workflow run ${accepted.id} attempt ${accepted.run_attempt} completed all ${REQUIRED_CHECKS.length} required jobs at ${owner}/${repo}@${sha}`,
  );
};

const invokedAsScript = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = error instanceof GateError ? error.exitCode : 2;
  });
}
