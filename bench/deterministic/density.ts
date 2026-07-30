import { command } from './shared.ts';
import type { DensityRow, RowBase } from './types.ts';

const COMMIT_MESSAGES_FORMAT = '--format=%B%x00';
const TRAILER_PARSE_ARGS = [
  '-c',
  'trailer.separators=:',
  'interpret-trailers',
  '--parse',
  '--no-divider',
] as const;

const parseBlock = (repoRoot: string, message: string): readonly string[] =>
  command('git', TRAILER_PARSE_ARGS, { cwd: repoRoot, input: message })
    .stdout.split('\n')
    .filter((line) => line !== '');

const recordBlockTrailerCounts = (repoRoot: string, message: string): readonly number[] => {
  const paragraphs = message
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .filter((paragraph) => paragraph.trim() !== '');
  const last = parseBlock(repoRoot, message);
  const earlier = paragraphs.slice(0, -1).filter((paragraph) => paragraph.includes('Record-Id:')).flatMap((paragraph) => {
    const block = parseBlock(repoRoot, `x\n\n${paragraph}`);
    return block.some((line) => line.startsWith('Record-Id:')) ? [block.length] : [];
  });
  return last.length === 0 ? earlier : [...earlier, last.length];
};

const bodyLineCount = (message: string): number =>
  message
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '').length;

/**
 * CoMRAT defines rationale and decision density as semantic sentence counts per
 * commit message. Trailer syntax cannot establish whether a line is a rationale
 * or a decision sentence, so this benchmark deliberately reports only the
 * structural, machine-addressable proxy below rather than mislabelling it as a
 * CoMRAT rationale or decision density.
 */
export const measureDensity = (
  base: RowBase,
  repoRoot: string,
  ref = 'HEAD',
): DensityRow => {
  const messages = command('git', ['log', COMMIT_MESSAGES_FORMAT, ref], { cwd: repoRoot })
    .stdout.split('\0');
  messages.pop();
  const commitMessages = messages.map((message) =>
    message.startsWith('\n') ? message.slice(1) : message,
  );

  // Detect merge commits by parent count (>1 parent = merge)
  const parentCounts = command(
    'git', ['log', '--format=%P', ref], { cwd: repoRoot },
  ).stdout.trim().split('\n').map((line) => line.trim().split(/\s+/).filter((h) => h !== '').length);

  let recordBearingCommits = 0;
  let authoredRecordBearingCommits = 0;
  let structuredTrailers = 0;
  let nonEmptyBodyLines = 0;
  let mergeCommits = 0;

  for (let i = 0; i < commitMessages.length; i += 1) {
    const message = commitMessages[i]!;
    const isMerge = (parentCounts[i] ?? 0) > 1;
    if (isMerge) mergeCommits += 1;

    const blocks = recordBlockTrailerCounts(repoRoot, message);
    if (blocks.length > 0) {
      recordBearingCommits += 1;
      if (!isMerge) authoredRecordBearingCommits += 1;
    }
    structuredTrailers += blocks.reduce((count, trailers) => count + trailers, 0);
    nonEmptyBodyLines += bodyLineCount(message);
  }

  const commitsExamined = commitMessages.length;
  const authoredCommits = commitsExamined - mergeCommits;
  return {
    ...base,
    metric: 'rationale_density',
    history_ref: ref,
    commits_examined: commitsExamined,
    merge_commits: mergeCommits,
    authored_commits: authoredCommits,
    record_bearing_commits: recordBearingCommits,
    authored_record_bearing_commits: authoredRecordBearingCommits,
    structured_trailers: structuredTrailers,
    non_empty_body_lines: nonEmptyBodyLines,
    record_bearing_rate: commitsExamined === 0 ? 0 : recordBearingCommits / commitsExamined,
    authored_record_bearing_rate: authoredCommits === 0 ? 0 : authoredRecordBearingCommits / authoredCommits,
    trailers_per_commit: commitsExamined === 0 ? 0 : structuredTrailers / commitsExamined,
    structured_trailer_line_share:
      nonEmptyBodyLines === 0 ? 0 : structuredTrailers / nonEmptyBodyLines,
  };
};
