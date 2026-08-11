/**
 * The author strings this repository elects to treat as directive writers (#415).
 *
 * `gradeRecord` is fail-closed on an empty configured-author list: with nobody
 * configured, every record grades `claim` and the `[directive]` tier is
 * unreachable. #415 measured that this is exactly what every installed surface
 * did — `CLAUDE_HOOK_COMMAND` is `commitlore inject --hook-input <marker>` and
 * passes no `--trusted-author`, so no user has ever seen a `[directive]` line
 * even though the injected legend advertises one.
 *
 * Two ways out, and only one of them is honest. Dropping `[directive]` from the
 * legend would make the product consistent by removing a tier it can deliver;
 * this module takes the other route and makes the tier reachable, because the
 * tier is not decoration — it is how a record says "this is a constraint, not
 * an opinion", and the whole SPEC §7 trust model exists to draw that line.
 *
 * The default recorded at `init` is the email string of the person installing.
 * That is useful local policy, not authentication: a commit author chooses its
 * own author string, so anyone able to write a commit can forge a configured
 * identity. In the default mode, a directive means this repository chose to
 * treat that string as a constraint; it does not prove who authored the commit.
 * The fail-closed property is untouched: with no configured strings, every
 * record remains a claim.
 *
 * It stays a local git config value, so a repository can widen it (a team adds
 * its reviewers) or empty it (`git config --unset-all commitlore.trustedAuthor`
 * restores trust-nobody) without editing a hook command by hand. A repository
 * that needs an authenticated boundary can additionally set
 * `commitlore.requireSignedDirective=true`; Git must then report a verified
 * signature from the verifier's own trust store before a record is directive.
 */
import { execGit } from './git.js';
/** Local git config key holding directive author strings, one value each. */
export declare const TRUSTED_AUTHOR_KEY = "commitlore.trustedAuthor";
/** Local opt-in: directives also require Git to report a verified signature. */
export declare const REQUIRE_SIGNED_DIRECTIVE_KEY = "commitlore.requireSignedDirective";
/** Every directive author string this repository records. Empty means trust nobody. */
export declare const configuredTrustedAuthors: (cwd: string) => string[];
/**
 * Whether this repository requires a Git-verified signature for directives.
 *
 * The absence of the setting is deliberately `false`: author-string mode is
 * the long-standing default, and an upgrade must not downgrade its records.
 * Git's boolean parser owns the accepted spellings; an unreadable or malformed
 * value does not accidentally enable a security claim.
 */
export declare const configuredSignedDirectivesRequired: (cwd: string, git?: typeof execGit) => boolean;
export interface TrustSeedResult {
    readonly recorded: boolean;
    readonly author: string | null;
    readonly reason: string;
}
/**
 * Records the installing user's git identity as this repository's trusted
 * author, unless the repository already answers the question.
 *
 * Never overwrites: a repository that already lists authors has made this
 * decision deliberately, and a re-run of `init` is not a mandate to replace it.
 * A machine with no `user.email` records nothing rather than guessing — an
 * identity nobody committed under would trust a name that cannot author.
 */
export declare const seedTrustedAuthor: (cwd: string) => TrustSeedResult;
