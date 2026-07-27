export interface RecordedHookTarget {
    readonly bin: string;
    readonly node: string;
    readonly problems: readonly string[];
}
/**
 * The shell stub's `case "$recorded" in *.mjs|*.js)` pattern, restated so
 * TypeScript callers — `readRecordedHookTarget` below and `doctor`'s
 * COMMITLORE_BIN report — agree with the stub about what it will run instead
 * of guessing at it independently.
 */
export declare const hasAllowedBinExtension: (path: string) => boolean;
export declare const readRecordedHookTarget: (cwd: string) => RecordedHookTarget;
export declare const describeRecordedHookTarget: (target: RecordedHookTarget) => readonly string[];
