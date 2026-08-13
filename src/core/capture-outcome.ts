/**
 * Capture's typed outcome (#543).
 *
 * `runCapture` returns one of these instead of letting a bare `catch` decide
 * what a failure was. The CLI maps them to exit codes; `--json` puts the
 * same name in the envelope so a caller never has to guess from an empty
 * stdout and a zero.
 *
 * An exception the code did not anticipate is `internal`, never silence.
 */

import { isGitFailure } from './git.js';

/** The four outcomes #543 named, plus the two the CLI still has to speak. */
export type CaptureOutcome = 'staged' | 'empty' | 'rejected' | 'usage' | 'operational' | 'internal';

/**
 * Marks a thrown `Error` as a capture kind so a caller can classify it
 * without matching on message text. A flag rather than an Error subclass,
 * same shape as `commitloreMissingInstalledFile` in `paths.ts`.
 */
const CAPTURE_KIND = 'commitloreCaptureKind';

export type CaptureErrorKind = 'usage' | 'rejected' | 'operational' | 'internal';

export const markCaptureError = (error: Error, kind: CaptureErrorKind): Error => {
  Object.defineProperty(error, CAPTURE_KIND, { value: kind });
  return error;
};

export const captureKindOf = (error: unknown): CaptureErrorKind | undefined => {
  if (!(error instanceof Error)) return undefined;
  const kind = (error as unknown as Record<string, unknown>)[CAPTURE_KIND];
  if (kind === 'usage' || kind === 'rejected' || kind === 'operational' || kind === 'internal') {
    return kind;
  }
  return undefined;
};

const errnoCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
};

/**
 * Classify a thrown value. Marked errors win. A git failure and a filesystem
 * errno the throw site did not mark are still operational — those are host
 * problems, not "nothing to record". Everything else is internal: silence is
 * a conclusion the product reached, not a place exceptions fall into.
 */
export const classifyCaptureError = (error: unknown): CaptureOutcome => {
  const marked = captureKindOf(error);
  if (marked !== undefined) return marked;
  if (isGitFailure(error)) return 'operational';
  const code = errnoCode(error);
  if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'ENOTDIR' || code === 'EROFS') {
    return 'operational';
  }
  return 'internal';
};

export const exitCodeForCaptureOutcome = (outcome: CaptureOutcome): 0 | 2 | 3 | 4 => {
  switch (outcome) {
    case 'staged':
    case 'empty':
    case 'rejected':
      return 0;
    case 'usage':
      return 2;
    case 'operational':
      return 3;
    case 'internal':
      return 4;
  }
};

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
