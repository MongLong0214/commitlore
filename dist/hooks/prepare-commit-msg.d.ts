import type { Command } from 'commander';
import { type PendingRecord } from '../core/pending.js';
export declare const PREPARE_COMMIT_MSG_HOOK_MARKER = "# commitlore:prepare-commit-msg:v1";
export declare const PREPARE_COMMIT_MSG_HOOK_NAME = "prepare-commit-msg";
export declare const PREPARE_COMMIT_MSG_CHAINED_HOOK_NAME = "prepare-commit-msg.commitlore-chained";
/**
 * Renamed from the shared body, not from the gate's text: this hook composes a
 * message, it never rejects one, so it takes the ending that lets the commit
 * through (#354). The two replacements below only rename — the marker, the
 * chained hook beside it, and the subcommand it execs.
 */
export declare const prepareCommitMsgStub: () => string;
export declare const preserveSquashRecords: (messageFile: string, cwd?: string) => boolean;
export interface PrepareCommitMsgHookResult {
    readonly code: 0 | 2;
    readonly stdout: string;
    readonly stderr: string;
}
export declare const installPrepareCommitMsgHook: (cwd?: string) => PrepareCommitMsgHookResult;
/**
 * Serialize the records array's trailers into a canonical trailer block string.
 *
 * Exported so the optional producer (#1048) composes its candidate with *this*
 * function rather than a second copy of it. The bytes a record turns into are
 * what `markApplied` hashes and what a reader later parses, so two
 * serializations that agree today and drift tomorrow would show up as a record
 * that validates and then fails its own applied-hash check.
 */
export declare const pendingTrailerBlock: (records: readonly unknown[]) => string;
/**
 * How a trailer block joins a message — the same separator rule the native
 * application below uses, for the same reason (#1048).
 *
 * `git interpret-trailers` needs the block to be its own final paragraph, and
 * getting that separator wrong is the failure mode where every check stays green
 * and the whole record is silently dropped.
 */
export declare const composeWithTrailerBlock: (message: string, trailerBlock: string) => string;
/**
 * Newer eligible capture first. `created_at` is the recorded instant, not the
 * nonce filename — the filename is `randomBytes(16)` hex, so lexicographic
 * order is a coin flip (#591).
 *
 * An `applied` file after a failed commit stays eligible (ADR-0021 §4, gate-a
 * scenario 6). It is not ranked below `staged`. Preferring staged would attach
 * an older leftover staged file over the capture that just nearly landed.
 * Marking `applied` abandoned was rejected: Git has no hook for a failed
 * commit, and abandoning would break the unchanged-index retry.
 */
export declare const compareCaptureCandidates: (left: Pick<PendingRecord, "created_at" | "nonce">, right: Pick<PendingRecord, "created_at" | "nonce">) => number;
export declare const recordAmendIntent: (cwd: string, source?: string, sha?: string) => void;
export declare const register: (program: Command) => void;
