/**
 * The `index-health` doctor check.
 *
 * It owns the derived-index observation because the index is an independent
 * cache whose health must never be inferred from another check's result.
 */
import { type DoctorCheck, type DoctorOptions } from '../model.js';
export declare const checkIndex: (opts: DoctorOptions) => DoctorCheck;
