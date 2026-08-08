/**
 * Doctor's registry runner.
 *
 * It owns exception containment and timing around the ordered registry, so
 * check modules only decide their own verdicts and rendering cannot alter run order.
 */
import { type DoctorOptions, type DoctorReport } from './model.js';
export declare const runDoctor: (opts?: DoctorOptions) => DoctorReport;
