/**
 * The pattern table behind the secret guard (T-502, ADR-0005 "secret guard").
 *
 * The rules are a subset of gitleaks' table, ported from
 * https://github.com/gitleaks/gitleaks (`cmd/generate/config/rules/`, MIT),
 * narrowed to credentials that plausibly reach a commit *message* and retuned
 * for that input. A message is prose: a rule that fires on the word "token"
 * costs more than it saves, because a guard people route around with
 * `--no-verify` blocks nothing at all. Every rule here therefore demands the
 * value's shape, not just an identifier that sounds secret.
 *
 * Three properties every pattern must keep:
 *
 * - **The `g` flag.** `scanForSecrets` reads matches with `String.matchAll`,
 *   which runs against a clone of the regex and leaves this table's
 *   `lastIndex` untouched. A plain `exec` loop would make these shared,
 *   module-level rule objects stateful across scans.
 * - **Bounded quantifiers in front of a required character.** An unbounded
 *   `{n,}` followed by something that must match backtracks across the rest of
 *   the line at every start position — quadratic on the 10 KB diff that
 *   `commit -v` pastes below the scissors line. Bounds keep the work per
 *   position constant.
 * - **No nested quantifiers.** Nothing of the `(a+)+` shape, which is where
 *   catastrophic backtracking actually comes from.
 *
 * A pattern may name one group `check`: the substring `isPlaceholder` judges.
 * Rules whose match is mostly a fixed, public prefix (`AKIA…`, `ghp_…`) leave
 * it out and have the whole match judged. It exists for the rules whose match
 * is mostly context — `password: "…"` is documentation or a leak depending on
 * the quoted value, never on the word `password`.
 */
export interface SecretRule {
    /** Stable identifier. It is what the user is told they tripped, so it never changes. */
    id: string;
    description: string;
    pattern: RegExp;
    /** Rules that key on prose are `medium`, so a caller can raise the bar to `high`. */
    confidence: 'high' | 'medium';
}
/**
 * Whether a credential-shaped string is an example rather than a credential.
 *
 * Deliberately generous: the cost of letting a documented placeholder through
 * is zero, and the cost of blocking one is that the next real finding gets
 * bypassed by reflex. The rules that pay for it are listed in the module's
 * known gaps — a real key that happens to contain `example` is not detected.
 */
export declare const isPlaceholder: (candidate: string) => boolean;
/**
 * Every rule the guard runs, in report order for a single line.
 *
 * Ordering inside the generic rule's alternation matters: the longer
 * identifiers come first so `access_token` is not matched as bare `token`,
 * which would start the match — and therefore the redacted excerpt — in the
 * middle of a word.
 */
export declare const SECRET_RULES: readonly SecretRule[];
