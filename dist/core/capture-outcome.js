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
/**
 * Marks a thrown `Error` as a capture kind so a caller can classify it
 * without matching on message text. A flag rather than an Error subclass,
 * same shape as `commitloreMissingInstalledFile` in `paths.ts`.
 */
const CAPTURE_KIND = 'commitloreCaptureKind';
export const markCaptureError = (error, kind) => {
    Object.defineProperty(error, CAPTURE_KIND, { value: kind });
    return error;
};
export const captureKindOf = (error) => {
    if (!(error instanceof Error))
        return undefined;
    const kind = error[CAPTURE_KIND];
    if (kind === 'usage' || kind === 'rejected' || kind === 'operational' || kind === 'internal') {
        return kind;
    }
    return undefined;
};
const errnoCode = (error) => {
    if (typeof error !== 'object' || error === null || !('code' in error))
        return undefined;
    return typeof error.code === 'string' ? error.code : undefined;
};
/**
 * Classify a thrown value. Marked errors win. A git failure and a filesystem
 * errno the throw site did not mark are still operational — those are host
 * problems, not "nothing to record". Everything else is internal: silence is
 * a conclusion the product reached, not a place exceptions fall into.
 */
export const classifyCaptureError = (error) => {
    const marked = captureKindOf(error);
    if (marked !== undefined)
        return marked;
    if (isGitFailure(error))
        return 'operational';
    const code = errnoCode(error);
    if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM' || code === 'ENOTDIR' || code === 'EROFS') {
        return 'operational';
    }
    return 'internal';
};
export const exitCodeForCaptureOutcome = (outcome) => {
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
export const messageOf = (error) => error instanceof Error ? error.message : String(error);
//# sourceMappingURL=capture-outcome.js.map