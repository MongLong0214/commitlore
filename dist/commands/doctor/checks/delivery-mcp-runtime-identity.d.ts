/** The live-process identity check for MCP servers (#F-001). */
import { type DoctorCheck, type DoctorContext } from '../model.js';
/**
 * A registration records an intended launch; only the process list identifies
 * which already-running server owns a client's current session. Never compare
 * versions here: a copied or stale install can legitimately report the same.
 */
export declare const checkMcpRuntimeIdentity: (ctx: DoctorContext) => DoctorCheck;
