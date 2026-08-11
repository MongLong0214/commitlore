/**
 * Doctor's human-readable report renderer.
 *
 * It owns text formatting alone so the frozen output can be verified separately
 * from diagnosis and command registration.
 */

import type { DoctorReport } from './model.js';

const STATUS_WIDTH = 8;
const DETAIL_INDENT = ' '.repeat(STATUS_WIDTH);

type TextRenderOptions = {
  verbose?: boolean;
};

/**
 * The frozen per-check portion of the report.
 *
 * `init` embeds these lines in its own bounded result report, so it keeps this
 * renderer rather than inheriting doctor's new triage header.
 */
export const formatCheckReport = (
  report: DoctorReport,
  { verbose = false }: TextRenderOptions = {},
): string => {
  const lines = report.checks.flatMap((entry) => {
    const head = `${entry.status.padEnd(STATUS_WIDTH)}${entry.title} — ${entry.detail}`;
    const fixed = entry.fixed ? [`${DETAIL_INDENT}fixed by --fix`] : [];
    const fix =
      entry.fix === null
        ? []
        : entry.fix.split('\n').map((line) => `${DETAIL_INDENT}fix: ${line}`);
    const diagnostics =
      verbose === false
        ? []
        : [
            ...Object.entries(entry.evidence)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, value]) => `${DETAIL_INDENT}evidence.${key}: ${value === '' ? '(empty)' : value}`),
            ...(entry.skipReason === undefined ? [] : [`${DETAIL_INDENT}skipReason: ${entry.skipReason}`]),
            ...(entry.durationMs === undefined ? [] : [`${DETAIL_INDENT}durationMs: ${entry.durationMs}`]),
          ];
    return [head, ...fixed, ...fix, ...diagnostics];
  });
  return `${lines.join('\n')}\n`;
};

const formatSummary = (report: DoctorReport): string => {
  const { ok, warn, fail, skipped, durationMs } = report.summary;
  return `${ok} ok, ${warn} warnings, ${fail} failed, ${skipped} skipped (${durationMs}ms)`;
};

/**
 * `fixPlan` already owns membership and ordering. Rendering only resolves its
 * ids to rows and removes repeated remediation text from this new header.
 */
const formatFixPlan = (report: DoctorReport): string[] => {
  const checksById = new Map(report.checks.map((check) => [check.id, check]));
  const seenFixes = new Set<string>();

  return report.fixPlan.flatMap((id, index) => {
    const check = checksById.get(id);
    if (check === undefined) return [];

    const fix = check.fix;
    const showFix = fix !== null && !seenFixes.has(fix);
    if (fix !== null) seenFixes.add(fix);
    const renderedFix = showFix ? ` (${fix.replace(/\r?\n/g, ' ')})` : '';
    return [`${index + 1}. [${check.status}] ${check.id} — ${check.detail}${renderedFix}`];
  });
};

export const formatReport = (report: DoctorReport, options: TextRenderOptions = {}): string => {
  const header = [report.headline, formatSummary(report), ...formatFixPlan(report)].join('\n');
  return `${header}\n${formatCheckReport(report, options)}`;
};
