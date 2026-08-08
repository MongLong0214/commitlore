/**
 * Compatibility surface for `commitlore doctor`.
 *
 * The command grew as one module before the check seams existed, so callers
 * import this stable path. It owns no diagnosis now: re-exporting the split
 * modules keeps those callers stable while registry, runner, rendering, and
 * individual checks can have boundaries that match their responsibilities.
 */
export { evaluateInjectRun } from './doctor/checks/delivery-inject-runtime.js';
export { CHECK_REGISTRY, type CheckDefinition } from './doctor/registry.js';
export { formatCheckReport, formatReport } from './doctor/render.js';
export { register } from './doctor/report.js';
export { runDoctor } from './doctor/runner.js';
export type { Category, CheckStatus, DoctorCheck, DoctorContext, DoctorOptions, DoctorReport, DoctorStatus, InstallSource, Severity, SkipReason, } from './doctor/model.js';
