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
/** The four outcomes #543 named, plus the two the CLI still has to speak. */
export type CaptureOutcome = 'staged' | 'empty' | 'rejected' | 'usage' | 'operational' | 'internal';
export type CaptureErrorKind = 'usage' | 'rejected' | 'operational' | 'internal';
export declare const markCaptureError: (error: Error, kind: CaptureErrorKind) => Error;
export declare const captureKindOf: (error: unknown) => CaptureErrorKind | undefined;
/**
 * Classify a thrown value. Marked errors win. A git failure and a filesystem
 * errno the throw site did not mark are still operational — those are host
 * problems, not "nothing to record". Everything else is internal: silence is
 * a conclusion the product reached, not a place exceptions fall into.
 */
export declare const classifyCaptureError: (error: unknown) => CaptureOutcome;
export declare const exitCodeForCaptureOutcome: (outcome: CaptureOutcome) => 0 | 2 | 3 | 4;
export declare const messageOf: (error: unknown) => string;
