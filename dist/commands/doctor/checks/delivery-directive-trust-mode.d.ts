/**
 * Reports the configured boundary for the `[directive]` tier.
 *
 * This is intentionally an `ok` row in both modes: author-string mode is the
 * supported default for repositories that have not chosen an adversarial
 * threat model, and signature mode is an explicit extra boundary. Doctor's
 * job here is to make the choice legible, not to turn one supported choice
 * into a recurring warning.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
export declare const checkDirectiveTrustMode: (ctx: DoctorContext) => DoctorCheck;
