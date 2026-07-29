/**
 * Backfill — reconstructing records for commits made before CommitLore existed
 * (T-801, PRD-F8, ADR-0006).
 *
 * Every other write path in this codebase records a decision while somebody
 * still remembers making it. Backfill does not have that. It works from what
 * survived — a commit message, maybe a pull request body, the diff — and asks a
 * session to say what the change was for. That is reconstruction, and
 * reconstruction is the one place in the protocol where a model is being invited
 * to fill a gap it cannot see into.
 *
 * So the gap is closed from three sides, and none of them is optional:
 *
 * 1. **`Provenance: reconstructed`, always.** Forced onto every record before it
 *    is verified, overwriting whatever the draft claimed. A backfilled record
 *    that presented itself as `authored` would be graded as an instruction by
 *    SPEC §7 — a sentence a model wrote about a commit it never saw, delivered
 *    to the next agent as a directive.
 * 2. **`verifyDraft` is a gate, not a lint.** Nothing reaches the notes mirror
 *    without passing T-404, which re-reads the exact same transcript and diff
 *    and keeps only quotes it can find there character for character.
 * 3. **Failure is a skip.** There is no repair round here. `harvest` repairs
 *    because a live session can go back and read the transcript again; backfill
 *    cannot, because the source really is that thin. A second attempt against
 *    thin sources is not a better reading of the evidence, it is a stronger
 *    incentive to invent. Discarded records are logged and left discarded.
 *
 * What this module will not do is rewrite history. Records go to
 * `refs/notes/commitlore` and nowhere else: rewriting a commit message to add a
 * trailer changes every downstream sha, and no cold-start convenience is worth
 * an irreversible operation on somebody's history.
 *
 * ## The CLI still holds no key
 *
 * As everywhere else (ADR-0006), the model is the user's. `--prompt-only` emits
 * the reconstruction contract; the session answers it; `--draft` takes the
 * answer back. With neither flag there is nothing to reconstruct *with*, so the
 * command does the one useful thing that needs no model at all — it indexes the
 * past commits that already carry trailers — and exits 0.
 *
 * ## Why target selection walks git rather than reading the index
 *
 * `scanTrailers` answers "which commits already carry a record" by walking git
 * directly, which is slower than the SQLite index on a large repository. It is
 * used anyway: it never writes (so `--dry-run` is genuinely read-only), it needs
 * no database (so a fresh clone works), and it is one code path rather than two
 * that have to agree. Backfill is a one-shot cold-start command, and paying a
 * full walk once is the cheap side of that trade.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { execGit } from './git.js';
import { buildHarvestPrompt, loadVocabulary, parseDraft, } from './harvest.js';
import { verifyDraft } from './harvest-verify.js';
import { closeIndex, openIndex, scanTrailers, updateIndex } from './index-db.js';
import { writeRecord } from './notes.js';
import { validateRecord } from './schema.js';
import { EXTENSION_KEY_RE, KNOWN_KEYS } from './types.js';
/** Target commits considered when `--limit` is not given. */
export const DEFAULT_LIMIT = 50;
/**
 * Commits per batch. Batches exist only so that "nothing came back" can be
 * observed before the whole list has been walked (PRD-F8 요구 3), so the size
 * trades responsiveness against how much work a converged run wastes.
 */
export const DEFAULT_BATCH_SIZE = 10;
/**
 * Consecutive batches producing nothing before the run is declared converged.
 * Two rather than one: a single empty batch is normal — most commits record
 * nothing (SPEC §4) — and stopping on it would make backfill quit at the first
 * uneventful stretch of history.
 */
export const EMPTY_BATCH_LIMIT = 2;
/**
 * Characters per token, for the `--budget-tokens` estimate. It is an estimate
 * and the flag is named for what the user is protecting (their session's
 * context), not for what this module can measure: the CLI has no tokenizer,
 * because it has no model.
 */
const CHARS_PER_TOKEN = 4;
/**
 * Longest diff handed to a session. A 4 MB refactor commit would swallow the
 * budget by itself and tell the session nothing the first 64 KB did not. The
 * truncation is part of the source: the verifier rebuilds the diff the same way,
 * so a quote from beyond the cut is not found and the record is discarded rather
 * than accepted against text the session never saw.
 */
const MAX_DIFF_BYTES = 64 * 1024;
const TRUNCATION_NOTE = `\n[commitlore: diff truncated at ${MAX_DIFF_BYTES} bytes]\n`;
/** `git show` on a merge of a large tree; same headroom the indexer uses. */
const DIFF_MAX_BUFFER = 256 * 1024 * 1024;
/** Pull requests read per commit. More than a handful is a merge queue artifact. */
const PR_LIMIT = 5;
// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------
const gitOpts = (cwd) => (cwd === undefined ? {} : { cwd });
const errorMessage = (error) => error instanceof Error ? error.message : String(error);
/** Every commit reachable from HEAD, newest first. `[]` for an empty repository. */
const revList = (cwd) => {
    const result = execGit(['rev-list', 'HEAD'], { ...gitOpts(cwd), maxBuffer: DIFF_MAX_BUFFER });
    if (result.code !== 0)
        return [];
    return result.stdout.split('\n').filter((line) => line !== '');
};
const subjectOf = (cwd, sha) => {
    const result = execGit(['log', '-1', '--format=%s', '--no-notes', '--end-of-options', sha], gitOpts(cwd));
    return result.code === 0 ? result.stdout.trim() : '';
};
/** The raw commit message, subject and body, exactly as it was written. */
const messageOf = (cwd, sha) => {
    const result = execGit(['log', '-1', '--format=%B', '--no-notes', '--end-of-options', sha], gitOpts(cwd));
    return result.code === 0 ? result.stdout : '';
};
/** Slicing at a code-unit boundary can orphan a surrogate; drop it if so. */
const truncateDiff = (diff) => {
    if (diff.length <= MAX_DIFF_BYTES)
        return diff;
    const cut = diff.slice(0, MAX_DIFF_BYTES);
    const safe = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
    return `${safe}${TRUNCATION_NOTE}`;
};
/**
 * The diff the commit introduced. First-parent for a merge, for the same reason
 * the indexer uses it: a merge shows no diff by default, and a record
 * reconstructed from nothing would be reconstructed from imagination.
 */
const diffOf = (cwd, sha) => {
    const result = execGit(['show', '--format=', '--patch', '--diff-merges=first-parent', '--no-notes', '--end-of-options', sha], { ...gitOpts(cwd), maxBuffer: DIFF_MAX_BUFFER });
    return result.code === 0 ? truncateDiff(result.stdout) : '';
};
/** Full object name for a possibly abbreviated sha, or `null` if it names nothing. */
const resolveCommit = (cwd, sha) => {
    const result = execGit(['rev-parse', '--verify', '--quiet', '--end-of-options', `${sha}^{commit}`], gitOpts(cwd));
    if (result.code !== 0)
        return null;
    const resolved = result.stdout.trim();
    return resolved === '' ? null : resolved;
};
const GH_MAX_BUFFER = 8 * 1024 * 1024;
const runGh = (args, cwd) => spawnSync('gh', args, {
    shell: false,
    encoding: 'utf8',
    cwd: cwd ?? process.cwd(),
    maxBuffer: GH_MAX_BUFFER,
});
const readPullRequests = (cwd, sha) => {
    const result = runGh(['pr', 'list', '--search', sha, '--state', 'all', '--limit', String(PR_LIMIT), '--json', 'number,title,body'], cwd);
    if (result.error !== undefined || result.status !== 0)
        return [];
    let parsed;
    try {
        parsed = JSON.parse(result.stdout ?? '[]');
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed))
        return [];
    return parsed.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null)
            return [];
        const row = entry;
        const number = typeof row['number'] === 'number' ? row['number'] : 0;
        const title = typeof row['title'] === 'string' ? row['title'] : '';
        const body = typeof row['body'] === 'string' ? row['body'] : '';
        if (body.trim() === '')
            return [];
        return [{ number, title, body }];
    });
};
/**
 * Establishes once whether `gh` can be used at all. An absent or unauthenticated
 * `gh` is a normal state of the world, not a failure: the run continues from
 * commit messages alone and says so. Requiring a GitHub login to backfill a
 * local repository would be a strange thing to demand.
 */
const pullRequestSource = (options) => {
    if (options.withPrs !== true) {
        return { available: false, reason: null, fetch: () => [] };
    }
    const probe = runGh(['auth', 'status'], options.cwd);
    if (probe.error !== undefined) {
        return {
            available: false,
            reason: 'the gh CLI is not installed or not on PATH',
            fetch: () => [],
        };
    }
    if (probe.status !== 0) {
        const line = (probe.stderr ?? '').split('\n').find((entry) => entry.trim() !== '') ?? '';
        return {
            available: false,
            reason: `gh is not authenticated${line === '' ? '' : ` (${line.trim()})`}`,
            fetch: () => [],
        };
    }
    return {
        available: true,
        reason: null,
        fetch: (sha) => readPullRequests(options.cwd, sha),
    };
};
// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
/**
 * The text a commit is reconstructed from, and the text the verifier will check
 * every quote against. Built by one function so the two are the same bytes: if
 * prompt generation and verification ever assembled sources differently, a
 * session's honest quote would be discarded and a verifier's judgement would be
 * about a document nobody read.
 *
 * That symmetry is why `--with-prs` has to be passed to both invocations. It is
 * also why a mismatch is safe rather than dangerous: the failure mode is a
 * discarded record, never an accepted one.
 */
export const collectSources = (cwd, sha, prs) => {
    const message = messageOf(cwd, sha).trimEnd();
    const parts = message === '' ? [] : [message];
    for (const pr of prs) {
        parts.push(`--- pull request #${pr.number}: ${pr.title} ---`, '', pr.body.trimEnd());
    }
    return { transcript: parts.length === 0 ? '' : `${parts.join('\n\n')}\n`, diff: diffOf(cwd, sha) };
};
export const estimateTokens = (text) => Math.ceil(text.length / CHARS_PER_TOKEN);
// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------
const knownKeys = new Set(KNOWN_KEYS);
/** A CommitLore key: one SPEC §3 defines, or an `X-` extension. */
const isRecordKey = (key) => knownKeys.has(key) || EXTENSION_KEY_RE.test(key);
/**
 * Commits that already carry a record, from the message or the mirror.
 *
 * A commit whose only trailer is something like `Signed-off-by:` has no
 * CommitLore record and is a legitimate target — the question is whether this
 * protocol has anything on the commit, not whether git found a trailer. Since
 * bug-issue-150, `scanTrailers` itself never returns a `Signed-off-by:` /
 * `Co-authored-by:` row at all (`types.ts` `CONVENTIONAL_TRAILER_KEYS`, a
 * denylist for a different question than `isRecordKey`'s allowlist answers
 * here); this check stays as the belt to that suspenders for any key this
 * protocol simply has not claimed yet.
 */
export const recordedShas = (cwd) => {
    const recorded = new Set();
    for (const trailer of scanTrailers({}, cwd === undefined ? {} : { cwd })) {
        if (isRecordKey(trailer.key))
            recorded.add(trailer.sha);
    }
    return recorded;
};
/**
 * The most recent commits with no record, newest first. Commits that already
 * carry one are skipped rather than revisited: a record is a claim somebody
 * made, and a reconstruction has no business replacing it.
 */
export const selectTargets = (options = {}) => {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const recorded = recordedShas(options.cwd);
    const shas = revList(options.cwd);
    const targets = [];
    let walked = 0;
    for (const sha of shas) {
        if (targets.length >= limit)
            return { targets, walked, recorded, truncated: true };
        walked += 1;
        if (recorded.has(sha))
            continue;
        targets.push({ sha, subject: subjectOf(options.cwd, sha) });
    }
    return { targets, walked, recorded, truncated: targets.length >= limit && shas.length > walked };
};
// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
const RULE = '='.repeat(78);
/**
 * The instruction that wraps the per-commit contracts. Each contract tells the
 * session to emit one bare JSON object; several of them in one prompt would be
 * several answers with nothing tying them to a commit, so the envelope names the
 * shape that does.
 */
export const buildEnvelope = (count, withPrs) => [
    `# CommitLore backfill — ${count} commit(s)`,
    '',
    'Each section below is one commit that is already in history, with its own',
    'self-contained instructions. Work through them one at a time.',
    '',
    'Combine your answers into a single JSON object:',
    '',
    '{',
    '  "commits": [',
    '    { "sha": "<the sha in that section\'s heading>", "records": [ ... ] }',
    '  ]',
    '}',
    '',
    '`records` is exactly the array its section asks for. A section you have',
    'nothing to record for takes `"records": []`, and that is the common answer.',
    '',
    'Write the object to a file and hand it back with:',
    '',
    '  commitlore backfill --draft <file>',
    ...(withPrs
        ? [
            '',
            'Pass --with-prs on that command too. The verifier rebuilds these sources',
            'from the repository, and rebuilding them without the pull request bodies',
            'means your quotes from those bodies will not be found.',
        ]
        : []),
    '',
    'Reconstruction is checked, not trusted: every record is re-read against the',
    'same text you were given, and anything whose quote is not there is discarded',
    'without a second attempt. What survives is stored with',
    '`Provenance: reconstructed`, whatever your draft says about provenance.',
    '',
].join('\n');
/**
 * The reconstruction preamble for one commit. It sits in front of the harvest
 * contract rather than replacing it: the vocabulary, the citation rules and the
 * output format are one thing with one home (T-403), and backfill differs from
 * harvest only in where the text came from and how thin it is.
 */
const preamble = (target) => [
    RULE,
    `## commit ${target.sha}`,
    `## ${target.subject === '' ? '(no subject)' : target.subject}`,
    RULE,
    '',
    'This commit was made before this repository kept records. You are',
    'reconstructing what survives of its context from the text below — the commit',
    'message, any linked pull request, and the diff. Nothing else about this',
    'commit is available to you, including anything you may know about this',
    'codebase from elsewhere.',
    '',
    'Backfill sources are thin, and thin sources are where a plausible-sounding',
    'reason gets invented. `{"records": []}` is the expected answer for most',
    'commits here and costs nothing. A reconstructed record that reads well and',
    'is wrong is read by an agent that cannot check it.',
    '',
    'The instructions that follow are the standard recording contract. Read',
    '"transcript" as "what survives of this commit".',
    '',
].join('\n');
export const buildBackfillPrompt = (target, sources) => `${preamble(target)}${buildHarvestPrompt(sources)}`;
// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------
/**
 * Strips whatever the draft said about provenance and states the truth.
 *
 * Applied before verification, not after, so that the record T-404 passes is the
 * record that reaches the mirror byte for byte — there is no window between "was
 * verified" and "was written" for a value to change in.
 */
export const forceReconstructed = (trailers) => [
    ...trailers.filter((trailer) => trailer.key !== 'Provenance'),
    { key: 'Provenance', value: 'reconstructed' },
];
let claimKeys = null;
/** SPEC §3.1 keys — what makes a record worth storing rather than bookkeeping. */
const claimKeySet = () => {
    if (claimKeys === null) {
        claimKeys = new Set(loadVocabulary().filter((entry) => entry.claim).map((entry) => entry.key));
    }
    return claimKeys;
};
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * Reads the envelope a session produced. Throws only for a document that cannot
 * be read as one — anything wrong with an individual commit's records is a skip
 * with a reason, because one bad entry must not cost the others.
 */
export const parseDraftDocument = (raw) => {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        const fenced = raw.trimStart().startsWith('```')
            ? ' — the draft is wrapped in a markdown code fence; emit bare JSON'
            : '';
        throw new Error(`draft is not valid JSON: ${errorMessage(error)}${fenced}`);
    }
    if (!isObject(parsed) || !Array.isArray(parsed['commits'])) {
        throw new Error('draft must be a JSON object with a "commits" array');
    }
    return parsed['commits'].map((entry, index) => {
        if (!isObject(entry))
            throw new Error(`commits[${index}] is not an object`);
        const sha = entry['sha'];
        if (typeof sha !== 'string' || sha.trim() === '') {
            throw new Error(`commits[${index}].sha is not a non-empty string`);
        }
        return { sha: sha.trim(), records: entry['records'] };
    });
};
const formatRejection = (rejection) => `record ${rejection.index} (${rejection.rule}): ${rejection.detail}`;
const readDraft = (path) => {
    if (path === undefined)
        throw new Error('--draft needs a path');
    try {
        return readFileSync(path, 'utf8');
    }
    catch (error) {
        throw new Error(`cannot read --draft ${JSON.stringify(path)}: ${errorMessage(error)}`);
    }
};
const chunked = (items, size) => {
    const batches = [];
    for (let start = 0; start < items.length; start += Math.max(1, size)) {
        batches.push(items.slice(start, start + Math.max(1, size)));
    }
    return batches;
};
const skip = (state, sha, reason, detail) => {
    state.report.skipped.push({ sha, reason, detail });
};
/**
 * Walks the targets in batches, stopping at the first of: the token budget, two
 * consecutive batches that produced nothing, or the end of the list. The caller
 * supplies what "produced" means for its mode; the termination argument is the
 * same either way and lives here rather than in each mode.
 */
const runBatches = (state, targets, batchSize, processBatch) => {
    let empty = 0;
    for (const batch of chunked(targets, batchSize)) {
        state.report.batches += 1;
        const produced = processBatch(batch);
        if (state.stopped !== null)
            return;
        if (produced > 0) {
            empty = 0;
            continue;
        }
        empty += 1;
        if (empty >= EMPTY_BATCH_LIMIT) {
            state.stopped = 'converged';
            return;
        }
    }
};
const promptMode = (state, options, targets, prs) => {
    const budget = options.budgetTokens;
    runBatches(state, targets, options.batchSize ?? DEFAULT_BATCH_SIZE, (batch) => {
        let produced = 0;
        for (const target of batch) {
            const found = prs.fetch(target.sha);
            state.report.pullRequests.collected += found.length;
            const sources = collectSources(options.cwd, target.sha, found);
            if (sources.transcript.trim() === '' && sources.diff.trim() === '') {
                skip(state, target.sha, 'no-source', 'the commit has no message, no pull request and no diff');
                continue;
            }
            const prompt = buildBackfillPrompt(target, sources);
            const tokens = estimateTokens(prompt);
            if (budget !== undefined && state.report.estimatedTokens + tokens > budget) {
                state.stopped = 'budget-tokens';
                return produced;
            }
            state.report.estimatedTokens += tokens;
            state.prompts.push({ sha: target.sha, subject: target.subject, prompt, estimatedTokens: tokens });
            state.report.prompts += 1;
            produced += 1;
        }
        return produced;
    });
};
/**
 * Turns one commit's drafted records into the trailer block that will be
 * written, or into a reason it will not be.
 *
 * Order is load-bearing: format check (T-403), then forced provenance, then
 * truth check (T-404), then a last validation of the exact assembled block.
 * Every trailer that survives to the mirror came out of a record the verifier
 * accepted, and the only trailer this module adds is the one it is required to.
 */
const assembleRecord = (state, sha, entry, sources) => {
    let review;
    try {
        review = parseDraft(JSON.stringify({ records: entry.records }));
    }
    catch (error) {
        skip(state, sha, 'draft-format', errorMessage(error));
        return null;
    }
    for (const rejection of review.rejected) {
        skip(state, sha, 'draft-format', formatRejection(rejection));
    }
    if (review.records.length === 0)
        return null;
    const forced = review.records.map((record) => ({
        trailers: forceReconstructed(record.trailers),
        evidence: record.evidence,
    }));
    const verified = verifyDraft(forced, sources);
    for (const rejected of verified.rejected) {
        state.report.discarded.push({ sha, reason: rejected.reason, detail: rejected.detail });
    }
    if (verified.accepted.length === 0)
        return null;
    const trailers = forceReconstructed(verified.accepted.flatMap((entryRecord) => entryRecord.record.trailers));
    const violations = validateRecord(trailers);
    if (violations.length > 0) {
        skip(state, sha, 'invalid-record', `the assembled record is not valid: ${violations
            .map((violation) => `${violation.key} (${violation.rule}, want ${violation.want})`)
            .join('; ')}`);
        return null;
    }
    const claims = claimKeySet();
    if (!trailers.some((trailer) => claims.has(trailer.key))) {
        skip(state, sha, 'invalid-record', 'the assembled record carries no decision context');
        return null;
    }
    return trailers;
};
const applyMode = (state, options, targets, recorded, prs, raw) => {
    const entries = new Map();
    const targetShas = new Set(targets.map((target) => target.sha));
    for (const entry of parseDraftDocument(raw)) {
        const sha = resolveCommit(options.cwd, entry.sha);
        if (sha === null) {
            skip(state, entry.sha, 'unknown-commit', 'this repository has no such commit');
            continue;
        }
        if (entries.has(sha)) {
            skip(state, sha, 'duplicate-sha', 'the draft names this commit more than once');
            continue;
        }
        if (recorded.has(sha)) {
            skip(state, sha, 'already-recorded', 'the commit already carries a record; backfill never replaces one');
            continue;
        }
        if (!targetShas.has(sha)) {
            skip(state, sha, 'not-a-target', 'the commit is outside the selected targets — raise --limit to include it');
            continue;
        }
        entries.set(sha, entry);
    }
    runBatches(state, targets, options.batchSize ?? DEFAULT_BATCH_SIZE, (batch) => {
        let produced = 0;
        for (const target of batch) {
            const entry = entries.get(target.sha);
            /* A target the session recorded nothing for is the expected case, not a
               skip: the contract says so in as many words. */
            if (entry === undefined)
                continue;
            const found = prs.fetch(target.sha);
            state.report.pullRequests.collected += found.length;
            const sources = collectSources(options.cwd, target.sha, found);
            const trailers = assembleRecord(state, target.sha, entry, sources);
            if (trailers === null)
                continue;
            state.report.estimatedTokens += estimateTokens(sources.transcript) + estimateTokens(sources.diff);
            if (options.dryRun !== true) {
                try {
                    writeRecord(target.sha, trailers, gitOpts(options.cwd));
                }
                catch (error) {
                    skip(state, target.sha, 'write-failed', errorMessage(error));
                    continue;
                }
            }
            state.report.attached += 1;
            produced += 1;
        }
        return produced;
    });
};
/**
 * Brings the index up to date so a freshly backfilled record is queryable
 * without a second command. The index is derived (ADR-0003), so failing to
 * update it is reported and never fatal — the records are already in git.
 */
const refreshIndex = (options) => {
    if (options.dryRun === true) {
        return { updated: false, commitsScanned: 0, trailersIndexed: 0, noteTrailersIndexed: 0, reason: '--dry-run' };
    }
    try {
        const handle = openIndex(options.cwd === undefined ? {} : { cwd: options.cwd });
        try {
            const stats = updateIndex(handle);
            return {
                updated: true,
                commitsScanned: stats.commitsScanned,
                trailersIndexed: stats.trailersIndexed,
                noteTrailersIndexed: stats.noteTrailersIndexed,
                reason: null,
            };
        }
        finally {
            closeIndex(handle);
        }
    }
    catch (error) {
        return {
            updated: false,
            commitsScanned: 0,
            trailersIndexed: 0,
            noteTrailersIndexed: 0,
            reason: errorMessage(error),
        };
    }
};
const emptyReport = (mode, options) => ({
    mode,
    dryRun: options.dryRun === true,
    commitsWalked: 0,
    recorded: 0,
    targets: 0,
    batches: 0,
    prompts: 0,
    attached: 0,
    discarded: [],
    skipped: [],
    estimatedTokens: 0,
    stoppedBy: 'exhausted',
    limit: options.limit ?? DEFAULT_LIMIT,
    budgetTokens: options.budgetTokens ?? null,
    pullRequests: {
        requested: options.withPrs === true,
        available: false,
        reason: null,
        collected: 0,
    },
    index: null,
});
const modeOf = (options) => {
    if (options.draft !== undefined)
        return 'apply';
    return options.promptOnly === true ? 'prompt-only' : 'index-only';
};
/**
 * Runs a backfill.
 *
 * Throws only for what the user got wrong — mutually exclusive flags, a draft
 * that is not a draft. Everything a repository can be found to be is a reported
 * outcome, because a cold-start command that fails on a repository's actual
 * shape is a command nobody runs twice.
 */
export const backfill = (options = {}) => {
    if (options.promptOnly === true && options.draft !== undefined) {
        throw new Error('--prompt-only and --draft are mutually exclusive');
    }
    const limit = options.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 0) {
        throw new Error(`--limit is not a non-negative integer: ${String(options.limit)}`);
    }
    const budget = options.budgetTokens;
    if (budget !== undefined && (!Number.isInteger(budget) || budget < 0)) {
        throw new Error(`--budget-tokens is not a non-negative integer: ${String(budget)}`);
    }
    const mode = modeOf(options);
    const state = { report: emptyReport(mode, options), prompts: [], stopped: null };
    const selection = selectTargets(options);
    state.report.commitsWalked = selection.walked;
    state.report.recorded = selection.recorded.size;
    state.report.targets = selection.targets.length;
    if (mode === 'index-only') {
        /* No model, so no reconstruction is attempted. Indexing the commits that
           already carry trailers is the whole of what can be done without one, and
           it is worth doing (PRD-F8 요구 4). */
        state.report.stoppedBy = selection.truncated ? 'limit' : 'exhausted';
        state.report.index = refreshIndex(options);
        return { report: state.report, prompts: [] };
    }
    const prs = pullRequestSource(options);
    state.report.pullRequests.available = prs.available;
    state.report.pullRequests.reason = prs.reason;
    if (mode === 'prompt-only') {
        promptMode(state, options, selection.targets, prs);
    }
    else {
        applyMode(state, options, selection.targets, selection.recorded, prs, readDraft(options.draft));
        if (state.report.attached > 0)
            state.report.index = refreshIndex(options);
    }
    state.report.stoppedBy = state.stopped ?? (selection.truncated ? 'limit' : 'exhausted');
    return { report: state.report, prompts: state.prompts };
};
//# sourceMappingURL=backfill.js.map