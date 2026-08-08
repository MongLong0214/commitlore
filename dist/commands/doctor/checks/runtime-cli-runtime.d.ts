/**
 * The `cli-runtime` doctor check.
 *
 * It owns the installation artifact probe because that verdict is independent
 * of every other check; shared report construction remains in the model seam.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
/**
 * Whether the CLI this installation actually uses runs.
 *
 * **Which artifact is the installation is the whole question.** A git clone —
 * the documented distribution (ADR-0011) — ships `dist/commitlore.mjs`, a bundle
 * that needs no `node_modules`. A development checkout also has `dist/cli.js`,
 * the `tsc` output, which imports its dependencies and cannot run without them.
 * A compiled single-executable build (#39) is neither — it has no `dist/`
 * beside it at all, by design, and the question this check exists to answer
 * ("does the CLI this installation uses actually run") already has its answer
 * the moment this process is that binary and got far enough to ask.
 *
 * The first version of this check probed `dist/cli.js` unconditionally. On a
 * fresh clone that is a file that exists and cannot run, so the check invented a
 * failure in the one installation it was written to protect, and turned CI red
 * for three commits. A health check that reports the supported path as broken is
 * worse than no health check.
 *
 * `--version` is the cheapest thing the CLI can be asked to do that still forces
 * the runtime to resolve, the bundle to load, and its imports to resolve.
 */
export declare const checkRuntime: (ctx: DoctorContext) => DoctorCheck;
