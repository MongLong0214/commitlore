/**
 * The `release-freshness` doctor check (T-1605, #742).
 *
 * **Why this is not the notice.** `doctor` already reports a hook interpreter
 * running a different version from the CLI, and that report is what found
 * #735; a newer release existing is the same kind of fact. Leaving it in
 * neither class had teeth: the notice is silent for every `--json`
 * invocation, so the one structured contract anybody consumes could not carry
 * staleness and the notice could not appear there either. It would have been
 * invisible in the output built for programs to read.
 *
 * **It ignores `CI` and the terminal**, unlike the notice and like the
 * command. A report that omits part of itself when piped lies to whatever is
 * reading it.
 *
 * **The status never changes an exit code.** A newer release is not a
 * violation -- the same reasoning that makes `upgrade --check` exit 0 -- so
 * this reports `ok` with the fact in its detail rather than `warn`.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
export declare const checkReleaseFreshness: (ctx: DoctorContext) => DoctorCheck;
