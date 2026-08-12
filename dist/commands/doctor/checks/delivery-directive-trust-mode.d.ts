/**
 * Reports the configured boundary for the `[directive]` tier.
 *
 * Both supported modes are an `ok` row: author-string mode is the default for
 * repositories that have not chosen an adversarial threat model, and signature
 * mode is an explicit extra boundary. Doctor's job is to make the choice
 * legible, not to turn one supported choice into a recurring warning.
 *
 * A third state is not a choice. When the setting is present and unparseable,
 * somebody wrote it deliberately and it does not say what they meant. Grading
 * fails closed to signature mode, and this row says so — reporting `ok` there
 * was how a typo in a security opt-in stayed invisible while the diagnostic
 * that exists to surface it called the repository healthy.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
export declare const checkDirectiveTrustMode: (ctx: DoctorContext) => DoctorCheck;
