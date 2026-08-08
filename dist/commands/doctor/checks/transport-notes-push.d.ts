/**
 * The `notes-push` doctor check.
 *
 * It owns the shared-reference observation because pushing is deliberately a
 * human action; no other check may perform or depend on that write.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
/**
 * Pushing is never automatic: `git push` writes to a ref other people read,
 * which is not something a diagnostic command gets to decide.
 */
export declare const checkPush: (ctx: DoctorContext) => DoctorCheck;
