/**
 * `commitlore doctor --jev` — #1050.
 *
 * A separate, opt-in report. Ordinary `doctor` output is unchanged by default,
 * because a default installation has no prototype to diagnose and an extra
 * section about a feature nobody enabled is noise in the one command people run
 * when something is wrong.
 *
 * It makes **no provider call**. Everything here is read locally: an
 * environment variable, the repository's own capture policy, the settings entry,
 * the session descriptor and the optional last-result file. A diagnostic that
 * spends money to tell you whether it is configured is not a diagnostic.
 *
 * ## What it refuses to imply
 *
 * The last-result file is best effort and describes one earlier invocation. It
 * is not a ledger, its timestamp does not establish that the newest commit was
 * inspected, and "published" is a statement about a message file rather than
 * about a commit. Every one of those is said in the output rather than left for
 * the reader to work out, because the natural reading of a status line next to a
 * recent time is the wrong one.
 */
export interface JevReportInput {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
}
/**
 * The report, as lines.
 *
 * Returned rather than printed so a test can read it without capturing a
 * stream, which is the convention the rest of this codebase's commands follow.
 */
export declare const jevReport: (input: JevReportInput) => readonly string[];
