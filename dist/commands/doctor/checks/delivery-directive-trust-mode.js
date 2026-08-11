/**
 * Reports the configured boundary for the `[directive]` tier.
 *
 * This is intentionally an `ok` row in both modes: author-string mode is the
 * supported default for repositories that have not chosen an adversarial
 * threat model, and signature mode is an explicit extra boundary. Doctor's
 * job here is to make the choice legible, not to turn one supported choice
 * into a recurring warning.
 */
import { configuredSignedDirectivesRequired } from '../../../core/trusted-authors.js';
import { check } from '../model.js';
export const checkDirectiveTrustMode = (ctx) => {
    const enabled = configuredSignedDirectivesRequired(ctx.opts.cwd ?? process.cwd(), ctx.git);
    return check('directive-trust-mode', 'delivery', 'directive trust mode', 'ok', enabled
        ? 'signature mode: directives need a configured author string and Git’s verified signature from this verifier’s trust store.'
        : 'author-string mode: directives need a configured author string, which anyone able to write a commit can forge.', null, false, false, { evidence: { mode: enabled ? 'verified-signature' : 'author-string' } });
};
//# sourceMappingURL=delivery-directive-trust-mode.js.map