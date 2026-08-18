/**
 * `commitlore upgrade` (T-1603, #742). This ticket ships the read-only half.
 *
 * The file is `update.ts` and the command is `upgrade`; F16 owns both names
 * and they deliberately differ. The verb changed from `update` after a review
 * round: `brew update` fetches an index, `npm update` updates a project's
 * dependencies, and `rustup update` updates toolchains -- two of the three
 * precedents for calling this `update` do not replace the tool that runs them.
 * `deno upgrade` and `bun upgrade` do, and they are called upgrade.
 *
 * **The acting form is T-1606's and is not reachable from here.** The
 * read-only half ships first so the reporting is trustworthy before anything
 * acts on it, and a test asserts this command starts no process other than
 * the `git ls-remote` the check owns. ADR-0037 is enforced rather than
 * described: a comment saying the CLI does not replace itself is not a guard.
 *
 * **Exit 0 whether or not an update exists.** A version query has no violation
 * to report -- `commitlore auto` settled the shape ("the answer is not a
 * finding") and `stale` exits 0 even when it finds something. Scripts branch
 * on `--json`. Non-zero stays reserved for a check that could not run at all.
 *
 * **It answers inside CI and off a terminal.** That is not an oversight in the
 * suppression rules: the notice has context gates and this command must not
 * share them, or the one scriptable form would be silent in the one place
 * scripts run.
 */
import { latestRelease, sourceUrl } from '../core/latest-release.js';
import { packageVersion, readInstalledFile } from '../core/paths.js';
import { isNewerRelease } from '../core/release-version.js';
/**
 * The install command, read from the README rather than restated.
 *
 * The two drifting apart is a known shape here (#727), and a literal copy in
 * this file is exactly how that starts. The README pins a version; an upgrade
 * names the tag it is upgrading to, so the shape is taken and the tag
 * replaced.
 */
export const installCommand = (tag, platform = process.platform) => {
    const readme = readInstalledFile('README.md');
    const script = platform === 'win32' ? 'install.ps1' : 'install.sh';
    const line = readme
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.includes(script) && (l.startsWith('curl ') || l.startsWith('& (')));
    if (line === undefined)
        return '';
    // Naming a command that cannot work is the failure `gh` sidesteps by
    // printing a URL. We only earn the more helpful form by getting it right.
    return line.replace(/v\d+\.\d+\.\d+/g, tag);
};
const describe = (outcome) => {
    switch (outcome.kind) {
        case 'disabled':
            return `checking is disabled by ${outcome.by}`;
        case 'unreachable':
            return `the release list could not be reached (${outcome.detail})`;
        case 'refused':
            return `the remote declined the request (${outcome.detail})`;
        case 'no-tag-matched':
            return `no release tag was found (${outcome.detail})`;
        case 'resolved':
            return '';
    }
};
export const buildReport = async (env = process.env) => {
    const current = packageVersion();
    const { outcome, checkedAt } = await latestRelease({ env });
    const latest = outcome.kind === 'resolved' ? outcome.tag : null;
    const unknown = describe(outcome);
    return {
        current,
        latest,
        // "We could not look" is not "you are up to date", and only one of them is
        // true. `updateAvailable` stays false either way; `unknown` is what
        // separates them.
        updateAvailable: latest !== null && isNewerRelease(latest, current),
        command: installCommand(latest ?? `v${current}`),
        source: sourceUrl(env),
        checkedAt: new Date(checkedAt).toISOString(),
        ...(unknown === '' ? {} : { unknown }),
    };
};
const render = (report) => {
    const lines = [`installed  ${report.current}`];
    if (report.unknown !== undefined) {
        lines.push(`latest     unknown — ${report.unknown}`);
        return `${lines.join('\n')}\n`;
    }
    lines.push(`latest     ${report.latest ?? 'unknown'}`);
    lines.push(report.updateAvailable
        ? `\na newer release is available. To upgrade:\n\n  ${report.command}`
        : '\nthis is the newest release.');
    return `${lines.join('\n')}\n`;
};
export const register = (program) => {
    program
        .command('upgrade')
        .description('report the installed and newest CommitLore release')
        .option('--check', 'report only; make no change (the default in this build)')
        .option('--json', 'the same answer as JSON')
        .addHelpText('after', '\nExit codes: 0 the check ran, whether or not a newer release exists (SPEC §10).')
        .action(async (options) => {
        const report = await buildReport();
        process.stdout.write(options.json === true ? `${JSON.stringify(report, null, 2)}\n` : render(report));
    });
};
//# sourceMappingURL=update.js.map