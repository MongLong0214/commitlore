/**
 * Credential detection for commit messages (T-502, PRD-F5 AC 3).
 *
 * This is a blocker, not a report. A credential that reaches a commit message
 * is permanent: rewriting history does not reach the clones, forks and mirrors
 * that already fetched it, so the only moment the damage can still be undone
 * is before the commit exists. Hence a `commit-msg` hook rather than an audit.
 *
 * Which makes the false-positive rate a correctness property, not a polish
 * item. Every wrong block teaches somebody that `--no-verify` is part of the
 * workflow, and a guard that people habitually skip detects nothing. The rules
 * in `../hooks/secret-rules.ts` are tuned for that, and this module adds two
 * more filters that only make sense with a whole message in hand:
 *
 * - **Ignored lines are not scanned.** Comment lines and everything below the
 *   `commit -v` scissors are stripped by git before the commit is written, so
 *   a finding there is by construction a finding about text that will not
 *   exist. Skipping them also keeps the pasted diff — usually the largest and
 *   noisiest part of `COMMIT_EDITMSG` — out of the scan entirely.
 * - **A higher-confidence finding shadows an overlapping lower one.** A leaked
 *   `api_key = "ghp_…"` is one problem, and reporting it twice makes the
 *   output look like noise.
 *
 * Nothing here ever emits the matched text. Findings carry a redacted excerpt
 * and the raw match is dropped inside `hitsFor`, because this module's output
 * lands in terminals, CI logs and pasted issue reports — every one of them a
 * second copy of whatever was leaked.
 */

import { SECRET_RULES, isPlaceholder, type SecretRule } from '../hooks/secret-rules.js';

export interface SecretFinding {
  ruleId: string;
  description: string;
  /** 1-based line number in the message as given, counting ignored lines. */
  line: number;
  /** Masked excerpt — the first few characters and an ellipsis. Never the value. */
  redacted: string;
  confidence: 'high' | 'medium';
}

export interface ScanOptions {
  /** Findings below this bar are dropped. Defaults to `medium`, i.e. report everything. */
  minConfidence?: 'high' | 'medium';
}

const CONFIDENCE_RANK: Readonly<Record<'high' | 'medium', number>> = { high: 2, medium: 1 };

/**
 * How much of a match survives redaction. Four characters is enough to name
 * the shape (`AKIA…`, `ghp_…`, `pass…`) without carrying entropy, because
 * every rule's match begins with a fixed prefix or the identifier, never with
 * key material.
 */
const REDACT_PREFIX = 4;

/** git's default `core.commentChar`. */
const COMMENT_CHAR = '#';

/**
 * `commit -v` writes the staged diff below this line, uncommented, and git
 * drops everything from here down. Detected loosely because the dashes are a
 * fixed-width decoration nobody should depend on.
 */
const SCISSORS = /^#\s{0,8}-{3,}\s{0,8}>8\s{0,8}-{3,}/;

/** A line of the message that will survive into the commit, with its position. */
interface ScannedLine {
  line: number;
  text: string;
}

/** One rule match, already redacted, plus the span it covered for shadowing. */
interface Hit {
  rule: SecretRule;
  line: number;
  start: number;
  end: number;
  redacted: string;
}

/**
 * Masks a match. `length - 1` guarantees at least one character is dropped, so
 * the excerpt can never be the whole match no matter how short a future rule's
 * shortest match becomes — the property the masking test asserts.
 */
const redact = (text: string): string =>
  `${text.slice(0, Math.min(REDACT_PREFIX, Math.max(text.length - 1, 0)))}…`;

/**
 * The lines git will keep, with their original 1-based numbers so a reported
 * line still matches what the author sees in their editor.
 */
const scannedLines = (message: string): ScannedLine[] => {
  const kept: ScannedLine[] = [];

  for (const [index, raw] of message.split('\n').entries()) {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (SCISSORS.test(text)) break;
    if (text.startsWith(COMMENT_CHAR)) continue;
    kept.push({ line: index + 1, text });
  }

  return kept;
};

/**
 * Runs one rule over one line. `matchAll` rather than an `exec` loop: it works
 * on a clone of the regex, so `SECRET_RULES` never accumulates `lastIndex`
 * state between calls, and it advances past a zero-length match on its own.
 */
const hitsFor = (rule: SecretRule, source: ScannedLine): Hit[] => {
  const found: Hit[] = [];

  for (const match of source.text.matchAll(rule.pattern)) {
    const text = match[0];
    if (isPlaceholder(match.groups?.['check'] ?? text)) continue;
    const start = match.index ?? 0;
    found.push({ rule, line: source.line, start, end: start + text.length, redacted: redact(text) });
  }

  return found;
};

const overlaps = (a: Hit, b: Hit): boolean =>
  a.line === b.line && a.start < b.end && b.start < a.end;

/** Drops a hit when a more confident rule already covers the same characters. */
const dropShadowed = (hits: Hit[]): Hit[] =>
  hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other !== hit &&
          overlaps(hit, other) &&
          CONFIDENCE_RANK[other.rule.confidence] > CONFIDENCE_RANK[hit.rule.confidence],
      ),
  );

/**
 * Scans a commit message for credentials, in message order.
 *
 * An empty array means no rule fired — which is a statement about this rule
 * table, not a clean bill of health. The known gaps are documented with the
 * rules themselves.
 */
export const scanForSecrets = (message: string, opts?: ScanOptions): SecretFinding[] => {
  const floor = CONFIDENCE_RANK[opts?.minConfidence ?? 'medium'];

  const hits = scannedLines(message).flatMap((source) =>
    SECRET_RULES.flatMap((rule) => hitsFor(rule, source)),
  );

  return dropShadowed(hits)
    .filter((hit) => CONFIDENCE_RANK[hit.rule.confidence] >= floor)
    .sort((a, b) => a.line - b.line || a.start - b.start || a.rule.id.localeCompare(b.rule.id))
    .map((hit) => ({
      ruleId: hit.rule.id,
      description: hit.rule.description,
      line: hit.line,
      redacted: hit.redacted,
      confidence: hit.rule.confidence,
    }));
};

/**
 * Renders findings for a human about to lose their commit.
 *
 * The rule id and the line number are the whole message: enough to find the
 * value, never enough to re-leak it. There is deliberately no mention of how
 * to skip the check — a bypass the tool advertises is a bypass that gets used
 * on the finding that mattered.
 *
 * Returns `''` for no findings, and a newline-terminated block otherwise, so a
 * caller can write it straight to stderr.
 */
/**
 * Renders findings for a human. Deliberately does *not* claim what happened to
 * the commit: this runs from `validate`, which may be invoked from a commit-msg
 * hook (where the commit is indeed refused) or on its own against a file or a
 * range (where nothing was being created). The caller knows which, and says so.
 */
export const formatFindings = (findings: readonly SecretFinding[]): string => {
  if (findings.length === 0) return '';

  return [
    ...findings.map(
      (finding) =>
        `${finding.line}: ${finding.ruleId} (${finding.confidence}) — ${finding.description} — ${finding.redacted}`,
    ),
    'Remove the value from the message. If it has already left this machine, rotate it — rewriting history does not reach existing clones.',
    '',
  ].join('\n');
};
