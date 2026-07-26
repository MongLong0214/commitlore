/**
 * What the PR comment says, and how it lands exactly once.
 *
 * Both halves live here rather than inline in `action.yml`, because both are
 * decisions a test has to be able to hold:
 *
 *   - which existing comment an update replaces. A lint that posts a fresh
 *     comment per push turns the PR into a changelog of itself, so the body
 *     carries a marker and every later run rewrites the comment it finds.
 *   - what gets dropped when the body outgrows GitHub's limit. Silently
 *     posting the first 65k characters would read as a complete answer.
 *
 * Logic written inside a `script:` block is logic nobody can check, and this is
 * the part users see.
 */

/**
 * The handle a later run finds this comment by. An HTML comment: invisible in
 * the rendered body, preserved verbatim by the API. Changing it orphans every
 * comment already posted, which is a migration, not an edit.
 */
export const MARKER = '<!-- commitlore-lint -->';

/**
 * GitHub rejects an issue comment body over 65536 characters with a 422. The
 * margin absorbs the truncation notice and anything the API counts differently
 * than `String.length` does.
 */
export const MAX_COMMENT_CHARS = 65_000;

/** Above this, the constraint list goes behind a `<details>` fold. */
const FOLD_ABOVE_LINES = 12;

const HEADING = '### CommitLore — record lint';

const FOOTER =
  '<sub>Trailer violations fail this check. Active constraints are ' +
  'informational — they are what the repository already decided, not a ' +
  'verdict on this PR.</sub>';

const SECTIONS = [
  { key: 'Limit', heading: 'Limits' },
  { key: 'Ruled-out', heading: 'Ruled out' },
  { key: 'Warn', heading: 'Warnings' },
];

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** Markdown table cells: a trailer value may legally contain `|`. */
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Inline code that survives a value containing backticks. */
const code = (text) => {
  const value = String(text);
  const fence = '`'.repeat(Math.max(1, ...[...value.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  return `${fence}${value.includes('`') ? ` ${value} ` : value}${fence}`;
};

const shortSha = (sha) => (typeof sha === 'string' ? sha.slice(0, 8) : '');

const violationRows = (violations) =>
  violations.map((violation) => {
    const where = [shortSha(violation.sha), violation.line]
      .filter((part) => part !== undefined && part !== '')
      .join(':');
    return (
      `| ${cell(where || '—')} | ${cell(violation.rule)} | ${cell(violation.key)} ` +
      `| ${cell(JSON.stringify(violation.got))} | ${cell(JSON.stringify(violation.want))} |`
    );
  });

/**
 * Secrets carry `redacted`, which is a masked excerpt by construction
 * (`src/core/secret-guard.ts`). Nothing here prints a matched value: a comment
 * is a permanent, world-readable copy of whatever it quotes.
 */
const secretRows = (secrets) =>
  secrets.map(
    (secret) =>
      `| ${cell(secret.line ?? '—')} | ${cell(secret.ruleId)} | ${cell(secret.confidence)} ` +
      `| ${cell(secret.description)} | ${cell(secret.redacted)} |`,
  );

const constraintLines = (records, key) =>
  records.flatMap((record) =>
    (record.trailers ?? [])
      .filter((trailer) => trailer.key === key)
      .map((trailer) => {
        const id = record.recordId ?? '-';
        const flags = [
          ...(record.lifecycle && record.lifecycle !== 'active' ? [record.lifecycle] : []),
          ...(record.flags ?? []),
          ...(record.trust ? [record.trust] : []),
        ];
        const tag = flags.length === 0 ? '' : ` _(${flags.join(', ')})_`;
        return `- ${code(id)} ${shortSha(record.sha)}${tag} — ${trailer.value}`;
      }),
  );

const summaryLine = (input) => {
  const { violations, secrets, commits, baseRef, headRef } = input;
  const verdict =
    violations.length === 0 && secrets.length === 0
      ? 'clean'
      : [
          violations.length > 0 ? plural(violations.length, 'violation', 'violations') : '',
          secrets.length > 0
            ? plural(secrets.length, 'possible credential', 'possible credentials')
            : '',
        ]
          .filter(Boolean)
          .join(', ');
  const range = `${baseRef}..${headRef}`;
  return `**Trailers:** ${verdict} — ${plural(commits, 'commit', 'commits')} in ${code(range)}`;
};

const constraintSummaryLine = (input) => {
  const { context, contextError, changedPaths, changedTotal } = input;
  const scope =
    changedTotal === changedPaths.length
      ? plural(changedTotal, 'changed path', 'changed paths')
      : `${changedPaths.length} of ${plural(changedTotal, 'changed path', 'changed paths')}`;

  if (contextError) return `**Active constraints:** not read — ${contextError} (${scope})`;
  if (changedTotal === 0) return '**Active constraints:** no paths changed in this range';
  if (!context) return `**Active constraints:** none read (${scope})`;

  const counts = context.counts ?? {};
  const parts = [
    `${counts.limits ?? 0} limits`,
    `${counts.ruledOut ?? 0} ruled-out`,
    `${counts.warnings ?? 0} warnings`,
  ].join(' · ');
  return (
    `**Active constraints:** ${parts} — from ` +
    `${plural(counts.records ?? 0, 'record', 'records')} over ${scope}`
  );
};

/**
 * Keeps `lines` under `budget` characters by dropping from the end, which is
 * the order the body is built in: the verdict and the violations that fail the
 * check come first, the constraint list that is only informational comes last.
 *
 * Returns the kept lines and how many were dropped, never a silent prefix.
 */
const fit = (lines, budget) => {
  let used = 0;
  for (const [index, line] of lines.entries()) {
    used += line.length + 1;
    if (used > budget) return { kept: lines.slice(0, index), omitted: lines.length - index };
  }
  return { kept: lines, omitted: 0 };
};

/**
 * Builds the body. Returns `{ body, truncated, omitted }` — the caller reports
 * truncation as an output, so a shortened comment is visible in the run as well
 * as in the comment itself.
 */
export const buildComment = (input) => {
  const {
    baseRef = 'base',
    headRef = 'HEAD',
    commits = 0,
    violations = [],
    secrets = [],
    changedPaths = [],
    changedTotal = changedPaths.length,
    context = null,
    contextError = null,
    maxChars = MAX_COMMENT_CHARS,
  } = input;

  const head = [
    MARKER,
    HEADING,
    '',
    summaryLine({ violations, secrets, commits, baseRef, headRef }),
    constraintSummaryLine({ context, contextError, changedPaths, changedTotal }),
  ];

  const body = [];

  if (violations.length > 0) {
    body.push(
      '',
      `#### Violations (${violations.length})`,
      '',
      '| commit:line | rule | trailer | got | want |',
      '| --- | --- | --- | --- | --- |',
      ...violationRows(violations),
    );
  }

  if (secrets.length > 0) {
    body.push(
      '',
      `#### Possible credentials (${secrets.length})`,
      '',
      '| line | rule | confidence | what | match |',
      '| --- | --- | --- | --- | --- |',
      ...secretRows(secrets),
      '',
      'Remove the value from the message. If it has already left this machine, ' +
        'rotate it — rewriting history does not reach existing clones.',
    );
  }

  const records = context?.records ?? [];
  const constraints = SECTIONS.flatMap((section) => {
    const lines = constraintLines(records, section.key);
    return lines.length === 0 ? [] : ['', `#### ${section.heading} (${lines.length})`, '', ...lines];
  });

  if (constraints.length > FOLD_ABOVE_LINES) {
    body.push('', '<details><summary>Active constraints for the paths this PR touches</summary>');
    body.push(...constraints, '', '</details>');
  } else {
    body.push(...constraints);
  }

  for (const diagnostic of context?.diagnostics ?? []) body.push('', `> ${diagnostic}`);
  if (changedTotal > changedPaths.length) {
    body.push(
      '',
      `> Only the first ${changedPaths.length} changed paths were queried; ` +
        `${changedTotal - changedPaths.length} more were not.`,
    );
  }

  const fixed = [...head, '', FOOTER].join('\n').length;
  const notice = (omitted) =>
    `_Truncated: ${plural(omitted, 'line', 'lines')} omitted — the comment hit ` +
    `GitHub's ${maxChars} character limit._`;
  // The reserved notice is measured against the largest count it could carry,
  // and the slack covers the separators the join adds around it.
  const { kept, omitted } = fit(body, maxChars - fixed - notice(body.length).length - 8);

  return {
    body: [
      ...head,
      ...kept,
      ...(omitted > 0 ? ['', notice(omitted)] : []),
      '',
      FOOTER,
      '',
    ].join('\n'),
    truncated: omitted > 0,
    omitted,
  };
};

/**
 * A token without write access — every pull request from a fork gets one — can
 * read the PR and not comment on it. That is GitHub's policy, not a fault in
 * the run, so the upsert reports it and the lint verdict still stands.
 */
const FORBIDDEN = 403;

const isForbidden = (error) => Number(error?.status) === FORBIDDEN;

/**
 * Posts `body`, or rewrites the comment a previous run posted.
 *
 * `api` is the three calls this needs, so the GitHub client stays in the
 * workflow and the decision stays testable:
 *   list()            -> [{ id, body }, ...]  every comment on the PR
 *   create(body)      -> { id, html_url }
 *   update(id, body)  -> { id, html_url }
 *
 * When several comments carry the marker — a run that crashed between create
 * and update, an older version of this action — the oldest wins, so the
 * comment's identity does not move around under a reader.
 */
export const upsertComment = async ({ api, body, marker = MARKER }) => {
  if (!body.includes(marker)) {
    // Without the marker the next run cannot find this comment, and the doubling
    // starts there rather than here, where it would be obvious.
    throw new Error(`comment body is missing the marker ${marker} — it could never be updated`);
  }

  try {
    const comments = await api.list();
    const existing = comments.find(
      (comment) => typeof comment?.body === 'string' && comment.body.includes(marker),
    );

    if (existing) {
      const updated = await api.update(existing.id, body);
      return { action: 'updated', id: existing.id, url: updated?.html_url ?? '' };
    }

    const created = await api.create(body);
    return { action: 'created', id: created?.id ?? null, url: created?.html_url ?? '' };
  } catch (error) {
    if (!isForbidden(error)) throw error;
    return {
      action: 'skipped',
      id: null,
      url: '',
      reason:
        'the token cannot write to this pull request (a fork PR gets a read-only ' +
        'token) — the lint result is in the job summary',
    };
  }
};
