/**
 * `commitlore index` — build or refresh the derived SQLite index (T-203).
 *
 * The index holds nothing git does not already hold (ADR-0003), so this
 * command never reports a broken index as a failure: an unreadable file, a
 * schema version from another release, or a rewritten history all become a
 * rebuild, announced on stderr and named in `rebuildReason`.
 *
 * `--no-index` runs the same read through `scanTrailers`, writing nothing. It
 * exists so the fallback path can be exercised — and compared — on a real
 * repository rather than only in tests.
 */
import type { Command } from 'commander';
export declare const register: (program: Command) => void;
