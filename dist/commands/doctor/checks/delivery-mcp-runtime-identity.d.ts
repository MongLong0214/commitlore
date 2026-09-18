/** The live-process identity check for MCP servers (#F-001). */
import { type DoctorCheck, type DoctorContext } from '../model.js';
/**
 * A registration records an intended launch; only the process list identifies
 * which already-running server owns a client's current session. Identity is the
 * path, never the version: a copied or stale install can legitimately report the
 * same one, so a version cannot say which of several runtimes is current. It can
 * say that one of them is not this build, which is a different claim and the only
 * one `differingFrom` makes.
 */
export declare const checkMcpRuntimeIdentity: (ctx: DoctorContext) => DoctorCheck;
