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
 * signature from the verifier's own trust store and its `%GF` fingerprint must
 * be listed in `commitlore.trustedSigner` before a record is directive.
 */
import { execGit } from './git.js';
/** Local git config key holding directive author strings, one value each. */
export declare const TRUSTED_AUTHOR_KEY = "commitlore.trustedAuthor";
/** Local opt-in: directives also require Git to report a verified signature. */
export declare const REQUIRE_SIGNED_DIRECTIVE_KEY = "commitlore.requireSignedDirective";
/** Local signer-authority allowlist, one Git-reported key fingerprint per value. */
export declare const TRUSTED_SIGNER_KEY = "commitlore.trustedSigner";
/** Every directive author string this repository records. Empty means trust nobody. */
export declare const configuredTrustedAuthors: (cwd: string) => string[];
/**
 * Every signing-key fingerprint this repository authorizes in signature mode.
 *
 * These are the exact strings Git reports through `%GF`, not names or email
 * addresses. Missing, empty, and unreadable config all elect no signer: a
 * repository that opted into signature mode must name its authorities before
 * any signed record can direct. The default author-string mode does not read
 * this allowlist, preserving its established opt-in behavior.
 */
export declare const configuredTrustedSignerFingerprints: (cwd: string) => string[];
/** What the repository's directive-trust setting says, including "it is broken". */
export type DirectiveTrustSetting = 'author-string' | 'signature-required' | 'malformed';
/**
 * Reads the directive-trust setting, keeping "absent" and "unparseable" apart.
 *
 * Absence is `author-string`: that mode is the long-standing default and an
 * upgrade must not downgrade a repository's records. A value that is present
 * and cannot be parsed is neither — somebody wrote something here on purpose
 * and it does not mean what they thought.
 *
 * That case fails closed. The first version folded it into `false`, so a typo
 * in the documented security opt-in silently returned the repository to
 * forgeable author strings while `doctor` reported the setting healthy. A
 * security control that quietly turns itself off when misconfigured is worse
 * than one that was never offered.
 */
export declare const configuredDirectiveTrustSetting: (cwd: string, git?: typeof execGit) => DirectiveTrustSetting;
/**
 * Whether a directive additionally needs Git's verified signature status.
 *
 * `malformed` requires it: see above. The setting is the operator's explicit
 * request for a stronger boundary, and the safe reading of a request nobody can
 * parse is the strong one.
 */
export declare const configuredSignedDirectivesRequired: (cwd: string, git?: typeof execGit) => boolean;
/**
 * An identifier for the keys this machine can verify with, or `null` outside
 * signature mode (#653).
 *
 * Git's `%G?` is not a property of the repository. It is the verdict of
 * whichever process ran `git log`, and it depends on the keys that process
 * could reach — so anything that caches it is caching an answer about a
 * particular keyring. Binding the cache to this identifier lets a reader tell
 * whether the stored verdict is still about the keyring it has now, which is
 * the difference between a cache and a stale claim about authority.
 *
 * Only signature mode pays for it: the setting is opt-in, and this is the one
 * place where a `%G?` can decide whether a record directs an agent.
 */
export declare const signatureVerifierGeneration: (cwd: string, git?: typeof execGit) => string | null;
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
