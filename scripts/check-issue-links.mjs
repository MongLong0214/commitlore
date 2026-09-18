#!/usr/bin/env node
/**
 * Refuse a pull request whose issue link does not do what it appears to do.
 *
 * A closing keyword is a promise made in prose and kept by a parser, and the
 * two disagree in ways nobody notices until the issue is still open a week
 * later. Every rule below is a shape that has actually shipped here:
 *
 *   closes #a, #b          only #a is linked; #b reads as linked and is not
 *   closes #N  (base dev)  closing keywords fire on the default branch only
 *   does not close #N      GitHub reads the keyword, not the sentence
 *   closes #N  (a PR)      a pull request is not an issue link
 *   closes #N  (closed)    a link to something already closed links nothing
 *
 * And one that is not a defect in the link but in its absence: a pull request
 * with no issue reference at all. That is often correct — this repository
 * ships plenty of work nobody filed first — so it is not forbidden, it is made
 * explicit. `No-Issue: <reason>` in the body says a person decided, the way
 * `COMMITLORE_NO_RECORD` does on the commit path. Silence is the only thing
 * refused, because silence is the one state that cannot be reviewed.
 *
 * Bots and the canonical rebuild are exempt: neither authors the link, and the
 * canonical pull request's source carries it.
 *
 * Usage:
 *   node scripts/check-issue-links.mjs --from-file <event.json>
 *   node scripts/check-issue-links.mjs --from-stdin
 *   node scripts/check-issue-links.mjs            # reads GITHUB_EVENT_PATH
 *
 * Exit 0 when the link is sound or deliberately absent, 1 when it is not, 2 on
 * usage. Network is used only to ask what a referenced number is; `--offline`
 * skips that and reports the rest.
 */

import { readFileSync } from 'node:fs';

/** GitHub's own list. Anything else is a mention, not a link. */
export const CLOSING_KEYWORDS = [
  'close',
  'closes',
  'closed',
  'fix',
  'fixes',
  'fixed',
  'resolve',
  'resolves',
  'resolved',
];

/**
 * Words that negate the keyword they sit in front of.
 *
 * The first version of this scanned a whole clause for any of `not`, `without`,
 * `stops`, `avoids`, `no longer`, `instead of`, `rather than` -- and refused
 * six ordinary pull request bodies for it:
 *
 *     Notably, fixes #12                          `not` inside `Notably`
 *     Stops the double write and fixes #12        describes the change
 *     Avoids the race and closes #12              describes the change
 *     Works without a network and fixes #12       describes the change
 *     The hook no longer crashes, fixes #12       describes the change
 *     Uses a Map instead of an array, closes #12  describes the change
 *
 * Every one of those closes its issue and should. The mistake was reading the
 * clause instead of the phrase: what makes a keyword inert is a negation
 * *attached* to it -- "does not close", "doesn't fix", "never resolves" -- and
 * nothing further away. So only the word or two immediately before the keyword
 * is examined, and a word is a word rather than a substring.
 */
const NEGATING_WORDS = new Set(['not', 'never', 'neither', 'nor']);
const NEGATING_PAIRS = [
  ['rather', 'than'],
  ['instead', 'of'],
];

/** Whether the text immediately before a keyword negates it. */
const negatedBy = (before) => {
  const words = before
    .toLowerCase()
    .replace(/[^a-z'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const last = words.at(-1);
  if (last === undefined) return null;
  if (NEGATING_WORDS.has(last)) return last;
  if (last.endsWith("n't")) return last;
  const pair = words.slice(-2).join(' ');
  for (const [first, second] of NEGATING_PAIRS) {
    if (pair === `${first} ${second}`) return pair;
  }
  return null;
};

const KEYWORD_LINK = new RegExp(
  `\\b(${CLOSING_KEYWORDS.join('|')})\\b\\s*:?\\s*#(\\d+)`,
  'gi',
);

/**
 * What GitHub will not link, and what this must therefore not read.
 *
 * Fenced blocks and inline code do not produce references, so a `closes #3` in
 * an example is not a promise and must not be graded as one. Removing them
 * rather than skipping them keeps every offset meaningful for the negation
 * window.
 */
const withoutCode = (body) =>
  body
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/~~~[\s\S]*?~~~/g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (span) => ' '.repeat(span.length));

/** Every closing link in the body, with enough context to grade it. */
export const closingLinks = (body) => {
  const scannable = withoutCode(body ?? '');
  const found = [];
  for (const match of scannable.matchAll(KEYWORD_LINK)) {
    const at = match.index ?? 0;
    const before = scannable.slice(Math.max(0, at - 40), at);
    const after = scannable.slice(at + match[0].length);
    found.push({
      keyword: match[1],
      issue: Number(match[2]),
      text: match[0],
      negatedBy: negatedBy(before),
      /**
       * A second number the reader will think is linked. Only a keyword binds,
       * so `closes #1, #2` links #1 and leaves #2 looking handled.
       */
      trailing: /^[ \t]*(?:,|and|&|\+)?[ \t]*#(\d+)/.exec(after)?.[1] ?? null,
    });
  }
  return found;
};

/**
 * Placeholders that fill the field without answering it. A word count was tried
 * here first and was wrong: "documentation only" is two words and a perfectly
 * good reason, while "not applicable" is two words and is not one.
 */
const NON_REASONS = new Set(['n/a', 'na', 'none', 'no', 'nil', 'null', 'tbd', 'todo', '-', '--', '.', 'not applicable']);

/**
 * `No-Issue: <reason>`, or the empty string when the field was filled with a
 * marker rather than a reason.
 *
 * This refuses a placeholder; it does not grade a sentence. Somebody who writes
 * three words of nonsense passes, and that is the correct limit — a check that
 * tried to judge sincerity would be reading the shape of the answer and calling
 * it the answer.
 */
export const declaredNoIssue = (body) => {
  const match = /^[ \t]*No-Issue:[ \t]*(.+)$/im.exec(withoutCode(body ?? ''));
  if (match === null) return null;
  const reason = match[1].trim();
  const normalised = reason.toLowerCase().replace(/[.!?]+$/, '').trim();
  if (normalised.length < 3 || NON_REASONS.has(normalised)) return '';
  return reason;
};

const isBot = (payload) =>
  payload?.pull_request?.user?.type === 'Bot' ||
  String(payload?.pull_request?.user?.login ?? '').endsWith('[bot]');

const isCanonicalRebuild = (payload) =>
  String(payload?.pull_request?.head?.ref ?? '').startsWith('canonical/pr-');

/**
 * Grade one pull request.
 *
 * `lookup` answers what a number is — `{ kind: 'issue' | 'pull' | 'missing',
 * state: 'open' | 'closed' }`. Injected so every rule but that one is testable
 * without a network, and so a lookup failure degrades to "not checked" instead
 * of to "fine".
 */
export const issueLinkProblems = (payload, lookup = null) => {
  const pull = payload?.pull_request;
  if (pull === undefined || pull === null) return ['event payload carries no pull_request'];

  if (isBot(payload)) return [];
  if (isCanonicalRebuild(payload)) return [];

  const body = String(pull.body ?? '');
  const baseRef = String(pull.base?.ref ?? '');
  const defaultBranch = String(pull.base?.repo?.default_branch ?? 'main');
  const links = closingLinks(body);
  const problems = [];

  for (const link of links) {
    if (link.trailing !== null) {
      problems.push(
        `"${link.text}" is followed by #${link.trailing}, and a closing keyword binds exactly one issue — ` +
          `#${link.trailing} reads as linked and is not. Give it its own keyword: "Closes #${link.issue}" ` +
          `on one line, "Closes #${link.trailing}" on the next.`,
      );
    }
    if (link.negatedBy !== null) {
      problems.push(
        `"${link.text}" is preceded by "${link.negatedBy}", and GitHub reads the keyword rather than the ` +
          `sentence — this closes #${link.issue} whatever the prose says. Write "Refs #${link.issue}" instead.`,
      );
    }
    if (baseRef !== '' && baseRef !== defaultBranch) {
      problems.push(
        `"${link.text}" is on a pull request into "${baseRef}", and closing keywords fire only on the ` +
          `default branch ("${defaultBranch}") — merging this will not close #${link.issue}. Retarget, or ` +
          `drop the keyword and close it by hand.`,
      );
    }
  }

  if (lookup !== null) {
    for (const link of links) {
      const what = lookup(link.issue);
      if (what === undefined || what === null) continue; // not checked, not "fine"
      if (what.kind === 'missing') {
        problems.push(`"${link.text}" names #${link.issue}, which does not exist in this repository.`);
      } else if (what.kind === 'pull') {
        problems.push(
          `"${link.text}" names #${link.issue}, which is a pull request. A closing keyword links issues; ` +
            `for a pull request write "Refs #${link.issue}".`,
        );
      } else if (what.state === 'closed') {
        problems.push(
          `"${link.text}" names #${link.issue}, which is already closed — the link does nothing. Drop it, ` +
            `or name the issue this actually closes.`,
        );
      }
    }
  }

  if (links.length === 0) {
    const reason = declaredNoIssue(body);
    if (reason === null) {
      problems.push(
        'no issue link and no "No-Issue:" line. Add "Closes #N" for the issue this closes, or state that ' +
          'there is none — "No-Issue: <why>" — so the absence is a decision somebody made rather than one ' +
          'nobody noticed.',
      );
    } else if (reason === '') {
      problems.push(
        '"No-Issue:" carries no reason. It is read by whoever wonders later why this shipped unfiled, so it ' +
          'has to be a sentence rather than a marker.',
      );
    }
  }

  return problems;
};

/**
 * Every way in, and every way it can fail to be read, separated from the
 * grading.
 *
 * A payload that could not be read is a **usage** error and exits 2, never 1.
 * Exit 1 means "this pull request's link is wrong", and letting an unreadable
 * file produce it would report a link defect for a bad invocation — the reader
 * then goes looking at the pull request body for a fault that is in the command
 * line.
 */
const readPayload = (argv) => {
  const source = (() => {
    const fromFile = argv.indexOf('--from-file');
    if (fromFile !== -1) {
      const path = argv[fromFile + 1];
      return path === undefined ? { error: '--from-file needs a path' } : { path };
    }
    if (argv.includes('--from-stdin')) return { path: 0, label: 'standard input' };
    const eventPath = process.env['GITHUB_EVENT_PATH'];
    return eventPath === undefined || eventPath === ''
      ? { error: 'no --from-file, no --from-stdin, and GITHUB_EVENT_PATH is unset' }
      : { path: eventPath };
  })();

  if (source.error !== undefined) return source;
  try {
    return { payload: JSON.parse(readFileSync(source.path, 'utf8')) };
  } catch (error) {
    const where = source.label ?? String(source.path);
    return { error: `could not read the event payload from ${where}: ${error instanceof Error ? error.message : String(error)}` };
  }
};

/**
 * Asks the API what each referenced number is, once per number.
 *
 * A request that fails returns null for the whole lookup — "not checked" —
 * rather than an answer. A network hiccup that read as "fine" would be the one
 * shape this file exists to remove, and the caller says so in its output rather
 * than letting the silence pass for a pass.
 */
const resolveLookup = async (payload, links) => {
  const token = process.env['GITHUB_TOKEN'];
  const full = payload?.pull_request?.base?.repo?.full_name;
  if (token === undefined || token === '' || full === undefined) return null;
  const answers = new Map();
  for (const number of new Set(links.map((link) => link.issue))) {
    try {
      const response = await fetch(`https://api.github.com/repos/${full}/issues/${number}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
      });
      if (response.status === 404) {
        answers.set(number, { kind: 'missing', state: 'closed' });
        continue;
      }
      if (!response.ok) return null; // not checked
      const issue = await response.json();
      answers.set(number, {
        kind: issue.pull_request === undefined ? 'issue' : 'pull',
        state: issue.state === 'open' ? 'open' : 'closed',
      });
    } catch {
      return null;
    }
  }
  return (number) => answers.get(number) ?? null;
};

const main = async () => {
  const { payload, error } = readPayload(process.argv.slice(2));
  if (error !== undefined) {
    process.stderr.write(`check-issue-links: ${error}\n`);
    process.exitCode = 2;
    return;
  }

  const offline = process.argv.includes('--offline');
  const links = closingLinks(String(payload?.pull_request?.body ?? ''));
  const lookup = offline ? null : await resolveLookup(payload, links);
  if (!offline && lookup === null && links.length > 0) {
    process.stdout.write('check-issue-links: could not ask the API what the referenced numbers are — the rest still applies\n');
  }

  const problems = issueLinkProblems(payload, lookup);
  if (problems.length === 0) {
    process.stdout.write('check-issue-links: the issue link is sound, or its absence is stated\n');
    return;
  }
  process.stderr.write('check-issue-links: this pull request\'s issue link does not do what it appears to do:\n');
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exitCode = 1;
};

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
