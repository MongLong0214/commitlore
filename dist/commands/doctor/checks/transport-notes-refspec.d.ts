/**
 * The `notes-refspec` doctor check.
 *
 * It owns the reversible fetch-configuration diagnosis and fix because no
 * sibling check may alter transport configuration on its behalf.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
export declare const checkRefspec: (ctx: DoctorContext) => DoctorCheck;
