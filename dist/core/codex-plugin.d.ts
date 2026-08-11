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
