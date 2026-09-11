/**
 * The `pending-backlog` doctor check.
 *
 * It owns the pending-transaction diagnosis because only that subsystem can
 * distinguish an ordinary waiting capture from one that can no longer apply.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
export declare const checkPendingBacklog: (ctx: DoctorContext) => DoctorCheck;
