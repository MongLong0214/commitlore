/**
 * A real measurement of the optional Jev prototype — #1051 §4.
 *
 * The synthetic check in `jev-live.mjs` establishes that the wire contract
 * holds. It says nothing about whether the prototype selects the right
 * passages, and this file is the attempt to say something about that — with its
 * weaknesses stated rather than discovered later.
 *
 *   COMMITLORE_JEV_API_KEY=... node bench/jev-accuracy.mjs [--n 40] [--out <dir>]
 *
 * ## The design, and why the labels are trustworthy
 *
 * Every case is a real commit from this repository's own history. The **prose
 * body** of the commit — everything above the trailer block — is the source
 * text. The **trailers the commit actually carries** are the reference: they
 * were written by the author at the time, in this repository's own workflow,
 * years of commits before this prototype existed. So the labels genuinely
 * predate the outputs, which is the property a reference needs and the one that
 * is hardest to get honestly.
 *
 * Negative cases are real too: commits that carry no `Limit:`, `Warn:` or
 * `Ruled-out:` at all. For those the reference is "produce nothing".
 *
 * Sampling is deterministic and declared before the run: the most recent
 * commits of each class, in `git log` order, no selection by content and no
 * re-rolling. The saved report records the exact SHAs.
 *
 * ## What this measurement is biased toward, stated up front
 *
 * - **Commit prose is not a conversation.** It is already distilled writing
 *   about a decision, by an author who had decided to record one. A real
 *   transcript is longer, noisier and mostly about something else. This
 *   overstates how well the prototype does on the input it actually receives,
 *   and there is no way to correct for it here.
 * - **The record was often written from the same sentences.** The trailer value
 *   and the prose frequently share phrasing, so a passage that "matches" may be
 *   matching its own source. Precision here is an upper bound.
 * - **Relevance has no hard negatives.** A commit's own record applies to that
 *   commit's own change by construction, so the `unrelated` branch is exercised
 *   only by the negative pool.
 * - **One repository, one author's style, one annotator.** The labels are the
 *   repository's, and the repository is this project's. Nothing here
 *   generalises to another codebase.
 *
 * None of that is a reason not to measure. It is the reason the numbers below
 * are reported with it attached.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveJevActivation } from '../dist/jev/activation.js';
import { askJev } from '../dist/jev/client.js';
import { assembleDrafts, planDiscovery } from '../dist/jev/discover.js';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};

/** Declared before the run. The harness refuses to exceed it. */
const MAX_REQUESTS = Number(arg('--budget', '80'));
const POSITIVES = Number(arg('--n', '40'));
const NEGATIVES = Number(arg('--negatives', '20'));
const SCAN = 600;

/**
 * How much of the commit's diff goes into the state.
 *
 * A knob rather than a constant because jev-1.13's documented failure modes
 * include "large irrelevant state", and the confidence a run reports is
 * uninterpretable without knowing whether the state size is driving it.
 * Running the same commits at two sizes is the control that separates "the
 * model cannot do this" from "we sent too much".
 */
const DIFF_BYTES = Number(arg('--diff-bytes', '3000'));

const CONTENT_KEYS = ['Limit', 'Warn', 'Ruled-out'];

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

/**
 * Splits a commit message into the prose a human wrote and the record it
 * declared.
 *
 * The trailer block is the final paragraph. Anything above it is prose; the
 * keys inside it are the reference. A `Closes #N` line is dropped from the
 * prose so the reference cannot leak in through an issue number.
 */
const split = (message) => {
  const paragraphs = message.replace(/\r\n/g, '\n').split(/\n{2,}/);
  // Trailing empties first. A commit message ends `\n\n` here, so `at(-1)` is
  // the empty string and the trailer block is the one before it — measured:
  // the unstripped version found 2 record-bearing commits in 600 where a
  // whole-message grep finds 246.
  while (paragraphs.length > 0 && (paragraphs.at(-1) ?? '').trim() === '') paragraphs.pop();
  const trailerBlock = paragraphs.at(-1) ?? '';
  const keys = new Set();
  for (const line of trailerBlock.split('\n')) {
    const match = /^([A-Za-z][A-Za-z-]*): /.exec(line);
    if (match && CONTENT_KEYS.includes(match[1])) keys.add(match[1]);
  }
  const prose = paragraphs
    .slice(0, -1)
    .join('\n\n')
    .split('\n')
    .filter((line) => !/^(Closes|Fixes|Resolves)\s+#/i.test(line.trim()))
    .join('\n')
    .trim();
  return { prose, keys: [...keys].sort(), trailerBlock };
};

const sourceOf = (prose) => {
  // One block, as a `user` turn: the prose is what a person wrote about the
  // change, which is the closest this material comes to a conversation turn.
  const header = 'user:\n';
  const text = `${header}${prose}\n\n`;
  const bytes = Buffer.byteLength(text, 'utf8');
  return {
    host: 'claude-code',
    sessionId: 'bench',
    worktree: '/bench',
    gitdir: '/bench/.git',
    path: '/bench/transcript.jsonl',
    digest: '0'.repeat(64),
    windowFrom: 0,
    windowTo: bytes,
    size: bytes,
    mtimeMs: 0,
    text,
    blocks: [
      {
        id: 'b0',
        role: 'user',
        start: header.length,
        end: header.length + prose.length,
        startLine: 2,
        endLine: 1 + prose.split('\n').length,
        complete: true,
      },
    ],
    coverage: {
      recordsInspected: 1,
      recordsOmitted: 0,
      unknownForms: 0,
      bytesInspected: bytes,
      bytesTotal: bytes,
      complete: true,
    },
  };
};

const wilson = (successes, total) => {
  if (total === 0) return null;
  const z = 1.959963985;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return {
    point: p,
    low: (centre - spread) / denominator,
    high: (centre + spread) / denominator,
  };
};

const main = async () => {
  const activation = resolveJevActivation(process.env);
  if (!activation.enabled) {
    process.stderr.write(
      'jev-accuracy: not enabled. Set COMMITLORE_JEV_API_KEY. This run spends money and sends ' +
        "this repository's own public commit prose to TypeSafe.\n",
    );
    process.exitCode = 2;
    return;
  }

  // Deterministic and declared: the most recent commits of each class, in
  // `git log` order. No selection by content, no re-rolling.
  const shas = git(['log', '--format=%H', `-${String(SCAN)}`, 'main']).trim().split('\n');
  const positives = [];
  const negatives = [];
  for (const sha of shas) {
    if (positives.length >= POSITIVES && negatives.length >= NEGATIVES) break;
    const message = git(['show', '--no-patch', '--format=%B', '--end-of-options', sha]);
    const { prose, keys } = split(message);
    // Too short to hold a decision, or a merge commit with no body: neither
    // class, and excluded before any call so the exclusion cannot follow a result.
    if (prose.length < 200) continue;
    const names = git(['show', '--name-only', '--format=', '--end-of-options', sha])
      .trim()
      .split('\n')
      .filter((line) => line !== '')
      .slice(0, 12);
    if (names.length === 0) continue;
    const diff = git(['show', '--format=', '--unified=3', '--end-of-options', sha]).slice(0, DIFF_BYTES);

    const entry = { sha, prose, keys, paths: names, diff };
    if (keys.length > 0 && positives.length < POSITIVES) positives.push(entry);
    else if (keys.length === 0 && negatives.length < NEGATIVES) negatives.push(entry);
  }

  const cases = [
    ...positives.map((entry) => ({ ...entry, expectRecord: true })),
    ...negatives.map((entry) => ({ ...entry, expectRecord: false })),
  ];

  const rows = [];
  let requests = 0;
  for (const testCase of cases) {
    const source = sourceOf(testCase.prose);
    const plan = planDiscovery(source, {
      paths: testCase.paths,
      diffExcerpt: testCase.diff,
    });
    if (plan.questions.length === 0) {
      rows.push({
        sha: testCase.sha.slice(0, 8),
        expectRecord: testCase.expectRecord,
        referenceKeys: testCase.keys,
        status: 'unexecuted',
        reason: 'no candidates enumerated',
      });
      continue;
    }
    if (requests >= MAX_REQUESTS) {
      rows.push({
        sha: testCase.sha.slice(0, 8),
        expectRecord: testCase.expectRecord,
        referenceKeys: testCase.keys,
        status: 'unexecuted',
        reason: 'request budget exhausted',
      });
      continue;
    }

    requests += 1;
    const outcome = await askJev({
      key: activation.key,
      state: plan.state,
      questions: plan.questions,
    });
    const assembled = assembleDrafts({ plan, outcome, recordCap: 1 });
    const produced = assembled.records.flatMap((record) => record.trailers);
    const producedKeys = [...new Set(produced.map((trailer) => trailer.key))].sort();

    /*
     * Where the answers actually land.
     *
     * "0% recall" on its own says nothing about whether the model disagreed or
     * whether a threshold refused it. Recording the confidence distribution
     * separates those: a `kind` answer of `limit` at 0.71 is the model agreeing
     * and the floor declining to act, which is a policy result rather than a
     * model result.
     */
    const kindAnswers = [];
    if (outcome.status === 'answered') {
      for (const candidate of plan.candidates) {
        const kind = outcome.answers.get(`kind:${candidate.id}`);
        const relevance = outcome.answers.get(`relevance:${candidate.id}`);
        if (kind === undefined) continue;
        kindAnswers.push({
          candidate: candidate.id,
          kind: kind.choice,
          kindConfidence: kind.confidence,
          relevance: relevance?.choice ?? null,
          relevanceConfidence: relevance?.confidence ?? null,
        });
      }
    }

    rows.push({
      sha: testCase.sha.slice(0, 8),
      status: outcome.status,
      expectRecord: testCase.expectRecord,
      referenceKeys: testCase.keys,
      producedKeys,
      producedRecord: produced.length > 0,
      // A produced record whose key the commit also declared. The weakest
      // useful agreement: it does not check that the two describe the same
      // decision, only that the kind matches something the author recorded.
      keyAgrees: producedKeys.some((key) => testCase.keys.includes(key)),
      values: produced.map((trailer) => `${trailer.key}: ${trailer.value}`),
      skipped: assembled.outcomes.filter((entry) => !entry.kept).map((entry) => entry.reason),
      kindAnswers,
      usage: outcome.usage,
    });
  }

  const answered = rows.filter((row) => row.status === 'answered');
  const pos = answered.filter((row) => row.expectRecord);
  const neg = answered.filter((row) => !row.expectRecord);

  const truePositive = pos.filter((row) => row.producedRecord).length;
  const keyMatch = pos.filter((row) => row.keyAgrees).length;
  const falsePositive = neg.filter((row) => row.producedRecord).length;

  /*
   * The confidence picture, over every answer the model gave about a candidate
   * in a commit that did record something.
   *
   * `agreeing` is the subset where the model said `limit`, `warn` or
   * `ruled_out` — that is, where it and the author agree that the passage is a
   * decision — regardless of whether the floor let it act.
   */
  const positiveAnswers = pos.flatMap((row) => row.kindAnswers ?? []);
  const agreeing = positiveAnswers.filter((entry) =>
    ['limit', 'warn', 'ruled_out'].includes(entry.kind),
  );
  const confidences = agreeing.map((entry) => entry.kindConfidence).sort((a, b) => a - b);
  const quantile = (q) =>
    confidences.length === 0
      ? null
      : confidences[Math.min(confidences.length - 1, Math.floor(q * confidences.length))];
  const aboveFloor = agreeing.filter((entry) => entry.kindConfidence >= 0.9).length;

  const knownTokens = rows.reduce(
    (total, row) => (row.usage?.inputTokens == null ? total : total + row.usage.inputTokens),
    0,
  );

  const report = {
    ranAt: new Date().toISOString(),
    design:
      "each case is a real commit from this repository's history; the source is the commit's prose " +
      'body and the reference is the trailer block the author wrote at the time, before this ' +
      'prototype existed',
    sampling: `most recent commits in git log order over the last ${String(SCAN)}, no selection by content`,
    diffBytes: DIFF_BYTES,
    budget: { max: MAX_REQUESTS, used: requests },
    biases: [
      'commit prose is distilled writing about a decision, not a conversation — this overstates performance on the input the prototype actually receives',
      'the trailer was often written from the same sentences, so a match may be matching its own source; treat precision as an upper bound',
      'relevance has no hard negatives: a commit\'s record applies to its own change by construction',
      'one repository, one project\'s style, labels from that repository',
    ],
    totals: {
      cases: cases.length,
      answered: answered.length,
      unexecuted: rows.filter((row) => row.status === 'unexecuted').length,
      positives: pos.length,
      negatives: neg.length,
      recordedOnPositive: truePositive,
      keyMatchedOnPositive: keyMatch,
      recordedOnNegative: falsePositive,
      knownInputTokens: knownTokens,
      estimatedUsd: knownTokens * (0.042 / 1e6),
      estimateNote: 'dated price $0.042 per 1e6 input tokens, docs read 2026-09-18; not an invoice',
    },
    confidence: {
      note:
        'over every kind answer on a commit that did record something. `agreeing` is where the ' +
        'model also called the passage a decision; the floor is the separate question of whether ' +
        'that answer was confident enough to act on',
      answers: positiveAnswers.length,
      agreeing: agreeing.length,
      agreeingAboveFloor: aboveFloor,
      floor: 0.9,
      p10: quantile(0.1),
      median: quantile(0.5),
      p90: quantile(0.9),
      max: confidences.at(-1) ?? null,
    },
    rates: {
      recallOnCommitsThatRecordedOne: wilson(truePositive, pos.length),
      keyAgreementOnThoseRecorded: wilson(keyMatch, pos.length),
      falsePositiveOnCommitsWithNoRecord: wilson(falsePositive, neg.length),
    },
    rows,
  };

  const outDir = resolve(arg('--out', resolve('bench', 'jev-accuracy-out')));
  mkdirSync(outDir, { recursive: true });
  const path = resolve(outDir, `jev-accuracy-${report.ranAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);

  const pct = (interval) =>
    interval === null
      ? 'n/a'
      : `${(interval.point * 100).toFixed(1)}% (95% Wilson ${(interval.low * 100).toFixed(1)}–${(interval.high * 100).toFixed(1)}%)`;

  process.stdout.write(`${'-'.repeat(78)}\n`);
  process.stdout.write(
    `  commits that recorded a Limit/Warn/Ruled-out: ${String(pos.length)} answered\n` +
      `    produced a record:      ${String(truePositive)}  ${pct(report.rates.recallOnCommitsThatRecordedOne)}\n` +
      `    key matched the author: ${String(keyMatch)}  ${pct(report.rates.keyAgreementOnThoseRecorded)}\n`,
  );
  process.stdout.write(
    `  commits that recorded nothing: ${String(neg.length)} answered\n` +
      `    produced a record anyway: ${String(falsePositive)}  ${pct(report.rates.falsePositiveOnCommitsWithNoRecord)}\n`,
  );
  const conf = report.confidence;
  process.stdout.write(
    `  confidence, on commits that recorded one:\n` +
      `    ${String(conf.agreeing)}/${String(conf.answers)} answers called the passage a decision at all\n` +
      `    of those, ${String(conf.agreeingAboveFloor)} cleared the ${String(conf.floor)} floor\n` +
      `    p10 ${conf.p10 === null ? 'n/a' : conf.p10.toFixed(3)}  ` +
      `median ${conf.median === null ? 'n/a' : conf.median.toFixed(3)}  ` +
      `p90 ${conf.p90 === null ? 'n/a' : conf.p90.toFixed(3)}  ` +
      `max ${conf.max === null ? 'n/a' : conf.max.toFixed(3)}\n`,
  );
  process.stdout.write(
    `  ${String(report.totals.unexecuted)} unexecuted, ` +
      `${String(knownTokens)} known input token(s), ~$${report.totals.estimatedUsd.toFixed(5)} estimated\n`,
  );
  process.stdout.write(`  saved: ${path}\n`);
  for (const bias of report.biases) process.stdout.write(`  bias: ${bias}\n`);
};

await main();
