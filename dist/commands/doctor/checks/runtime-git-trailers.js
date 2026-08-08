/**
 * The `git-trailers` doctor check.
 *
 * It owns the runtime capability probe because only this check judges Git's
 * trailer parser; the probe message and report factory remain shared model data.
 */
import { execGit } from '../../../core/git.js';
import { parseCommitMessage } from '../../../core/trailers.js';
import { check, gitOptions, PROBE_MESSAGE } from '../model.js';
/**
 * Runs the real parse path once. Trailer boundaries are git's to decide
 * (SPEC §2), so a git that cannot do this makes every other answer suspect —
 * the one condition that fails the command.
 *
 * The probe runs in the process's own directory rather than `cwd`: it tests
 * the git binary on `PATH` and this codebase's parse path, neither of which is
 * a property of the repository being inspected.
 */
export const checkGit = (opts) => {
    const title = 'git interpret-trailers';
    const id = 'git-trailers';
    const category = 'runtime';
    const version = execGit(['--version'], gitOptions(opts)).stdout.trim();
    const upgrade = 'install a git that supports interpret-trailers --parse (git >= 2.9)';
    let trailers;
    try {
        trailers = parseCommitMessage(PROBE_MESSAGE);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return check(id, category, title, 'fail', `${version || 'git'} could not parse a probe: ${reason}`, upgrade, false, undefined, { evidence: { git_version: version || 'unavailable', parsed: 'unavailable' } });
    }
    const parsed = trailers.map((trailer) => `${trailer.key}: ${trailer.value}`).join(', ');
    if (parsed !== 'Limit: probe, Blast: local') {
        return check(id, category, title, 'fail', `${version} parsed the probe as [${parsed}]`, upgrade, false, undefined, { evidence: { git_version: version || 'unavailable', parsed } });
    }
    return check(id, category, title, 'ok', `${version} parses trailers as the spec expects`, null, false, undefined, { evidence: { git_version: version || 'unavailable', parsed } });
};
//# sourceMappingURL=runtime-git-trailers.js.map