/**
 * `commitlore doctor --jev` — #1050.
 *
 * A separate, opt-in report. Ordinary `doctor` output is unchanged by default,
 * because a default installation has no prototype to diagnose and an extra
 * section about a feature nobody enabled is noise in the one command people run
 * when something is wrong.
 *
 * It makes **no provider call**. Everything here is read locally: an
 * environment variable, the repository's own capture policy, the settings entry,
 * the session descriptor and the optional last-result file. A diagnostic that
 * spends money to tell you whether it is configured is not a diagnostic.
 *
 * ## What it refuses to imply
 *
 * The last-result file is best effort and describes one earlier invocation. It
 * is not a ledger, its timestamp does not establish that the newest commit was
 * inspected, and "published" is a statement about a message file rather than
 * about a commit. Every one of those is said in the output rather than left for
 * the reader to work out, because the natural reading of a status line next to a
 * recent time is the wrong one.
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvePolicy } from '../core/capture-policy.js';
import { claudeSettingsPath, readClaudeHookStatus } from '../hooks/claude-settings.js';
import { JEV_SESSION_HOOK } from '../commands/jev-session.js';
import { describeActivation, resolveJevActivation } from './activation.js';
import { describeLastResult, readLastResult } from './diagnostic.js';
import { descriptorDir, SESSION_ENV } from './source-claude.js';
/**
 * The report, as lines.
 *
 * Returned rather than printed so a test can read it without capturing a
 * stream, which is the convention the rest of this codebase's commands follow.
 */
export const jevReport = (input) => {
    const { cwd, env } = input;
    const activation = resolveJevActivation(env);
    const lines = ['Experimental Jev auto-capture (optional prototype)'];
    lines.push(`  activation: ${describeActivation(activation)}`);
    // Native consent, reported separately and always. A key is consent to the
    // documented remote assessment; it is not permission to stage without the
    // repository's own consent, and the two being conflated is the most likely
    // way somebody misreads this output.
    const policy = resolvePolicy(cwd);
    const consent = policy.policy.mode === 'auto' && policy.policy.unattended
        ? 'given (mode auto, unattended true)'
        : `not given (mode ${policy.policy.mode}, unattended ${String(policy.policy.unattended)}) — ` +
            'run `commitlore auto on --local`';
    lines.push(`  native unattended consent: ${consent}`);
    // The installed entry. Reported as configuration, not as proof: a session
    // that started before the entry existed is not registered, and no amount of
    // settings inspection can say otherwise.
    const settings = readClaudeHookStatus(claudeSettingsPath(cwd), undefined, JEV_SESSION_HOOK);
    lines.push(`  SessionStart entry: ${settings.state} (${settings.settingsPath})` +
        (settings.problem === undefined ? '' : ` — ${settings.problem}`));
    // Registered sessions in *this* working tree. A count, and the id from the
    // environment when there is one, because "registered somewhere" and
    // "registered for the session you are in" are different answers.
    const dir = descriptorDir(cwd);
    let registered = 0;
    if (dir !== null && existsSync(dir)) {
        try {
            registered = readdirSync(dir).filter((file) => file.endsWith('.json')).length;
        }
        catch {
            registered = -1;
        }
    }
    const sessionId = env[SESSION_ENV]?.trim();
    const thisOne = sessionId === undefined || sessionId === ''
        ? 'no host session in this environment'
        : dir !== null && existsSync(resolve(dir, `${sessionId}.json`))
            ? 'this session is registered'
            : 'this session is NOT registered — restart the host after setting a key';
    lines.push(`  registered sources here: ${registered === -1 ? 'unreadable' : String(registered)} — ${thisOne}`);
    lines.push(`  ${describeLastResult(readLastResult(cwd))}`);
    lines.push('  No provider call was made to produce this report, and nothing above ' +
        'establishes that any commit carries a record — read git and `commitlore pending` for that.');
    return lines;
};
//# sourceMappingURL=report.js.map