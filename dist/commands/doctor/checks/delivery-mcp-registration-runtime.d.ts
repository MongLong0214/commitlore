/**
 * The `mcp-registration-runtime` doctor check.
 *
 * Whether the command `.mcp.json` registers can actually be launched from the
 * environment a host gives it — not whether the file says the right words.
 *
 * A user reported `CONNECTION_CLOSED` for a project-scoped CommitLore server
 * while their CLI worked. Their tools then resolved to a different, already
 * running CommitLore server owned by another process, which answered about a
 * different repository, and every field of every answer was internally
 * consistent. Measured: `.mcp.json` registers the bare name `commitlore`,
 * `command -v commitlore` finds it in an interactive shell, and under
 * `PATH=/usr/bin:/bin` — roughly what a GUI- or daemon-launched host inherits —
 * it is not found at all. The repository's own `mcp-lifecycle.log` carried
 * `started` lines for older versions and none for the installed one, which is
 * the signature of a binary that was never executed: `recordServerStart` runs
 * inside the server, so a spawn that fails leaves nothing behind anywhere.
 *
 * **The bare name is not the defect.** `.mcp.json` is committed, and
 * `core/mcp-registration.ts` says in as many words why an absolute path is
 * refused there: it would break for the next clone. A machine-local path in a
 * shared file trades one host's PATH miss for a guaranteed miss on every other
 * machine, which is worse. The registration is portable on purpose.
 *
 * What was missing is that nothing ever checked the pairing. `hooks install`
 * has had this for its own hook since #910 — `capture-hook-runtime` executes the
 * installed hook under a PATH carrying no node, because that is the environment
 * git really gives it — and the same question was never asked of the MCP
 * registration. So this asks it the same way, and reports an exposure rather
 * than rewriting a shared file to suit one machine.
 *
 * `warn`, not `fail`: the host may be launched from a shell that does carry the
 * directory, in which case nothing is broken today. What the row buys is that
 * the failure stops being silent — a server that never starts writes no log, and
 * the tools quietly answer from somewhere else.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
export declare const checkMcpRegistrationRuntime: (ctx: DoctorContext) => DoctorCheck;
