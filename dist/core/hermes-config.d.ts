/**
 * Surgical configuration support for the Hermes host profile.
 *
 * Hermes' own `mcp add` command parses and re-emits all of config.yaml. That
 * is useful for its interactive editor, but it is the wrong ownership boundary
 * for an installer: comments, ordering and unrelated operator settings (most
 * importantly approvals) must survive byte-for-byte. These helpers recognise
 * only the ordinary block-style YAML that this installer writes, and otherwise
 * leave the file alone with a reason instead of guessing at a rewrite.
 */
export declare const HERMES_SERVER_KEY = "commitlore";
export interface HermesConfigEdit {
    readonly contents: string;
    readonly added: readonly ('mcp' | 'skills')[];
    readonly unchanged: readonly ('mcp' | 'skills')[];
    readonly blocked: readonly string[];
}
export interface HermesConfigRemoval {
    readonly contents: string;
    readonly removed: readonly ('mcp' | 'skills')[];
}
export declare const isManagedHermesSkillsDir: (value: string, dataRoot: string, installedSkillsDir?: string) => boolean;
export declare const addHermesConfig: (contents: string, options: {
    wrapperPath: string;
    skillsDir: string;
    dataRoot?: string;
}) => HermesConfigEdit;
export declare const removeHermesConfig: (contents: string, options: {
    wrapperPath: string | readonly string[];
    dataRoot: string;
    installedSkillsDir?: string;
}) => HermesConfigRemoval;
