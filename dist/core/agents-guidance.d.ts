/**
 * The repository-owned instruction block that makes capture reach every host
 * which honours AGENTS.md.  The source lives in the shipped AGENTS.md rather
 * than in a second prose copy: separate copies would drift, and an install
 * that still carries the old procedure would look successful until a commit
 * silently misses its record.
 */
export declare const AGENTS_SECTION_BEGIN = "<!-- commitlore:begin -->";
export declare const AGENTS_SECTION_END = "<!-- commitlore:end -->";
export interface AgentsGuidanceResult {
    readonly state: 'created' | 'added' | 'updated' | 'unchanged' | 'invalid' | 'write-failed';
    readonly path: string;
    readonly error: string | null;
}
export declare const readCommitloreAgentsSection: () => string;
/**
 * Installs or refreshes only CommitLore's marked section.  An unmarked file is
 * wholly somebody else's: its exact bytes stay as a prefix, and a malformed
 * marker pair is reported rather than guessed at or overwritten.
 */
export declare const installAgentsGuidance: (cwd: string) => AgentsGuidanceResult;
