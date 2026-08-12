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

// Violations in this repository's own commit messages that predate the gate
// finding them. They are named in scripts/dogfood-baseline.json with what each
// one is; anything not named there still fails. Recording them is the point —
// a gate that skipped them silently is what #542 was about.
const baseline = JSON.parse(readFileSync(new URL('./dogfood-baseline.json', import.meta.url), 'utf8'));
const accepted = new Set(baseline.accepted.map((a) => `${a.sha}:${a.rule}:${a.value}`));
const all = Array.isArray(report.violations) ? report.violations : [];
const violations = all.filter((v) => !accepted.has(`${v.sha}:${v.rule}:${v.value}`));
const carried = all.length - violations.length;
if (carried > 0) {
  console.log(`violations: ${carried} carried from scripts/dogfood-baseline.json`);
}
if (violations.length > 0) {
  console.error(`ERROR: ${violations.length} violation(s) outside the recorded baseline:`);
  for (const v of violations.slice(0, 20)) {
    console.error(`  ${v.sha ?? '?'}: ${v.rule ?? '?'} — ${JSON.stringify(v).slice(0, 200)}`);
  }
  bad += 1;
} else if (carried === 0) {
  console.log('violations: none');
}

// A report of an empty range is `ok`/`ok` with no violations — identical to a
// clean one. `scripts/adoption-range.mjs` derives its boundary from the oldest
// commit carrying `CommitLore-Version:`, so a history rewrite, a squash, or a
// filter that moves that boundary to HEAD yields `<HEAD>..HEAD`, and the gate
// proving this repository keeps its own protocol reports clean having read
// nothing. #542 was the same shape: a check that did not run, reported as one
// that passed.
const examined = typeof report.examined === 'number' ? report.examined : null;
if (examined === null) {
  console.error('ERROR: the report does not say how many messages it examined');
  bad += 1;
} else if (examined === 0) {
  console.error('ERROR: the range was empty — nothing was validated, which is not the same as clean');
  bad += 1;
} else {
  console.log(`examined: ${examined} message(s)`);
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
  if (check.status === 'ok') {
    console.log(`${cls}: ok`);
    continue;
  }
  // `validate` sets the class to `failed` from the same violations subtracted
  // above, so filtering the list without accounting for the status leaves the
  // gate red for a case already recorded. Tolerated only when the subtraction
  // is the entire explanation: nothing unrecorded remains, and something was
  // in fact carried. `not-checked` is never tolerated — a sub-check that did
  // not run is exactly what #542 was about, and no baseline entry excuses it.
  if (check.status === 'failed' && violations.length === 0 && carried > 0) {
    console.log(`${cls}: failed only on ${carried} baselined violation(s), none unrecorded`);
    continue;
  }
  console.error(`ERROR: ${cls} is ${check.status}${check.reason ? ` (${check.reason})` : ''}`);
  bad += 1;
}

process.exit(bad === 0 ? 0 : 1);
