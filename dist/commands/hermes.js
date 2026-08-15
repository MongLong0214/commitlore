/** Host-side setup for the Hermes coding agent.
 *
 * Repository wiring remains `commitlore init`; this command owns only the
 * active Hermes profile. Keeping that boundary explicit prevents an installer
 * from unexpectedly touching whichever repository happened to be current.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { addHermesConfig } from '../core/hermes-config.js';
import { installedPath } from '../core/paths.js';
import { runtimeIdentity } from '../core/runtime-identity.js';
const commandExists = (command) => {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 5_000, stdio: 'ignore' });
    return result.error === undefined;
};
const backupPathFor = (configPath) => {
    const base = `${configPath}.commitlore-backup`;
    if (!existsSync(base))
        return base;
    for (let index = 1;; index += 1) {
        const candidate = `${base}.${index}`;
        if (!existsSync(candidate))
            return candidate;
    }
};
const atomicallyWrite = (path, contents, mode) => {
    const temporary = join(dirname(path), `.${basename(path)}.commitlore-${process.pid}.tmp`);
    try {
        if (mode === undefined)
            writeFileSync(temporary, contents, 'utf8');
        else
            writeFileSync(temporary, contents, { encoding: 'utf8', mode });
        renameSync(temporary, path);
    }
    catch (error) {
        // `renameSync` is deliberately the final operation. If it fails, the old
        // config stays in place and the caller gets the real reason.
        throw error;
    }
};
const runVerification = (report, verified) => {
    if (!commandExists('hermes')) {
        report.push('unverified: Hermes is not on PATH, so start a fresh session to load the configured profile');
        return;
    }
    const skills = spawnSync('hermes', ['skills', 'list', '--source', 'all'], {
        encoding: 'utf8',
        timeout: 15_000,
    });
    const skillOutput = `${skills.stdout ?? ''}${skills.stderr ?? ''}`;
    const names = ['commitlore-setup', 'commitlore-query', 'commitlore-commits'];
    if (skills.status === 0 && names.every((name) => skillOutput.includes(name))) {
        verified.push('fresh Hermes process lists the CommitLore skills');
        report.push('verified: fresh Hermes process lists commitlore-setup, commitlore-query and commitlore-commits');
    }
    else {
        report.push('unverified: Hermes did not list every CommitLore skill; start a fresh session and run `hermes skills list --source all`');
    }
    const mcp = spawnSync('hermes', ['mcp', 'test', 'commitlore'], {
        encoding: 'utf8',
        timeout: 15_000,
    });
    const mcpOutput = `${mcp.stdout ?? ''}${mcp.stderr ?? ''}`;
    if (mcp.status === 0 && mcpOutput.includes('commitlore_before_change')) {
        verified.push('Hermes MCP probe lists CommitLore tools');
        report.push('verified: Hermes MCP probe lists CommitLore tools');
    }
    else {
        report.push('unverified: Hermes could not list the CommitLore MCP tools; run `hermes mcp test commitlore`');
    }
};
export const runHermesInstall = (options = {}) => {
    const home = options.home ?? homedir();
    // Hermes treats HERMES_HOME as the profile directory itself (where
    // config.yaml lives), not as the OS home directory. Keep the CommitLore
    // wrapper and installed bundle under the user's normal data locations while
    // targeting the profile Hermes has selected for this process.
    const hermesHome = process.env['HERMES_HOME'];
    const configPath = options.configPath ?? (hermesHome === undefined ? join(home, '.hermes', 'config.yaml') : join(hermesHome, 'config.yaml'));
    const dataHome = options.dataHome ?? process.env['XDG_DATA_HOME'] ?? join(home, '.local', 'share');
    const dataRoot = options.dataRoot ?? join(dataHome, 'commitlore');
    /**
     * Where the skills the config will point at actually live (#686).
     *
     * `installedPath` resolves against the running bundle, which is right when
     * that bundle is the installed one and wrong the moment it is not. Running a
     * checkout's `dist/` with `--data-root` pointed at the real installation wrote
     * the checkout's path into a permanent config: delete the tree and the skills
     * vanish while `mcp_servers` stays valid, which is the half-configured state
     * #684 was about, re-entered through a different door.
     *
     * So when the data root holds this version's own skills, that is the answer.
     * The running bundle's location is the fallback for the case it was always
     * correct for — an installation invoking itself.
     */
    const versionedSkills = join(dataRoot, `v${runtimeIdentity().version}`, 'hermes', 'skills');
    const skillsDir = options.skillsDir ?? (existsSync(versionedSkills) ? versionedSkills : installedPath('hermes', 'skills'));
    const detected = options.detected ?? (existsSync(dirname(configPath)) || commandExists('hermes'));
    const report = [];
    const verified = [];
    if (!detected) {
        return {
            exitCode: 0,
            report: ['Hermes not detected — left its profile untouched.'],
            changed: [],
            verified,
        };
    }
    if (!existsSync(skillsDir)) {
        return {
            exitCode: 2,
            report: [`could not find the CommitLore Hermes skill bundle at ${skillsDir}`],
            changed: [],
            verified,
        };
    }
    const wrapperPath = options.wrapperPath ?? join(home, '.local', 'bin', 'commitlore');
    const before = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
    const edit = addHermesConfig(before, {
        wrapperPath,
        skillsDir: resolve(skillsDir),
        dataRoot,
    });
    // A host setup with either half missing is not complete. More importantly,
    // writing the other half after finding a foreign entry makes a failed run
    // unexpectedly mutate the profile. Report the conflict and leave the whole
    // file byte-identical so the operator has one clear recovery point.
    if (edit.blocked.length > 0) {
        for (const reason of edit.blocked)
            report.push(`could not configure: ${reason}`);
        return { exitCode: 1, report, changed: [], verified };
    }
    if (edit.added.length > 0) {
        try {
            mkdirSync(dirname(configPath), { recursive: true });
            if (existsSync(configPath)) {
                const backup = backupPathFor(configPath);
                copyFileSync(configPath, backup);
                report.push(`backed up: ${configPath} -> ${backup}`);
            }
            const mode = existsSync(configPath) ? statSync(configPath).mode : undefined;
            atomicallyWrite(configPath, edit.contents, mode);
            report.push(`configured: ${edit.added.join(' and ')} in ${configPath}`);
        }
        catch (error) {
            return {
                exitCode: 2,
                report: [...report, `could not update ${configPath}: ${error instanceof Error ? error.message : String(error)}`],
                changed: [],
                verified,
            };
        }
    }
    else {
        report.push('Hermes already configured (unchanged).');
    }
    if (options.verify === true)
        runVerification(report, verified);
    return {
        exitCode: 0,
        report,
        changed: edit.added,
        verified,
    };
};
export const register = (program) => {
    const hermes = program
        .command('hermes')
        .description('configure the active Hermes profile with CommitLore MCP tools and skills');
    hermes
        .command('install')
        .description('wire Hermes host configuration; repository setup remains `commitlore init`')
        .option('--config <path>', 'Hermes config.yaml path (defaults to the active profile)')
        .option('--command <path>', 'CommitLore wrapper Hermes should execute (defaults to ~/.local/bin/commitlore)')
        .option('--data-root <path>', 'CommitLore install data root, used when replacing an older skill bundle')
        .option('--verify', 'probe skill discovery and MCP tools after configuring')
        .action((options) => {
        const result = runHermesInstall({
            ...(options.config === undefined ? {} : { configPath: options.config }),
            ...(options.command === undefined ? {} : { wrapperPath: options.command }),
            ...(options.dataRoot === undefined ? {} : { dataRoot: options.dataRoot }),
            verify: options.verify === true,
        });
        for (const line of result.report)
            console.log(line);
        process.exitCode = result.exitCode;
    });
};
//# sourceMappingURL=hermes.js.map