/**
 * Codex plugin installation is deliberately mediated by Codex's own CLI. Its
 * marketplace config and cache are client-owned state; editing either would
 * recreate the silent-discovery failure this route exists to avoid.
 */
import { type CodexPluginConfig } from './agent-configs.js';
export interface CodexCommandResult {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly error?: Error;
}
export type CodexCommandRunner = (args: readonly string[]) => CodexCommandResult;
export interface CodexPluginOptions {
    readonly dataHome?: string;
    readonly run?: CodexCommandRunner;
}
export interface CodexPluginResult {
    readonly exitCode: 0 | 2;
    readonly report: readonly string[];
}
interface CodexPluginMarker {
    readonly version: number;
    readonly selector: string;
    readonly source: string;
}
export declare const runCodexCommand: CodexCommandRunner;
export declare const codexPluginSelector: (plugin?: CodexPluginConfig) => string;
export declare const codexPluginInstallCommand: () => string;
export declare const codexPluginMarkerPath: (plugin?: CodexPluginConfig, dataHome?: string) => string;
/** What a marketplace of our name, if any, currently points at. */
export type MarketplaceState = 
/** No marketplace of that name is configured. */
{
    kind: 'absent';
}
/** Configured, and its source is the repository we publish from. */
 | {
    kind: 'ours';
}
/** Configured under our name, but pointing somewhere else. */
 | {
    kind: 'foreign';
    source: string;
}
/** A marketplace of our name is present, and this Codex cannot say where it points. */
 | {
    kind: 'unverifiable-present';
}
/** This Codex reports nothing machine-readable, and none of our name is visible. */
 | {
    kind: 'unverifiable-absent';
};
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
export declare const readMarketplaceState: (json: string, plugin: CodexPluginConfig) => MarketplaceState;
export declare const codexPluginIsInstalled: (output: string, plugin?: CodexPluginConfig) => boolean;
export declare const readCodexPluginMarker: (plugin?: CodexPluginConfig, dataHome?: string) => CodexPluginMarker | null;
export declare const removeCodexPluginMarker: (plugin?: CodexPluginConfig, dataHome?: string) => void;
/**
 * Registers the marketplace once, installs the plugin once, and leaves a small
 * ownership marker only after Codex confirms success. Both `codex` calls are
 * client APIs: their state is never inferred from or written as TOML here.
 */
export declare const installCodexPlugin: (options?: CodexPluginOptions) => CodexPluginResult;
export {};
