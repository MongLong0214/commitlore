/**
 * The `inject-version` doctor check.
 *
 * It owns comparison of the configured hook executable with this CLI, keeping
 * that freshness signal separate from the runtime check that establishes it runs.
 */
import { type DoctorCheck, type DoctorOptions } from '../model.js';
export declare const checkInjectVersion: (opts: DoctorOptions, dependencies: ReadonlyMap<string, DoctorCheck>) => DoctorCheck;
