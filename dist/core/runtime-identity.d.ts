/**
 * The exact program a CommitLore surface is executing.
 *
 * A command name is not an identity: hooks pin a file, plugins cache a
 * checkout and MCP hosts retain a process.  This one value is deliberately
 * built from the entry file's own package, never from the caller's cwd.
 */
export interface RuntimeIdentity {
    readonly version: string;
    readonly entrypoint: string;
    readonly packageRoot: string;
    readonly indexSchemaVersion: number;
}
/**
 * Produces every part of runtime identity from one entrypoint.  Passing an
 * entrypoint is for a pin or an observed MCP command; omission describes this
 * running installation, even when tests launched Node from somewhere else.
 */
export declare const runtimeIdentity: (entrypoint?: string) => RuntimeIdentity;
export declare const runtimeAssetProblems: (identity: RuntimeIdentity) => string[];
export interface IdentityDiagnosis {
    readonly ok: boolean;
    readonly detail: string;
    readonly fix: string;
}
/**
 * One diagnosis string for every surface identity doctor collected.
 *
 * An entrypoint identifies the route into an installation and stays in the
 * report, but it is not the installation boundary: the bundle and compiled
 * CLI are both legitimate entrypoints under one package root.
 */
export declare const diagnoseRuntimeIdentities: (identities: Partial<Record<"cli" | "hook" | "mcp" | "plugin", RuntimeIdentity>>) => IdentityDiagnosis;
/** Schema skew is never a steady-state scan fallback: the cache can be rebuilt. */
export declare const convergeIndexSchema: ({ writer, reader }: {
    writer: RuntimeIdentity;
    reader: RuntimeIdentity;
}) => IdentityDiagnosis;
export declare const formatRuntimeIdentity: (identity: RuntimeIdentity) => string;
