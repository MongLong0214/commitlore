export interface RecordedHookTarget {
    readonly bin: string;
    readonly node: string;
    readonly problems: readonly string[];
}
/**
 * What the recorded (or `COMMITLORE_BIN`-overridden) path resolves to, if
 * anything: `script` runs through a separate interpreter and sits somewhere
 * under the install root (a directory); `binary` (#39) is a compiled
 * single-executable build with neither extension nor an interpreter of its
 * own — it *is* the interpreter, so its "root" is the one file, not a
 * directory it happens to sit under.
 *
 * A binary is recognized by name (`commitlore`, the name `scripts/build-binary.mjs`
 * gives its output), not merely by having no extension — "any extensionless
 * file" would allow-list every other executable on the machine the moment it
 * lost the `.js`/`.mjs` check.
 */
export type BinKind = 'script' | 'binary';
export declare const classifyBinTarget: (path: string) => BinKind | null;
/**
 * The shell stub's `case "$recorded" in` patterns — `*.mjs`/`*.js` for a
 * script, a basename of `commitlore` for a compiled binary — restated so
 * TypeScript callers — `readRecordedHookTarget` below and `doctor`'s
 * `COMMITLORE_BIN` report — agree with the stub about what it will run
 * instead of guessing at it independently.
 */
export declare const hasAllowedBinExtension: (path: string) => boolean;
export declare const readRecordedHookTarget: (cwd: string) => RecordedHookTarget;
export declare const describeRecordedHookTarget: (target: RecordedHookTarget) => readonly string[];
