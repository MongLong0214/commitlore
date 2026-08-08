/**
 * Doctor's human-readable report renderer.
 *
 * It owns text formatting alone so the frozen output can be verified separately
 * from diagnosis and command registration.
 */
import type { DoctorReport } from './model.js';
export declare const formatReport: (report: DoctorReport) => string;
