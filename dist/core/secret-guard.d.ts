/**
 * Credential detection for commit messages (T-502, PRD-F5 AC 3).
 *
 * This is a blocker, not a report. A credential that reaches a commit message
 * is permanent: rewriting history does not reach the clones, forks and mirrors
 * that already fetched it, so the only moment the damage can still be undone
 * is before the commit exists. Hence a `commit-msg` hook rather than an audit.
 *
 * Which makes the false-positive rate a correctness property, not a polish
 * item. Every wrong block teaches somebody that `--no-verify` is part of the
 * workflow, and a guard that people habitually skip detects nothing. The rules
 * in `../hooks/secret-rules.ts` are tuned for that, and this module adds two
 * more filters that only make sense with a whole message in hand:
 *
 * - **Ignored lines are not scanned.** Comment lines and everything below the
 *   `commit -v` scissors are stripped by git before the commit is written, so
 *   a finding there is by construction a finding about text that will not
 *   exist. Skipping them also keeps the pasted diff — usually the largest and
 *   noisiest part of `COMMIT_EDITMSG` — out of the scan entirely.
 * - **A higher-confidence finding shadows an overlapping lower one.** A leaked
 *   `api_key = "ghp_…"` is one problem, and reporting it twice makes the
 *   output look like noise.
 *
 * Nothing here ever emits the matched text. Findings carry a redacted excerpt
 * and the raw match is dropped inside `hitsFor`, because this module's output
 * lands in terminals, CI logs and pasted issue reports — every one of them a
 * second copy of whatever was leaked.
 */
export interface SecretFinding {
    ruleId: string;
    description: string;
    /** 1-based line number in the message as given, counting ignored lines. */
    line: number;
    /** Masked excerpt — the first few characters and an ellipsis. Never the value. */
    redacted: string;
    confidence: 'high' | 'medium';
}
export interface ScanOptions {
    /** Findings below this bar are dropped. Defaults to `medium`, i.e. report everything. */
    minConfidence?: 'high' | 'medium';
}
/**
 * Scans a commit message for credentials, in message order.
 *
 * An empty array means no rule fired — which is a statement about this rule
 * table, not a clean bill of health. The known gaps are documented with the
 * rules themselves.
 */
export declare const scanForSecrets: (message: string, opts?: ScanOptions) => SecretFinding[];
/**
 * Renders findings for a human about to lose their commit.
 *
 * The rule id and the line number are the whole message: enough to find the
 * value, never enough to re-leak it. There is deliberately no mention of how
 * to skip the check — a bypass the tool advertises is a bypass that gets used
 * on the finding that mattered.
 *
 * Returns `''` for no findings, and a newline-terminated block otherwise, so a
 * caller can write it straight to stderr.
 */
/**
 * Renders findings for a human. Deliberately does *not* claim what happened to
 * the commit: this runs from `validate`, which may be invoked from a commit-msg
 * hook (where the commit is indeed refused) or on its own against a file or a
 * range (where nothing was being created). The caller knows which, and says so.
 */
export declare const formatFindings: (findings: readonly SecretFinding[]) => string;
