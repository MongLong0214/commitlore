/**
 * Doctor's ordered check registry.
 *
 * This is the single ownership point for report order and the one intentional
 * hook-runtime hand-off, so checks stay self-contained modules rather than
 * importing each other.
 */
import type { Category, DoctorCheck, DoctorContext } from './model.js';
/**
 * A check as data rather than a position in a hand-written array.
 *
 * What that buys, and why it is worth the indirection (ADR-0032 §4): ordering
 * becomes something a test can assert, `--only`/`--category` become filters
 * over data instead of new code paths, each `run` is testable in isolation, and
 * the dependencies that exist implicitly today get a declared place.
 */
export interface CheckDefinition {
    readonly id: string;
    readonly title: string;
    readonly category: Category;
    /** Ids of entries that appear earlier in this registry (PRD §2 req 2). */
    readonly dependencies: readonly string[];
    readonly optional: boolean;
    readonly run: (ctx: DoctorContext, dependencies: ReadonlyMap<string, DoctorCheck>) => DoctorCheck;
}
/**
 * The registry. **Order is the report's order**, frozen to the array
 * `runDoctor` shipped with, because PRD §9.1 holds the text byte-identical
 * until the rendering ticket.
 *
 * `commit-msg-hook → hook-runtime` is deliberately not declared here: the
 * dependency runs backwards against this order, and §2 req 2 admits only
 * earlier entries. It is threaded through `memo` instead and declared once the
 * ordering rule is settled.
 */
export declare const CHECK_REGISTRY: readonly CheckDefinition[];
