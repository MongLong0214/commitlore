/**
 * Who this repository trusts to write a directive (#415).
 *
 * `gradeRecord` is fail-closed on an empty trusted-author list: with nobody
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
 * The default recorded at `init` is the identity of the person installing.
 * That follows the threat model rather than convenience: grading exists so a
 * malicious contributor's commit cannot carry an instruction to someone else's
 * agent. The person running `init` on their own machine is, by construction,
 * trusted by themselves — their own authored records become directives to their
 * own agent, and every other author's records stay `claim` exactly as before.
 * The fail-closed property is untouched for the attack it was built to stop.
 *
 * It stays a local git config value, so a repository can widen it (a team adds
 * its reviewers) or empty it (`git config --unset-all commitlore.trustedAuthor`
 * restores trust-nobody) without editing a hook command by hand.
 */
/** Local git config key holding trusted author identities, one value each. */
export declare const TRUSTED_AUTHOR_KEY = "commitlore.trustedAuthor";
/** Every trusted author this repository records. Empty means trust nobody. */
export declare const configuredTrustedAuthors: (cwd: string) => string[];
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
