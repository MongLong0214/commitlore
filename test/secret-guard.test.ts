/**
 * T-502 acceptance (PRD-F5 AC 3).
 *
 * Two halves, and the second is the one that decides whether the guard is
 * worth having. Blocking credentials is easy; blocking them *without* blocking
 * the records that discuss credentials is the whole job, because a guard that
 * fires on `Ruled-out: store the API key in the repo` trains everybody to
 * bypass it, and a bypassed guard blocks nothing.
 *
 * So: every positive fixture must be caught by exactly the rules it names,
 * every negative fixture must come back empty, and the output must never
 * contain the value it caught — an error message pasted into an issue is a
 * second copy of the leak.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatFindings, scanForSecrets, type SecretFinding } from '../src/core/secret-guard.js';
import { SECRET_RULES } from '../src/hooks/secret-rules.js';

type Verdict = 'blocked' | 'clean';

interface SecretExpectation {
  description: string;
  verdict: Verdict;
  /** Every rule the fixture must trip, and no others. */
  ruleIds: string[];
  /** The literal fabricated credentials in the fixture. No output may echo them. */
  secrets: string[];
}

interface SecretFixture {
  id: string;
  message: string;
  expected: SecretExpectation;
}

const FIXTURE_ROOT = fileURLToPath(new URL('../spec/fixtures/secrets/', import.meta.url));

/** Discovered from disk, so a new fixture is covered by every case below the moment it lands. */
const loadSecretFixtures = (kind: 'positive' | 'negative'): SecretFixture[] => {
  const dir = join(FIXTURE_ROOT, kind);
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.txt'))
    .sort()
    .map((entry) => {
      const name = entry.slice(0, -'.txt'.length);
      return {
        id: `${kind}/${name}`,
        message: readFileSync(join(dir, entry), 'utf8'),
        expected: JSON.parse(
          readFileSync(join(dir, `${name}.expected.json`), 'utf8'),
        ) as SecretExpectation,
      };
    });
};

const positives = loadSecretFixtures('positive');
const negatives = loadSecretFixtures('negative');

const ruleIdsOf = (findings: readonly SecretFinding[]): string[] =>
  [...new Set(findings.map((finding) => finding.ruleId))].sort();

const lineOf = (message: string, line: number): string => message.split('\n')[line - 1] ?? '';

/** How much of a match `redact` is allowed to keep. Mirrors the module's own constant. */
const REDACT_PREFIX = 4;

/**
 * Every 6-character window of `secret` that begins past the redaction
 * boundary — a leak long enough to be recognizable, taken from the part of the
 * value that is supposed to be hidden.
 *
 * The first four characters are excluded on purpose: they are the fixed,
 * public prefix a rule keys on (`AKIA`, `ghp_`, `http`), they carry no key
 * material, and they legitimately appear in rule ids and descriptions.
 */
const windows = (secret: string): string[] => {
  const size = 6;
  const start = REDACT_PREFIX;
  if (secret.length < start + size) return [];
  return Array.from({ length: secret.length - size - start + 1 }, (_, index) =>
    secret.slice(start + index, start + index + size),
  );
};

describe('the fixture corpus', () => {
  it('has at least six positive and six negative fixtures', () => {
    expect(positives.length).toBeGreaterThanOrEqual(6);
    expect(negatives.length).toBeGreaterThanOrEqual(6);
  });

  it('exercises every rule in the table with at least one positive fixture', () => {
    const covered = new Set(positives.flatMap((fixture) => fixture.expected.ruleIds));
    const uncovered = SECRET_RULES.map((rule) => rule.id).filter((id) => !covered.has(id));
    expect(uncovered).toEqual([]);
  });
});

describe('the rule table', () => {
  it('has unique ids', () => {
    const ids = SECRET_RULES.map((rule) => rule.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  /**
   * `scanForSecrets` reads matches with `matchAll`, which throws on a
   * non-global pattern — and a non-global pattern that slipped through an
   * `exec` loop instead would silently carry `lastIndex` between scans.
   */
  it('declares every pattern global', () => {
    expect(SECRET_RULES.filter((rule) => !rule.pattern.global).map((rule) => rule.id)).toEqual([]);
  });

  it('does not accumulate regex state across scans', () => {
    const message = positives.map((fixture) => fixture.message).join('\n');
    const first = scanForSecrets(message);
    expect(scanForSecrets(message)).toEqual(first);
    expect(scanForSecrets(message)).toEqual(first);
    expect(SECRET_RULES.every((rule) => rule.pattern.lastIndex === 0)).toBe(true);
  });
});

describe('positive fixtures are blocked', () => {
  it.each(positives)('$id trips exactly its expected rules', (fixture) => {
    expect(fixture.expected.verdict).toBe('blocked');
    const findings = scanForSecrets(fixture.message);
    expect(findings.length).toBeGreaterThan(0);
    expect(ruleIdsOf(findings)).toEqual([...fixture.expected.ruleIds].sort());
  });

  it.each(positives)('$id reports the line the credential is on', (fixture) => {
    const findings = scanForSecrets(fixture.message);
    for (const secret of fixture.expected.secrets) {
      const reported = findings.map((finding) => lineOf(fixture.message, finding.line));
      expect(reported.some((text) => text.includes(secret))).toBe(true);
    }
  });
});

describe('negative fixtures pass', () => {
  it.each(negatives)('$id produces no finding', (fixture) => {
    expect(fixture.expected.verdict).toBe('clean');
    // Mapped before asserting so a regression names the rule instead of dumping objects.
    const findings = scanForSecrets(fixture.message).map(
      (finding) => `${finding.line}: ${finding.ruleId}`,
    );
    expect(findings).toEqual([]);
  });
});

describe('redaction', () => {
  it.each(positives)('$id output never contains the credential', (fixture) => {
    const findings = scanForSecrets(fixture.message);
    const rendered = `${formatFindings(findings)}\n${JSON.stringify(findings)}`;

    for (const secret of fixture.expected.secrets) {
      expect(rendered).not.toContain(secret);
      // A prefix short enough to be safe is still a prefix; nothing recognizable
      // from anywhere inside the value may survive either.
      const leaked = windows(secret).filter((window) => rendered.includes(window));
      expect(leaked).toEqual([]);
    }
  });

  it.each(positives)('$id excerpts are at most four characters plus an ellipsis', (fixture) => {
    for (const finding of scanForSecrets(fixture.message)) {
      expect(finding.redacted.endsWith('…')).toBe(true);
      expect(finding.redacted.length).toBeLessThanOrEqual(5);
    }
  });

  it('drops at least one character even from a short match', () => {
    const findings = scanForSecrets('Warn: -----BEGIN PRIVATE KEY----- was in the image');
    expect(findings.map((finding) => finding.redacted)).toEqual(['----…']);
  });
});

describe('output', () => {
  const message = readFileSync(
    join(FIXTURE_ROOT, 'positive', '01-aws-access-key-id.txt'),
    'utf8',
  );

  const REMEDY =
    'Remove the value from the message. If it has already left this machine, rotate it — rewriting history does not reach existing clones.';

  it('names the rule and the line, and nothing else', () => {
    expect(formatFindings(scanForSecrets(message))).toBe(
      [
        '4: aws-access-key-id (high) — AWS access key id — AKIA…',
        REMEDY,
        '',
      ].join('\n'),
    );
  });

  it('lists several findings in message order', () => {
    const several = [
      'fix(deploy): rotate everything the old runner held',
      '',
      'Warn: staging authenticated as AKIA7CRHB6PVPDR7GPYV',
      'Ruled-out: leave password: "OnOm2TL1bat8Cm" in worker.yaml | the pod reads it',
      'Warn: the mirror still fetches https://ci-bot:seWoWbStry1s7S@registry.internal.acme.invalid/npm',
      '',
    ].join('\n');

    expect(formatFindings(scanForSecrets(several))).toBe(
      [
        '3: aws-access-key-id (high) — AWS access key id — AKIA…',
        '4: generic-credential-assignment (medium) — a secret-looking name assigned a credential-shaped value — pass…',
        '5: url-embedded-credentials (high) — credentials embedded in a URL — http…',
        REMEDY,
        '',
      ].join('\n'),
    );
  });

  /** A guard that advertises its own bypass is a guard that gets bypassed. */
  it('never mentions how to skip the check', () => {
    const rendered = formatFindings(scanForSecrets(message)).toLowerCase();
    expect(rendered).not.toContain('no-verify');
    expect(rendered).not.toContain('--no');
    expect(rendered).not.toContain('bypass');
    expect(rendered).not.toContain('skip');
  });

  it('is empty when nothing was found', () => {
    expect(formatFindings([])).toBe('');
  });

  it('ends with a newline so it can go straight to stderr', () => {
    expect(formatFindings(scanForSecrets(message)).endsWith('\n')).toBe(true);
  });
});

describe('confidence threshold', () => {
  const medium = 'Ruled-out: leave password: "OnOm2TL1bat8Cm" in worker.yaml | the pod reads it';
  const high = 'Warn: staging still authenticates as AKIA7CRHB6PVPDR7GPYV';

  it('reports medium findings by default', () => {
    expect(ruleIdsOf(scanForSecrets(medium))).toEqual(['generic-credential-assignment']);
  });

  it('drops medium findings at minConfidence high', () => {
    expect(scanForSecrets(medium, { minConfidence: 'high' })).toEqual([]);
  });

  it('keeps high findings at minConfidence high', () => {
    const message = `${high}\n${medium}`;
    expect(ruleIdsOf(scanForSecrets(message))).toEqual([
      'aws-access-key-id',
      'generic-credential-assignment',
    ]);
    expect(ruleIdsOf(scanForSecrets(message, { minConfidence: 'high' }))).toEqual([
      'aws-access-key-id',
    ]);
  });

  it('reports one leak once when two rules cover the same characters', () => {
    const both = 'Warn: api_key = "ghp_woQsV1K0ETSd7oY7wtnp83A4UTVAyjyr6VaT" shipped in the chart';
    expect(ruleIdsOf(scanForSecrets(both))).toEqual(['github-token']);
  });
});

describe('lines git will discard', () => {
  it('numbers findings from the first line of the message', () => {
    const message = ['subject', '', 'body', 'Warn: AKIA7CRHB6PVPDR7GPYV is live', ''].join('\n');
    expect(scanForSecrets(message).map((finding) => finding.line)).toEqual([4]);
  });

  it('ignores comment lines, which git strips before the commit exists', () => {
    const message = ['subject', '', '# api_key = "OnOm2TL1bat8Cm"', ''].join('\n');
    expect(scanForSecrets(message)).toEqual([]);
  });

  /**
   * `commit -v` pastes the staged diff below the scissors. Scanning it would
   * block the very commit that removes a hardcoded key — and would put the
   * whole diff through ten regexes on every commit.
   */
  it('stops at the commit -v scissors line', () => {
    const message = [
      'fix(config): read the key from the environment',
      '',
      '# ------------------------ >8 ------------------------',
      'diff --git a/src/config.ts b/src/config.ts',
      `-const id = "AKIA7CRHB6PVPDR7GPYV";`,
      '',
    ].join('\n');
    expect(scanForSecrets(message)).toEqual([]);
  });

  it('still scans the message above the scissors', () => {
    const message = [
      'fix(config): rotate the uploader key',
      '',
      'Warn: AKIA7CRHB6PVPDR7GPYV was live until now',
      '# ------------------------ >8 ------------------------',
      'diff --git a/src/config.ts b/src/config.ts',
      '',
    ].join('\n');
    expect(scanForSecrets(message).map((finding) => finding.line)).toEqual([3]);
  });

  it('handles CRLF without shifting line numbers', () => {
    const message = ['subject', '', 'Warn: AKIA7CRHB6PVPDR7GPYV is live', ''].join('\r\n');
    expect(scanForSecrets(message).map((finding) => finding.line)).toEqual([3]);
  });
});

describe('regex cost', () => {
  const SIZE = 10 * 1024;
  const BUDGET_MS = 100;

  /**
   * Inputs shaped to make a naive pattern backtrack: a long run in front of a
   * character the rule requires, and a long run of matches. Each is one line,
   * which is the worst case — the scanner splits on newlines, so a 10 KB line
   * is 10 KB of work for a single start position.
   */
  const payloads: { name: string; text: string }[] = [
    { name: 'lowercase run', text: 'a'.repeat(SIZE) },
    { name: 'uppercase run', text: 'A'.repeat(SIZE) },
    { name: 'quote run', text: '"'.repeat(SIZE) },
    { name: 'colon-slash run', text: '://'.repeat(SIZE / 3) },
    { name: 'assignment then run', text: `api_key = "${'a'.repeat(SIZE)}` },
    { name: 'assignment unterminated', text: `password: "${'a'.repeat(SIZE)}"` },
    { name: 'pem header then run', text: `-----BEGIN ${'A'.repeat(SIZE)}` },
    { name: 'aws prefix then run', text: `AKIA${'A'.repeat(SIZE)}` },
    { name: 'sk prefix then run', text: `sk-${'a'.repeat(SIZE)}` },
    { name: 'github prefix then run', text: `ghp_${'a'.repeat(SIZE)}` },
    { name: 'slack prefix then run', text: `xoxb-${'a'.repeat(SIZE)}` },
    { name: 'aws keyword then run', text: `aws_secret_access_key=${'a'.repeat(SIZE)}` },
    { name: 'url userinfo halves', text: `https://${'a'.repeat(SIZE / 2)}:${'b'.repeat(SIZE / 2)}` },
    { name: 'many url matches', text: 'https://user:passwd@host '.repeat(SIZE / 25) },
    { name: 'many aws matches', text: 'AKIA7CRHB6PVPDR7GPYV '.repeat(SIZE / 21) },
    { name: 'many lines', text: `${'Warn: rotate the token before the release\n'.repeat(SIZE / 42)}` },
  ];

  const timings: string[] = [];

  it.each(SECRET_RULES.map((rule) => rule.id))('%s finishes every payload in budget', (id) => {
    const rule = SECRET_RULES.find((candidate) => candidate.id === id);
    if (rule === undefined) throw new Error(`no rule ${id}`);

    let worst = 0;
    let worstPayload = '';
    for (const payload of payloads) {
      const started = performance.now();
      // Drained, because a lazy iterator would measure nothing.
      [...payload.text.matchAll(rule.pattern)].length;
      const elapsed = performance.now() - started;
      if (elapsed > worst) {
        worst = elapsed;
        worstPayload = payload.name;
      }
    }

    timings.push(`  ${id.padEnd(32)} ${worst.toFixed(3).padStart(8)}ms  (${worstPayload})`);
    expect(worst).toBeLessThan(BUDGET_MS);
  });

  it('scans a 10 KB message through the whole table in budget', () => {
    let worst = 0;
    let worstPayload = '';
    for (const payload of payloads) {
      const started = performance.now();
      scanForSecrets(payload.text);
      const elapsed = performance.now() - started;
      if (elapsed > worst) {
        worst = elapsed;
        worstPayload = payload.name;
      }
    }

    timings.push(`  ${'[whole table]'.padEnd(32)} ${worst.toFixed(3).padStart(8)}ms  (${worstPayload})`);
    // Printed because "no catastrophic backtracking" is a claim that needs numbers.
    console.log(`\nworst case per rule over ${payloads.length} adversarial 10 KB payloads:\n${timings.join('\n')}`);
    expect(worst).toBeLessThan(BUDGET_MS);
  });
});
