/**
 * Historical, read-only capture measurement.
 *
 * A historical commit cannot carry the transcript an agent had before it was
 * made. Shadow therefore substitutes the surviving commit message and the
 * first-parent patch, then runs the ordinary prepare and verify phases entirely
 * in memory. It is deliberately a measurement aid, not a new way to publish a
 * record.
 */

import { execGit } from './git.js';
import {
  prepareCaptureContextReadOnly,
  type HistoricalCaptureSnapshot,
} from './capture-prepare.js';
import {
  captureCanonicalTuple,
  verifyCaptureRecordsReadOnly,
  type CaptureVerificationHistory,
} from './capture-verify.js';
import { parseDraft, type DraftRecord, type EvidenceSource } from './harvest.js';
import { scanForSecrets, type SecretFinding } from './secret-guard.js';
import { foldLifecycle, type StaleRecord } from './stale.js';
import { serializeTrailers } from './trailers.js';
import { isCommitLoreKey, isConventionalTrailerKey, KNOWN_KEYS, type Trailer } from './types.js';

const MAX_DIFF_BYTES = 64 * 1024;
const DIFF_MAX_BUFFER = 256 * 1024 * 1024;
const RECORD_SEP = '\x01';
const FIELD_SEP = '\0';
const TRAILER_SEP = '\x1e';
const KV_SEP = '\x1f';
const RECORD_HEADER_RE = /^[0-9a-f]{40,64}\0/;
const SYNTHETIC_HISTORY_ID = '\0shadow-history:';

/** Text displayed in every report, so the number is not mistaken for a replay. */
export const SHADOW_APPROXIMATION =
  'Historical commits have no live capture transcript. Shadow substitutes the committed message and ' +
  'the commit\'s first-parent patch, then its conservative draft adapter nominates only explicit decision ' +
  'language. Duplicate checks use commit-message records visible earlier in the Git history walk and the ' +
  'policy resolved now, not a historical policy snapshot. This is an approximation, not a replay of the ' +
  'historical agent judgment.';

/** The writes the runner explicitly routes around. */
export const SHADOW_READ_ONLY_GUARANTEE =
  'Prepare and verify run in memory. Shadow does not call createPending (which creates a pending file), ' +
  'storeVerification (which advances it), or stageCaptureRecord (which stages it); guard and duplicate ' +
  'checks use Git scans instead of the derived index. Its non-blocking guard advisory is omitted because it ' +
  'cannot change whether a candidate is recorded.';

export interface ShadowCommitResult {
  sha: string;
  subject: string;
  /** True when prepare and verify accepted a record, before secret-guard blocks publication. */
  would_record: boolean;
  /** `blocked` records are intentionally withheld from this result's `record` field. */
  secret_guard: 'clear' | 'blocked' | 'not-run';
  /** Canonical trailer block, present only for an unblocked accepted record. */
  record?: string;
  /** Why no record survived, in the draft adapter's or verifier's own words. */
  silence_reason?: string;
  /** Redacted secret-guard findings for a withheld record. */
  secret_findings?: SecretFinding[];
}

export interface ShadowSummary {
  commits_examined: number;
  would_record: number;
  blocked: number;
  silence: number;
  silence_rate: number;
  approximation: string;
  read_only: string;
}

export interface CaptureShadowResult {
  commits: ShadowCommitResult[];
  summary: ShadowSummary;
}

export interface CaptureShadowOptions {
  cwd: string;
  /** The exclusive lower bound, exactly as `git rev-list <rev>..HEAD` reads it. */
  since: string;
}

interface HistoricalSources {
  transcript: string;
  diff: string;
  snapshot: HistoricalCaptureSnapshot;
}

interface HistoricalCommit {
  sha: string;
  subject: string;
  sources: HistoricalSources | null;
}

interface Candidate {
  record: DraftRecord;
  reason: string;
}

interface HistoricalRecord {
  sha: string;
  committedAt: string;
  trailers: Trailer[];
}

const gitOutput = (args: string[], cwd: string): string => {
  const result = execGit(args, { cwd, maxBuffer: DIFF_MAX_BUFFER });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
};

/** Restore a record when a trailer value itself contains the record separator. */
const splitGitRecords = (stdout: string): string[] => {
  const records: string[] = [];
  for (const chunk of stdout.split(RECORD_SEP)) {
    if (RECORD_HEADER_RE.test(chunk)) {
      records.push(chunk);
      continue;
    }
    const previous = records.length - 1;
    if (previous !== -1) records[previous] = `${records[previous]}${RECORD_SEP}${chunk}`;
  }
  return records;
};

/** Git has already decided the trailer boundary; this only decodes its atom. */
const parseTrailerField = (field: string): Trailer[] => {
  if (field === '') return [];
  return field.split(TRAILER_SEP).map((entry) => {
    const at = entry.indexOf(KV_SEP);
    return at === -1
      ? { key: entry, value: '' }
      : { key: entry.slice(0, at), value: entry.slice(at + 1) };
  });
};

/**
 * Read just the verifier's duplicate-check input in one Git pass. `runQuery`
 * also reads paths and recovers every display block; neither can affect the
 * two identity sets verify consumes. Notes are truth too, so a populated
 * mirror deliberately returns null rather than silently omit it.
 */
const readHistoricalRecords = (cwd: string): HistoricalRecord[] | null => {
  const notes = execGit(['notes', '--ref=refs/notes/commitlore', 'list'], { cwd });
  if (notes.code !== 0 || notes.stdout.trim() !== '') return null;

  const output = gitOutput(
    [
      '-c',
      'trailer.separators=:',
      'log',
      '--reverse',
      '--no-notes',
      '--format=%x01%H%x00%cI%x00%(trailers:only=true,unfold=true,key_value_separator=%x1f,separator=%x1e)%x00',
      'HEAD',
    ],
    cwd,
  );

  return splitGitRecords(output).flatMap((record) => {
    const [sha, committedAt, trailerField = ''] = record.split(FIELD_SEP);
    if (sha === undefined || committedAt === undefined) return [];
    const trailers = parseTrailerField(trailerField)
      .filter((trailer) => !isConventionalTrailerKey(trailer.key));
    if (!trailers.some((trailer) => isCommitLoreKey(trailer.key))) return [];
    return [{ sha, committedAt, trailers }];
  });
};

/** Build the historical identity and active-content sets the ordinary verifier accepts. */
const verificationHistory = (records: readonly HistoricalRecord[]): CaptureVerificationHistory => {
  const recordIds = new Set<string>();
  const stream: StaleRecord[] = records.map((record, index) => {
    const id = record.trailers.find((trailer) => trailer.key === 'Record-Id')?.value;
    if (id !== undefined) recordIds.add(id);
    return {
      sha: record.sha,
      committedAt: record.committedAt,
      trailers:
        id === undefined
          ? [{ key: 'Record-Id', value: `${SYNTHETIC_HISTORY_ID}${record.sha}:${index}` }, ...record.trailers]
          : record.trailers,
    };
  });
  const activeCanonicalTuples = new Set<string>();
  for (const state of foldLifecycle(stream, { at: new Date() })) {
    if (state.lifecycle !== 'active') continue;
    const tuple = captureCanonicalTuple(state.resolvedTrailers);
    if (tuple !== '') activeCanonicalTuples.add(tuple);
  }
  return { recordIds, activeCanonicalTuples, incomplete: false };
};

/** The ordinary verifier sees only records made before the commit being replayed. */
const historiesBeforeCommit = (
  cwd: string,
): Map<string, CaptureVerificationHistory> | null => {
  const records = readHistoricalRecords(cwd);
  if (records === null) return null;
  const bySha = new Map<string, HistoricalRecord[]>();
  for (const record of records) {
    const entries = bySha.get(record.sha) ?? [];
    entries.push(record);
    bySha.set(record.sha, entries);
  }
  const shas = gitOutput(['rev-list', '--reverse', 'HEAD'], cwd)
    .split('\n')
    .filter((sha) => /^[0-9a-f]{40}$/.test(sha));
  const prior: HistoricalRecord[] = [];
  const histories = new Map<string, CaptureVerificationHistory>();
  for (const sha of shas) {
    histories.set(sha, verificationHistory(prior));
    prior.push(...(bySha.get(sha) ?? []));
  }
  return histories;
};

const truncateDiff = (diff: string): string => {
  if (diff.length <= MAX_DIFF_BYTES) return diff;
  const cut = diff.slice(0, MAX_DIFF_BYTES);
  const safe = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  return `${safe}\n[commitlore: historical patch truncated at ${MAX_DIFF_BYTES} bytes]\n`;
};

const historicalCommits = (cwd: string, since: string): HistoricalCommit[] => {
  const resolved = gitOutput(
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${since}^{commit}`],
    cwd,
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(resolved)) {
    throw new Error(`--since does not name a commit: ${JSON.stringify(since)}`);
  }

  const range = `${resolved}..HEAD`;
  const metadata = gitOutput(
    [
      'log',
      '--reverse',
      '--no-notes',
      '--format=%x01%H%x00%s%x00%P%x00%T%x00%B%x00',
      '--end-of-options',
      range,
    ],
    cwd,
  );
  const patches = gitOutput(
    [
      'log',
      '--reverse',
      '--no-notes',
      '--patch',
      '--diff-merges=first-parent',
      '--format=%x01%H%x00',
      '--end-of-options',
      range,
    ],
    cwd,
  );
  const patchesBySha = new Map<string, string>();
  for (const record of splitGitRecords(patches)) {
    const separator = record.indexOf(FIELD_SEP);
    if (separator === -1) continue;
    const sha = record.slice(0, separator);
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;
    patchesBySha.set(sha, truncateDiff(record.slice(separator + 1)));
  }

  return splitGitRecords(metadata).flatMap((record): HistoricalCommit[] => {
    const [sha, subject, parents, tree, message] = record.split(FIELD_SEP);
    if (sha === undefined || subject === undefined || parents === undefined || tree === undefined || message === undefined) return [];
    const baseHead = parents.split(' ')[0] ?? '';
    if (!/^[0-9a-f]{40}$/.test(sha)) return [];
    if (!/^[0-9a-f]{40}$/.test(baseHead) || !/^[0-9a-f]{40}$/.test(tree)) {
      return [{ sha, subject: displaySubject(subject), sources: null }];
    }
    const diff = patchesBySha.get(sha) ?? '';
    return [{
      sha,
      subject: displaySubject(subject),
      sources: {
        transcript: message,
        diff,
        snapshot: { base_head: baseHead, staged_diff: diff, staged_tree_oid: tree },
      },
    }];
  });
};

const sourceLine = (
  source: EvidenceSource,
  quote: string,
  locator: string,
): Pick<DraftRecord, 'evidence'>['evidence'][number] => ({
  key: 'Limit',
  source,
  quote,
  locator,
});

const recordIdFor = (sha: string): string => `r-shadow${sha.slice(0, 16)}`;

/** A blocked record must not re-leak a credential through its commit subject. */
const displaySubject = (subject: string): string =>
  scanForSecrets(subject).length === 0 ? subject : '[subject withheld: secret-guard match]';

const directDecision = (sha: string, diff: string): Candidate | null => {
  let hunk = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      hunk = line;
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const content = line.slice(1);
    const match = /^(Limit|Ruled-out|Warn|Unverified):\s+(.+)$/.exec(content);
    if (match === null) continue;
    const [, key = '', value = ''] = match;
    if (key === '' || value === '' || hunk === '') continue;
    return {
      record: {
        trailers: [
          { key, value },
          { key: 'Record-Id', value: recordIdFor(sha) },
        ],
        evidence: [{ ...sourceLine('diff', value, hunk), key }],
      },
      reason: 'the historical patch contains an explicit decision trailer-shaped line',
    };
  }
  return null;
};

const DECISION_CUE =
  /\b(?:decided|decide|chose|chosen|ruled out|rejected|must not|do not|don't|never|cannot|can't|constraint|limited by|because)\b/i;

const isKnownTrailerLine = (line: string): boolean =>
  (KNOWN_KEYS as readonly string[]).some((key) => line.startsWith(`${key}:`));

const inferredDecision = (sha: string, transcript: string, diff: string): Candidate | null => {
  const transcriptLines = transcript.split('\n');
  for (const [index, line] of transcriptLines.entries()) {
    const text = line.trim();
    if (text === '' || isKnownTrailerLine(text) || text.length > 500 || !DECISION_CUE.test(text)) continue;
    return {
      record: {
        trailers: [
          { key: 'Limit', value: text },
          { key: 'Record-Id', value: recordIdFor(sha) },
        ],
        evidence: [sourceLine('transcript', text, `L${index + 1}-L${index + 1}`)],
      },
      reason: 'the historical commit message contains explicit decision language',
    };
  }

  let hunk = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      hunk = line;
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++') || hunk === '') continue;
    const text = line.slice(1).trim();
    if (text === '' || isKnownTrailerLine(text) || text.length > 500 || !DECISION_CUE.test(text)) continue;
    return {
      record: {
        trailers: [
          { key: 'Limit', value: text },
          { key: 'Record-Id', value: recordIdFor(sha) },
        ],
        evidence: [sourceLine('diff', line.slice(1), hunk)],
      },
      reason: 'the historical patch contains explicit decision language',
    };
  }

  return null;
};

const candidateFor = (sha: string, transcript: string, diff: string): Candidate | null =>
  directDecision(sha, diff) ?? inferredDecision(sha, transcript, diff);

const silence = (sha: string, subject: string, reason: string): ShadowCommitResult => ({
  sha,
  subject,
  would_record: false,
  secret_guard: 'not-run',
  silence_reason: reason,
});

const shadowOne = (
  cwd: string,
  commit: HistoricalCommit,
  history: CaptureVerificationHistory | null,
): ShadowCommitResult => {
  const { sha, subject, sources } = commit;
  if (sources === null) {
    return silence(sha, subject, 'capture requires a base HEAD; this root commit has no parent to replay');
  }

  let prepared;
  try {
    prepared = prepareCaptureContextReadOnly({
      cwd,
      transcript: sources.transcript,
      snapshot: sources.snapshot,
      skipGuard: true,
    });
  } catch (error) {
    return silence(sha, subject, error instanceof Error ? error.message : String(error));
  }

  const candidate = candidateFor(sha, sources.transcript, sources.diff);
  const reviewed = parseDraft(
    JSON.stringify({ records: candidate === null ? [] : [candidate.record] }),
  );
  const verified = verifyCaptureRecordsReadOnly({
    nonce: prepared.nonce,
    pending: prepared.pending,
    draft: reviewed.records,
    transcript: sources.transcript,
    diff: sources.diff,
    cwd,
    history,
  });

  if (verified.accepted.length === 0) {
    const parsed = reviewed.rejected[0];
    const rejected = verified.rejected[0];
    return silence(
      sha,
      subject,
      candidate === null
        ? 'the shadow draft contained {"records": []}: no explicit decision language survived in the historical message or patch'
        : parsed !== undefined
          ? `draft parser rejected it (${parsed.rule}): ${parsed.detail}`
          : rejected !== undefined
            ? `verifier rejected it (${rejected.reason}): ${rejected.detail}`
            : verified.incomplete
              ? 'verifier could not form a complete read-only duplicate history (a populated notes mirror is not omitted)'
            : 'verifier returned an empty result',
    );
  }

  const record = serializeTrailers(verified.accepted[0]!.record.trailers);
  const findings = scanForSecrets(record);
  if (findings.length > 0) {
    return {
      sha,
      subject,
      would_record: true,
      secret_guard: 'blocked',
      secret_findings: findings,
    };
  }

  return { sha, subject, would_record: true, secret_guard: 'clear', record };
};

/**
 * Run a historical capture measurement. This function never stages, commits,
 * writes a pending file, updates an index, or modifies the inspected repository.
 */
export const runCaptureShadow = (opts: CaptureShadowOptions): CaptureShadowResult => {
  const histories = historiesBeforeCommit(opts.cwd);
  const commits = historicalCommits(opts.cwd, opts.since).map((commit) =>
    shadowOne(opts.cwd, commit, histories?.get(commit.sha) ?? null),
  );
  const wouldRecord = commits.filter((commit) => commit.would_record).length;
  const blocked = commits.filter((commit) => commit.secret_guard === 'blocked').length;
  const silenceCount = commits.length - wouldRecord;

  return {
    commits,
    summary: {
      commits_examined: commits.length,
      would_record: wouldRecord,
      blocked,
      silence: silenceCount,
      silence_rate: commits.length === 0 ? 0 : silenceCount / commits.length,
      approximation: SHADOW_APPROXIMATION,
      read_only: SHADOW_READ_ONLY_GUARANTEE,
    },
  };
};
