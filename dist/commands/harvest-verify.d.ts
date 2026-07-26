/**
 * `commitlore harvest-verify` — the gate between a draft and the protocol
 * (T-404, ADR-0006 §5).
 *
 * Two things run here, in order: T-403's format check on the document, then the
 * verifier's citation check on what survived it. Records that clear both are
 * printed in the same `{"records": [...]}` shape `harvest --draft` emits, so the
 * two commands compose.
 *
 * Exit codes carry the whole non-blocking policy. A draft where every single
 * record was fabricated exits 0 — the commit it sits next to is not this
 * command's to fail (ADR-0006: 전량 실패 시 비차단, PRD-F4 요구 4). Only a caller
 * mistake exits 2: a missing option, a path that cannot be read, a draft that is
 * not a draft. That distinction is the difference between a feature people
 * leave on and one they uninstall the first time it eats a commit.
 */
import type { Command } from 'commander';
export interface HarvestVerifyOptions {
    draft?: string | undefined;
    transcript?: string | undefined;
    diff?: string | undefined;
    out?: string | undefined;
    json?: boolean | undefined;
    repairPrompt?: boolean | undefined;
}
/** What the command would print. Returned rather than written so it is testable. */
export interface HarvestVerifyOutcome {
    stdout: string;
    stderr: string;
    exitCode: number;
}
/**
 * Runs the command and reports what it would print. Failures come back as an
 * outcome rather than an exception so the caller prints one line and never a
 * stack trace — a stack trace in the middle of somebody's commit is noise that
 * tells them nothing they can act on.
 */
export declare const runHarvestVerify: (options: HarvestVerifyOptions) => HarvestVerifyOutcome;
export declare const register: (program: Command) => void;
