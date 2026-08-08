/**
 * The `commit-msg-hook` doctor check.
 *
 * It owns the installed-hook diagnosis while accepting the runtime row from
 * the registry, keeping its sole declared relationship out of sibling imports.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
/**
 * Installation belongs to `commitlore hooks install` (T-202). This reads.
 *
 * The marker is imported from the stub rather than restated, so that doctor
 * can never disagree with the installer about what "installed" means.
 */
export declare const checkHook: (ctx: DoctorContext, runtime: DoctorCheck) => DoctorCheck;
