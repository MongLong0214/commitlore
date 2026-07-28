import type { Command } from 'commander';
export declare const PREPARE_COMMIT_MSG_HOOK_MARKER = "# commitlore:prepare-commit-msg:v1";
export declare const PREPARE_COMMIT_MSG_HOOK_NAME = "prepare-commit-msg";
export declare const PREPARE_COMMIT_MSG_CHAINED_HOOK_NAME = "prepare-commit-msg.commitlore-chained";
export declare const prepareCommitMsgStub: () => string;
export declare const preserveSquashRecords: (messageFile: string, cwd?: string) => boolean;
export interface PrepareCommitMsgHookResult {
    readonly code: 0 | 2;
    readonly stdout: string;
    readonly stderr: string;
}
export declare const installPrepareCommitMsgHook: (cwd?: string) => PrepareCommitMsgHookResult;
export declare const register: (program: Command) => void;
