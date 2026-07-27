/**
 * `commitlore validate` — machine refusal of malformed records (SPEC §6).
 *
 * Three contracts hold this command in place, because a hook and a CI job both
 * branch on them (SPEC §10):
 *
 *   exit 0  no violations
 *   exit 1  violations found
 *   exit 2  usage or input error (bad flags, unreadable file, unknown revision)
 *
 * 1 must mean "the record is wrong" and nothing else, so an unreadable
 * `--message-file` is 2, not 1 — otherwise a broken invocation reads as a
 * rejected commit.
 *
 * The command never edits its input (SPEC §6: implementations MUST NOT silently
 * repair). It reads, reports, and exits.
 *
 * Shape checks run for every input. Reference checks additionally run when the
 * input mode identifies a repository.
 */
import type { Command } from 'commander';
import { type Violation } from '../core/types.js';
import { type SecretFinding } from '../core/secret-guard.js';
/**
 * A violation plus where it was found. `line` is 1-based and counts lines of
 * the original message, because the repair loop moves an editor cursor by it.
 * Both fields are omitted rather than guessed when they cannot be established
 * (see `locateTrailerLines` and `lineForViolation`).
 */
export interface LocatedViolation extends Violation {
    sha?: string;
    line?: number;
}
export interface ValidateInput {
    messageFile?: string;
    commit?: string;
    range?: string;
    json?: boolean;
    cwd?: string;
    /** Injectable so tests never depend on the process's real stdin. */
    readStdin?: () => string;
}
/** Exit code, plus the streams the caller writes. Returned rather than printed so tests can drive the command in-process. */
export interface ValidateResult {
    code: 0 | 1 | 2;
    stdout: string;
    stderr: string;
    violations: LocatedViolation[];
    /**
     * Credentials found in the message. Separate from `violations` because they
     * are not a protocol violation -- the record can be perfectly well-formed and
     * still be inscribing a secret into history permanently (ADR-0005).
     */
    secrets: SecretFinding[];
    checks: ValidationCheck[];
}
export declare const CHECK_CLASS_NEEDS: {
    readonly shape: "message";
    readonly reference: "repository";
    readonly conservation: "before and after";
};
export type CheckClass = keyof typeof CHECK_CLASS_NEEDS;
export type CheckStatus = 'ok' | 'failed' | 'not-checked';
export interface ValidationCheck {
    class: Exclude<CheckClass, 'conservation'>;
    status: CheckStatus;
    reason?: string;
}
/**
 * Validates one or more commit messages. Never throws for an input problem:
 * every failure comes back as a `code`, so the caller decides how to exit.
 */
export declare const runValidate: (input?: ValidateInput) => ValidateResult;
export declare const register: (program: Command) => void;
