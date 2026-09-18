/** How many routes deliver this MCP server to one host (#1079). */
import { type DoctorCheck, type DoctorContext } from '../model.js';
/**
 * Two installers register the same server and neither can see the other.
 *
 * #781 found this for the `PreToolUse` hook and fixed it there; the MCP server
 * has the same two installers and kept the defect. A host carrying both runs two
 * copies of the product — two processes, and two sets of the same tools in front
 * of the agent, which is context spent twice on one capability.
 *
 * The part that makes it worth a row rather than a note is that they are
 * separate *installations* and so drift apart. Measured on one machine: a
 * session whose plugin server was 1.3.17 while its user-scope registration
 * served 1.5.0. Inside that one session the hooks graded every edit by one
 * build's rules while the tools answered as another's, and no row said so —
 * `mcp-runtime-identity` saw two live processes and grouped them by path,
 * `runtime-identity` compared versions against a lifecycle entry that happened
 * to be the newer one, and `mcp-registration-runtime` reads project scope only.
 *
 * `init` no longer adds the second registration, but that fix reaches nobody who
 * already has both, which is what this row is for.
 *
 * `warn`, never `fail`, and it does not claim attention: what it observes is the
 * user's host configuration rather than this repository, and `init` treats a
 * check needing attention as a step that did not complete (#750).
 */
export declare const checkMcpDeliveryRoutes: (ctx: DoctorContext) => DoctorCheck;
