/**
 * Codex plugin installation is deliberately mediated by Codex's own CLI. Its
 * marketplace config and cache are client-owned state; editing either would
 * recreate the silent-discovery failure this route exists to avoid.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AGENT_CONFIGS, isCodexPluginConfig } from './agent-configs.js';
const MARKER_VERSION = 1;
const defaultDataHome = () => process.platform === 'win32'
    ? process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
    : process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share');
/**
 * What Codex said, as a line worth printing.
 *
 * Every failure below already had this and threw it away, so an operator whose
 * DNS was down read "could not add the marketplace" followed by "retry with"
 * the identical command. Retrying unchanged could not have helped, and the one
 * sentence that would have told them so had been captured and discarded.
 */
const codexSaid = (result) => {
    const said = (result.stderr.trim() || result.stdout.trim()).split('\n')[0]?.trim() ?? '';
    if (said === '')
        return [];
    return [`codex said: ${said}`];
};
export const runCodexCommand = (args) => {
    const result = spawnSync('codex', args, { encoding: 'utf8', timeout: 30_000 });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        ...(result.error === undefined ? {} : { error: result.error }),
    };
};
const config = () => {
    const found = AGENT_CONFIGS.find(isCodexPluginConfig);
    if (found === undefined)
        throw new Error('Codex plugin installation is missing from the agent configuration table');
    return found;
};
export const codexPluginSelector = (plugin = config()) => `${plugin.plugin}@${plugin.marketplace}`;
export const codexPluginInstallCommand = () => 'commitlore plugin install-codex';
export const codexPluginMarkerPath = (plugin = config(), dataHome = defaultDataHome()) => join(dataHome, ...plugin.dataRelativePath);
const successful = (result) => result.status === 0 && result.error === undefined;
/**
 * Reads `plugin marketplace list --json` and says what our name currently
 * holds.
 *
 * The name was the whole test before. A marketplace called `commitlore` was
 * accepted however it had been configured, and the installer went straight on
 * to `plugin add commitlore@commitlore` — so a marketplace of that name
 * pointing at somebody else's repository meant installing their code and
 * reporting CommitLore installed. Codex publishes `marketplaceSource` for
 * exactly this question.
 *
 * Text output has no source column, so a Codex too old for `--json` leaves the
 * question open. That is `unverifiable`, and it is reported rather than
 * rounded to either answer.
 */
export const readMarketplaceState = (json, plugin) => {
    // Whether *something* of our name is there, for a Codex whose output this
    // cannot parse. Presence is the half that decides safety: a marketplace we
    // add ourselves is ours by construction, while one that already exists and
    // cannot be identified is the case worth refusing.
    const namedInText = () => json.split('\n').some((line) => line.trim().startsWith(`${plugin.marketplace} `))
        ? { kind: 'unverifiable-present' }
        : { kind: 'unverifiable-absent' };
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        return namedInText();
    }
    const entries = parsed.marketplaces;
    if (!Array.isArray(entries))
        return namedInText();
    const mine = entries.find((entry) => typeof entry === 'object' &&
        entry !== null &&
        entry.name === plugin.marketplace);
    if (mine === undefined)
        return { kind: 'absent' };
    const source = mine.marketplaceSource?.source;
    if (typeof source !== 'string' || source === '')
        return { kind: 'unverifiable-present' };
    return sameMarketplaceSource(source, plugin.marketplaceSource)
        ? { kind: 'ours' }
        : { kind: 'foreign', source };
};
/**
 * Whether two marketplace sources name the same origin.
 *
 * They are rarely spelled the same. This tool adds the marketplace as
 * `MongLong0214/commitlore`; Codex stores what that resolves to and reports
 * `https://github.com/MongLong0214/commitlore.git`. A literal comparison would
 * call the marketplace this tool installed itself foreign and refuse to use it
 * — a worse failure than the one the check exists to prevent, and one that
 * would hit every correctly installed machine.
 *
 * So both sides are reduced to host and path: scheme, credentials, `.git`,
 * trailing slashes and case are dropped, and a bare `owner/repo` is read as
 * GitHub, which is what Codex does with it. The host is kept rather than
 * compared on `owner/repo` alone, so the same path on a different host stays a
 * different origin.
 */
const canonicalMarketplaceSource = (value) => {
    let rest = value.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
    rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    rest = rest.replace(/^git@([^:]+):/i, '$1/');
    rest = rest.replace(/^[^@/]+@/, '');
    // A bare `owner/repo` has no host; Codex resolves it against GitHub.
    if (!/[.:]/.test(rest.split('/')[0] ?? ''))
        rest = `github.com/${rest}`;
    return rest.toLowerCase();
};
const sameMarketplaceSource = (a, b) => canonicalMarketplaceSource(a) === canonicalMarketplaceSource(b);
export const codexPluginIsInstalled = (output, plugin = config()) => output
    .split('\n')
    .some((line) => line.trim().startsWith(codexPluginSelector(plugin)) && line.includes('installed,'));
const markerFor = (plugin) => ({
    version: MARKER_VERSION,
    selector: codexPluginSelector(plugin),
    source: plugin.marketplaceSource,
});
export const readCodexPluginMarker = (plugin = config(), dataHome = defaultDataHome()) => {
    const markerPath = codexPluginMarkerPath(plugin, dataHome);
    if (!existsSync(markerPath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(markerPath, 'utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return null;
        const marker = parsed;
        const expected = markerFor(plugin);
        return marker.version === expected.version && marker.selector === expected.selector && marker.source === expected.source
            ? expected
            : null;
    }
    catch {
        return null;
    }
};
export const removeCodexPluginMarker = (plugin = config(), dataHome = defaultDataHome()) => {
    rmSync(codexPluginMarkerPath(plugin, dataHome), { force: true });
};
const writeCodexPluginMarker = (plugin, dataHome) => {
    const markerPath = codexPluginMarkerPath(plugin, dataHome);
    mkdirSync(join(markerPath, '..'), { recursive: true });
    writeFileSync(markerPath, `${JSON.stringify(markerFor(plugin), null, 2)}\n`);
};
/**
 * Registers the marketplace once, installs the plugin once, and leaves a small
 * ownership marker only after Codex confirms success. Both `codex` calls are
 * client APIs: their state is never inferred from or written as TOML here.
 */
export const installCodexPlugin = (options = {}) => {
    const plugin = config();
    const dataHome = options.dataHome ?? defaultDataHome();
    const run = options.run ?? runCodexCommand;
    const report = [];
    const marketplaces = run(['plugin', 'marketplace', 'list', '--json']);
    if (!successful(marketplaces)) {
        return {
            exitCode: 2,
            report: [
                'could not list Codex plugin marketplaces; no plugin installation was recorded',
                ...codexSaid(marketplaces),
                `retry with: ${codexPluginInstallCommand()}`,
            ],
        };
    }
    const marketplace = readMarketplaceState(marketplaces.stdout, plugin);
    // Refused rather than replaced. Overwriting a marketplace somebody else
    // configured is a destructive answer to an ambiguous situation, and the
    // ambiguity is the point: this tool cannot tell an attack from a colleague's
    // fork. What it can do is decline to install from it and say why.
    if (marketplace.kind === 'foreign') {
        return {
            exitCode: 2,
            report: [
                `a Codex marketplace named ${plugin.marketplace} is already configured, and it points at ` +
                    `${marketplace.source} rather than ${plugin.marketplaceSource}`,
                'nothing was installed: installing from it would have run somebody else’s plugin under this name',
                `to use this one, remove that marketplace (codex plugin marketplace remove ${plugin.marketplace}) and rerun`,
            ],
        };
    }
    // Present and unidentifiable is the same risk as foreign: the next call is
    // `plugin add <name>@<name>`, which installs whatever that marketplace
    // serves. Warning and continuing meant a marketplace somebody else had
    // configured under this name could supply the plugin while the install
    // reported CommitLore.
    if (marketplace.kind === 'unverifiable-present') {
        return {
            exitCode: 2,
            report: [
                `a Codex marketplace named ${plugin.marketplace} is already configured, and this Codex does not ` +
                    'report where it points',
                'nothing was installed: this cannot tell it apart from one somebody else configured under the same name',
                `to use this one, remove that marketplace (codex plugin marketplace remove ${plugin.marketplace}) and rerun, ` +
                    'or upgrade Codex to a version that reports a marketplace source',
            ],
        };
    }
    // Nothing of our name is visible, so the branch below adds ours and the
    // question of whose it is does not arise. Said out loud because the check
    // that would normally confirm it did not run.
    if (marketplace.kind === 'unverifiable-absent') {
        report.push(`this Codex does not report marketplace sources; none named ${plugin.marketplace} was visible, ` +
            'so one was added from this install');
    }
    if (marketplace.kind === 'absent' || marketplace.kind === 'unverifiable-absent') {
        const added = run(['plugin', 'marketplace', 'add', plugin.marketplaceSource]);
        if (!successful(added)) {
            return {
                exitCode: 2,
                report: [
                    `could not add the ${plugin.marketplace} Codex marketplace; no plugin installation was recorded`,
                    ...codexSaid(added),
                    `retry with: ${codexPluginInstallCommand()}`,
                ],
            };
        }
        report.push(`configured Codex marketplace: ${plugin.marketplace}`);
    }
    const listed = run(['plugin', 'list']);
    if (!successful(listed)) {
        return {
            exitCode: 2,
            report: [
                'could not list Codex plugins; no plugin installation was recorded',
                ...codexSaid(listed),
                `retry with: ${codexPluginInstallCommand()}`,
            ],
        };
    }
    if (!codexPluginIsInstalled(listed.stdout, plugin)) {
        const added = run(['plugin', 'add', codexPluginSelector(plugin)]);
        if (!successful(added)) {
            return {
                exitCode: 2,
                report: [
                    `could not install ${codexPluginSelector(plugin)}; no plugin installation was recorded`,
                    ...codexSaid(added),
                    `retry with: ${codexPluginInstallCommand()}`,
                ],
            };
        }
        report.push(`installed Codex plugin: ${codexPluginSelector(plugin)}`);
        // The marker is a claim of ownership, and `uninstall` removes what it
        // marks. Writing it here — after this invocation actually performed the
        // install — is what keeps "removes nothing it did not write" true. Writing
        // it below, past both branches, meant finding someone else's plugin
        // already installed and quietly adopting it, so a later uninstall deleted
        // state this tool never created.
        writeCodexPluginMarker(plugin, dataHome);
    }
    else {
        report.push(`Codex plugin already installed: ${codexPluginSelector(plugin)} — left as it is, and not recorded as ours`);
    }
    report.push('start a new Codex session to load the CommitLore skill and MCP tools');
    return { exitCode: 0, report };
};
//# sourceMappingURL=codex-plugin.js.map