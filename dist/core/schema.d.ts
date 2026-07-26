/**
 * Single-record validation (SPEC §6).
 *
 * `spec/schema/record.schema.json` is the shape authority; this module is the
 * translation layer that turns AJV's errors into the `Violation` records the
 * repair loop consumes. AJV's own messages never escape this file — they name
 * JSON Schema keywords, not protocol rules.
 */
import { type Trailer, type Violation } from './types.js';
/**
 * Validates one record — the trailers of a single commit — against SPEC §3,
 * returning every violation in trailer order. An empty array means the record
 * is well-formed (SPEC §4).
 *
 * Scope: this function sees one record and nothing else. It therefore never
 * reports `dangling-ref`, which asks whether a `Follows:`/`Supersedes:` target
 * exists elsewhere in history — a cross-record question owned by the stale
 * engine (T-205). A syntactically valid `Supersedes:` pointing at nothing is
 * clean here by design.
 */
export declare const validateRecord: (trailers: Trailer[]) => Violation[];
