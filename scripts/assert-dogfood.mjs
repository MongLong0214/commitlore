/**
 * The dogfooding gate's assertion, as a file rather than a shell heredoc.
 *
 * It lived inline in `ci.yml`, where a comment containing backticks was read by
 * the shell as command substitution and the step died with `unexpected EOF` —
 * exit 2, before anything was asserted, while the log filled with `validate`
 * output that looked like the failure. Two quoting layers is one too many; a
 * file has none.
 *
 * `validate` exits 1 when it finds violations, so CI runs it with `|| true` and
 * this re-derives the verdict from the report. That is deliberate: the exit
 * code says something failed, and only the report can say which check did.
 *
 * Usage: node scripts/assert-dogfood.mjs <validate --json output file>
 */

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (path === undefined) {
  console.error('usage: node scripts/assert-dogfood.mjs <validate.json>');
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(path, 'utf8'));
} catch (error) {
  console.error(`ERROR: could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

let bad = 0;

const violations = Array.isArray(report.violations) ? report.violations : [];
if (violations.length > 0) {
  console.error(`ERROR: ${violations.length} violation(s) in this repository's own history:`);
  for (const v of violations.slice(0, 20)) {
    console.error(`  ${v.sha ?? '?'}: ${v.rule ?? '?'} — ${JSON.stringify(v).slice(0, 200)}`);
  }
  bad += 1;
} else {
  console.log('violations: none');
}

const secrets = Array.isArray(report.secrets) ? report.secrets : [];
if (secrets.length > 0) {
  console.error(`ERROR: ${secrets.length} secret(s) reported in the range`);
  bad += 1;
}

// Both halves must have run. `not-checked` is the state this gate exists for:
// without the notes mirror, reference integrity was reported as skipped and the
// job stayed green anyway (#542).
const checks = Array.isArray(report.checks) ? report.checks : [report.check].filter(Boolean);
const byClass = Object.fromEntries(checks.map((c) => [c.class, c]));
for (const cls of ['shape', 'reference']) {
  const check = byClass[cls];
  if (check === undefined) {
    console.error(`ERROR: validate reported no ${cls} check`);
    bad += 1;
    continue;
  }
  if (check.status !== 'ok') {
    console.error(`ERROR: ${cls} is ${check.status}${check.reason ? ` (${check.reason})` : ''}`);
    bad += 1;
    continue;
  }
  console.log(`${cls}: ok`);
}

process.exit(bad === 0 ? 0 : 1);
