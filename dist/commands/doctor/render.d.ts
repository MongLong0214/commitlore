/**
 * Doctor's human-readable report renderer.
 *
 * It owns text formatting alone so the frozen output can be verified separately
 * from diagnosis and command registration.
 */
import type { DoctorReport } from './model.js';
type TextRenderOptions = {
    verbose?: boolean;
};
/**
 * The frozen per-check portion of the report.
 *
 * `init` embeds these lines in its own bounded result report, so it keeps this
 * renderer rather than inheriting doctor's new triage header.
 */
export declare const formatCheckReport: (report: DoctorReport, { verbose }?: TextRenderOptions) => string;
export declare const formatReport: (report: DoctorReport, options?: TextRenderOptions) => string;
export {};
