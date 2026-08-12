/**
 * The `installation-integrity` doctor check.
 *
 * It owns the shipped-file probe because that verdict is independent of every
 * other check; a missing schema is not a degraded repository, it is a broken
 * installation, and doctor is the command that is supposed to say so.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
/**
 * Whether every file this installation ships and later reads is on disk.
 *
 * `validate` already refuses a missing schema with exit 3. doctor is the
 * command a user (and install-gate) run to learn that, and until this check
 * existed it reported healthy. `fail`, not `warn`: every commit against this
 * install is refused with a message the user cannot act on by editing, and a
 * warning would let install-gate keep passing.
 */
export declare const checkInstallationIntegrity: (_ctx: DoctorContext) => DoctorCheck;
