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
import { type Lifecycle, type Trailer } from '../core/types.js';
interface Section {
    /** The heading `context` prints, and the name of the command that isolates it. */
    label: string;
    key: string;
}
/**
 * Presents a blocked record: identity kept, every prose-bearing trailer gone.
 *
 * The whole record, not the matched trailer (#931). `matchedTrailerKeys` names
 * the key that tripped the scanner so the diagnostic can say which line to
 * edit; it is not a boundary between a hostile trailer and innocent siblings,
 * because there is none. The siblings were written by the same author in the
 * same commit, and the one attack shape the pattern table says it cannot see
 * is a payload split across several trailers, each innocent
 * (`INJECTION_PATTERNS`). A tripped trailer is the only signal that a split is
 * under way, so withholding its siblings is the one place that blind spot is
 * partly covered; serving them would hand over exactly the part of the payload
 * the table could not recognise. #596 drew the same line for paths — a
 * withheld record whose filenames still print is not withheld — and a sibling
 * trailer is more attacker-controlled than a filename, not less. The cost is a
 * false positive withholding an honest `Limit:` beside it; that cost now lands
 * on the author at capture and commit time, where the wording can still
 * change, rather than on every later reader.
 */
export declare const withholdBlocked: (result: QueryResult) => QueryResult;
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
    identityCollision: boolean;
    provenance: string | null;
    supersededBy: string | null;
    expiresAt: string | null;
    paths: string[];
    trailers: Trailer[];
}
export interface JsonOutput {
    command: string;
    /** Which build answered — version and the bundle it ran from (#631). */
    runtime: {
        version: string;
        build_id: string;
    };
    /** Whether this answer read everything it was asked about (#631, #669). */
    coverage: 'complete' | 'partial';
    /**
     * Where the answer was read from (#930).
     *
     * `coverage` answers "was the scan truncated". It cannot answer "was the walk
     * started from a commit that can reach the records", and a checkout behind its
     * own fetched upstream returns zero records with every other field green. A
     * client deciding whether an empty answer means "nothing was recorded" has to
     * read `vantage.behind` as well.
     */
    vantage: {
        head: string | null;
        ref: string | null;
        upstream: string | null;
        behind: number | null;
    };
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
    /**
     * `ready` | `empty` | `unavailable`. On `unavailable` the `records` array is
     * not a statement about this repository — git could not answer.
     */
    history: string;
    notes: string;
    /**
     * Commits a budget left unread. Always present: 0 means the answer was drawn
     * from the whole history, and anything else means it was not.
     */
    unreadCommits: number;
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
