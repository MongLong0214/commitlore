/**
 * Reports the configured boundary for the `[directive]` tier.
 *
 * Author-string mode is an `ok` default for repositories that have not chosen
 * an adversarial threat model. Signature mode is an explicit extra boundary;
 * it is `ok` only after the repository authorizes at least one signer.
 *
 * A third state is not a choice. When the setting is present and unparseable,
 * somebody wrote it deliberately and it does not say what they meant. Grading
 * fails closed to signature mode, and this row says so — reporting `ok` there
 * was how a typo in a security opt-in stayed invisible while the diagnostic
 * that exists to surface it called the repository healthy.
 */
import { configuredDirectiveTrustSetting, configuredTrustedSignerFingerprints, } from '../../../core/trusted-authors.js';
import { check } from '../model.js';
export const checkDirectiveTrustMode = (ctx) => {
    const cwd = ctx.opts.cwd ?? process.cwd();
    const setting = configuredDirectiveTrustSetting(cwd, ctx.git);
    if (setting === 'malformed') {
        return check('directive-trust-mode', 'delivery', 'directive trust mode', 'warn', 'commitlore.requireSignedDirective is set to something Git cannot read as a boolean; ' +
            'directives are being held to signature mode until it is corrected.', 'git config --local --bool commitlore.requireSignedDirective true (or false)', false, false, { evidence: { mode: 'malformed-setting-failing-closed' } });
    }
    const enabled = setting === 'signature-required';
    if (enabled && configuredTrustedSignerFingerprints(cwd).length === 0) {
        return check('directive-trust-mode', 'delivery', 'directive trust mode', 'warn', 'signature mode has no authorized signer fingerprints; every record is held to [claim].', 'git config --local --add commitlore.trustedSigner <Git-%GF-fingerprint>', false, false, { evidence: { mode: 'signature-required-no-authorized-signers' } });
    }
    return check('directive-trust-mode', 'delivery', 'directive trust mode', 'ok', enabled
        ? 'signature mode: directives need a configured author string, Git’s verified signature, and an authorized signing-key fingerprint.'
        : 'author-string mode: directives need a configured author string, which anyone able to write a commit can forge.', null, false, false, { evidence: { mode: enabled ? 'verified-signature' : 'author-string' } });
};
//# sourceMappingURL=delivery-directive-trust-mode.js.map