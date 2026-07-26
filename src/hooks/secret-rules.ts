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
 * Words that mark a credential-shaped string as documentation. AWS ships
 * `AKIAIOSFODNN7EXAMPLE` in its own docs and people paste it into commit
 * messages; a guard that blocks it teaches everyone that the guard is wrong.
 */
const PLACEHOLDER_WORDS =
  /example|sample|placeholder|redacted|change[_-]?me|dummy|fake|your[_-]?|insert[_-]?|not[_-]?a?[_-]?real|test[_-]?(?:key|token|secret)/i;

/** Template and fill-me-in syntax: `<your-token-here>`, `${TOKEN}`, `{{token}}`, `sk-…`. */
const TEMPLATE_MARKERS = /<[^>]{0,64}>|\{\{|\$\{|\.\.\.|…/;

/**
 * Six of the same character in a row. Redaction stand-ins (`ghp_xxxx…`,
 * `AKIA0000…`) look exactly like the real thing to a shape-based rule; real
 * base64 or hex key material effectively never does.
 */
const REPEATED_RUN = /(.)\1{5,}/;

/**
 * Whether a credential-shaped string is an example rather than a credential.
 *
 * Deliberately generous: the cost of letting a documented placeholder through
 * is zero, and the cost of blocking one is that the next real finding gets
 * bypassed by reflex. The rules that pay for it are listed in the module's
 * known gaps — a real key that happens to contain `example` is not detected.
 */
export const isPlaceholder = (candidate: string): boolean =>
  PLACEHOLDER_WORDS.test(candidate) ||
  TEMPLATE_MARKERS.test(candidate) ||
  REPEATED_RUN.test(candidate);

/**
 * Every rule the guard runs, in report order for a single line.
 *
 * Ordering inside the generic rule's alternation matters: the longer
 * identifiers come first so `access_token` is not matched as bare `token`,
 * which would start the match — and therefore the redacted excerpt — in the
 * middle of a word.
 */
export const SECRET_RULES: readonly SecretRule[] = [
  {
    id: 'aws-access-key-id',
    description: 'AWS access key id',
    // gitleaks: aws-access-token. The prefix set is AWS's own (AKIA long-term,
    // ASIA temporary, ABIA bearer, ACCA context, A3T… service-specific).
    pattern: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g,
    confidence: 'high',
  },
  {
    id: 'aws-secret-access-key',
    description: 'AWS secret access key',
    // No prefix exists to key on — 40 base64 characters alone would match half
    // the hashes in a message — so the identifier is required. Quotes are
    // optional here because the shell-export form (`AWS_SECRET_ACCESS_KEY=…`)
    // is how this value actually leaks, and the 40-character shape carries the
    // rule on its own.
    pattern:
      /(?<![A-Za-z])aws[_-]?secret[_-]?(?:access[_-]?)?key["']?\s{0,8}[:=]\s{0,8}["']?(?<check>[A-Za-z0-9/+=]{40})/gi,
    confidence: 'high',
  },
  {
    id: 'github-token',
    description: 'GitHub personal access, OAuth, app or refresh token',
    // gitleaks: github-pat (ghp_), github-oauth (gho_), github-app-token
    // (ghu_/ghs_), github-refresh-token (ghr_). One rule, because the remedy
    // and the urgency are identical for all five.
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}/g,
    confidence: 'high',
  },
  {
    id: 'github-fine-grained-pat',
    description: 'GitHub fine-grained personal access token',
    // gitleaks pins the tail at 82; the floor is loosened to 60 so a future
    // length change degrades into a hit rather than into silence.
    pattern: /\bgithub_pat_[A-Za-z0-9_]{60,255}/g,
    confidence: 'high',
  },
  {
    id: 'openai-api-key',
    description: 'OpenAI API key',
    // Two shapes, and the split is what keeps this rule quiet. The legacy form
    // is `sk-` plus alphanumerics only: allowing `-` in the tail would match
    // any branch-name-shaped word starting with `sk-`. The project/service
    // forms do allow `-`, so they are gated behind their own prefixes instead.
    pattern: /\bsk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,255}|[A-Za-z0-9]{32,255})/g,
    confidence: 'high',
  },
  {
    id: 'anthropic-api-key',
    description: 'Anthropic API key',
    // gitleaks: anthropic-api-key (`sk-ant-api03-…`, `sk-ant-admin01-…`). The
    // key-class segment is left open so a new class is still detected. Cannot
    // collide with the OpenAI rule above: `ant` is three characters, short of
    // that rule's 32-character alphanumeric floor.
    pattern: /\bsk-ant-[A-Za-z0-9]{2,32}-[A-Za-z0-9_-]{20,255}/g,
    confidence: 'high',
  },
  {
    id: 'slack-token',
    description: 'Slack API token',
    // gitleaks: slack-bot-token and friends, collapsed to the shared prefix.
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,255}/g,
    confidence: 'high',
  },
  {
    id: 'private-key-block',
    description: 'PEM private key block',
    // The header alone is the finding. A commit message that quotes the BEGIN
    // line has already told everyone where the key is, whether or not the body
    // came along.
    pattern: /-----BEGIN[A-Z0-9 ]{0,32}PRIVATE KEY(?: BLOCK)?-----/g,
    confidence: 'high',
  },
  {
    id: 'url-embedded-credentials',
    description: 'credentials embedded in a URL',
    // `scheme://user:password@host`. The password is the `check` group so a
    // documented `https://user:<password>@host` stays quiet, and every part is
    // bounded so a long line cannot make the engine walk it repeatedly.
    // `[^\s:@/]` for the user and `[^\s@/]` for the password are what keep
    // `postgres://cache.internal:5432/db` out: the port is followed by `/`,
    // never by `@`.
    pattern: /\b[a-z][a-z0-9+.-]{1,31}:\/\/[^\s:@/]{1,64}:(?<check>[^\s@/]{3,128})@[^\s/]{1,255}/gi,
    confidence: 'high',
  },
  {
    id: 'generic-credential-assignment',
    description: 'a secret-looking name assigned a credential-shaped value',
    // The catch-all, and the only rule that can fire on ordinary English — so
    // it is `medium`, and it demands three things at once: a credential-ish
    // name, an assignment, and a quoted value with no whitespace in it. That
    // last requirement is what separates `password: "hunter2seventeen"` from
    // `password: "must be rotated"`, and it is why prose about tokens and
    // secrets passes. The leading lookbehind, rather than `\b`, is so
    // `DATABASE_PASSWORD="…"` is caught (`_` is a word character, so `\b`
    // would not match) while `retokenize: "…"` is not.
    pattern:
      /(?<![A-Za-z])(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|credentials?|password|passwd|secret|token)["']?\s{0,8}[:=]\s{0,8}["'](?<check>[^"'\s]{8,200})["']/gi,
    confidence: 'medium',
  },
];
