/**
 * The four consumer-route commands of SPEC §5:
 *
 *   commitlore context   [-- <path>]   every kind, with an active summary header
 *   commitlore limits    [-- <path>]   Limit:
 *   commitlore ruled-out [-- <path>]   Ruled-out:
 *   commitlore warnings  [-- <path>]   Warn:, with its trust grade (SPEC §7)
 *
 * All four are the same query with a different key filter, so they share one
 * option set, one JSON schema and one renderer. The engine is `core/query.ts`;
 * this file is the impure shell around it — argument parsing, the default
 * evaluation instant, and formatting.
 *
 * Exit status is 0 even when nothing comes back. A path with no records is the
 * normal state of most of a repository (SPEC §4: a commit that recorded
 * nothing is not an error), and a query that exits non-zero on an empty answer
 * would make every agent treat "nothing to know here" as a failure.
 */
import type { Command } from 'commander';
import { type QueryResult, type TrustGrade } from '../core/query.js';
import type { Lifecycle, Trailer } from '../core/types.js';
interface Section {
    /** The heading `context` prints, and the name of the command that isolates it. */
    label: string;
    key: string;
}
export interface JsonRecord {
    recordId: string | null;
    sha: string;
    shas: string[];
    committedAt: string;
    source: string;
    sources: string[];
    lifecycle: Lifecycle;
    flags: string[];
    trust: TrustGrade | null;
    provenance: string | null;
    supersededBy: string | null;
    expiresAt: string | null;
    paths: string[];
    trailers: Trailer[];
}
export interface JsonOutput {
    command: string;
    at: string;
    paths: string[];
    aliases: string[];
    follow: boolean;
    fromIndex: boolean;
    scanned: number;
    counts: {
        records: number;
        limits: number;
        ruledOut: number;
        warnings: number;
        other: number;
    };
    /**
     * `present` | `absent` | `unfetched` — whether the notes mirror could be read.
     *
     * A machine consumer needs this next to `counts.records`: zero records with
     * `notes: "unfetched"` is an unknown, not an empty, and the two are otherwise
     * the same bytes.
     */
    notes: string;
    diagnostics: string[];
    records: JsonRecord[];
}
export declare const toJson: (command: string, result: QueryResult) => JsonOutput;
/** `limits`, `ruled-out` and `warnings`: one section, no header block. */
export declare const formatKind: (result: QueryResult, section: Section) => string;
/**
 * `context`: every kind at once, under the summary header the ticket asks for
 * — how many of each kind are active, the instant they were judged at, and
 * whether the index answered.
 */
export declare const formatContext: (result: QueryResult) => string;
export declare const register: (program: Command) => void;
export {};
