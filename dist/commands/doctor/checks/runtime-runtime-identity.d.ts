/** One doctor row that compares the programs actually selected by each surface. */
import { type DoctorCheck, type DoctorContext } from '../model.js';
/**
 * A single mismatch report, not four independent version checks.  The root and
 * entrypoint are compared with the version so two cache copies cannot appear
 * healthy merely because their package manifests carry the same release.
 */
export declare const checkRuntimeIdentity: (ctx: DoctorContext) => DoctorCheck;
