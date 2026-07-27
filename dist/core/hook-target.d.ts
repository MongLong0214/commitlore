export interface RecordedHookTarget {
    readonly bin: string;
    readonly node: string;
    readonly problems: readonly string[];
}
export declare const readRecordedHookTarget: (cwd: string) => RecordedHookTarget;
export declare const describeRecordedHookTarget: (target: RecordedHookTarget) => readonly string[];
