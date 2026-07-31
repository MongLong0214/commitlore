export interface RecordedHookTarget {
    readonly bin: string;
    readonly node: string;
    readonly problems: readonly string[];
}
/**
 * What the recorded (or `COMMITLORE_BIN`-overridden) path resolves to, if
 * anything: a `script` runs through a separate interpreter and sits somewhere
 * under the install root (a directory).
 *
 * There is one kind because there is one shipped artifact. ADR-0026 removed the
 * compiled single-executable build, and with it the arm that classified an
 * extensionless file named `commitlore` as something to exec directly. An
 * extensionless name is now refused rather than trusted: the installer's own
 * wrapper carries that name, and a wrapper is a shell script that execs node
 * rather than an interpreter in its own right, so the path worth recording is the
 * bundle it runs.
 */
export type BinKind = 'script';
export declare const classifyBinTarget: (path: string) => BinKind | null;
/**
 * The shell stub's `case "$recorded" in` pattern — `*.mjs`/`*.js` — restated so
 * TypeScript callers — `readRecordedHookTarget` below and `doctor`'s
 * `COMMITLORE_BIN` report — agree with the stub about what it will run
 * instead of guessing at it independently.
 */
export declare const hasAllowedBinExtension: (path: string) => boolean;
export declare const readRecordedHookTarget: (cwd: string) => RecordedHookTarget;
export declare const describeRecordedHookTarget: (target: RecordedHookTarget) => readonly string[];
