/**
 * The `history-depth` doctor check.
 *
 * It owns the shallow-history observation because history completeness is an
 * independent limitation on every query, not a dependency on another check.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
export declare const checkHistoryDepth: (ctx: DoctorContext) => DoctorCheck;
