/**
 * Reports the configured boundary for the `[directive]` tier.
 *
 * Both supported modes are an `ok` row: author-string mode is the default for
 * repositories that have not chosen an adversarial threat model, and signature
 * mode is an explicit extra boundary. Doctor's job is to make the choice
 * legible, not to turn one supported choice into a recurring warning.
 *
 * A third state is not a choice. When the setting is present and unparseable,
 * somebody wrote it deliberately and it does not say what they meant. Grading
 * fails closed to signature mode, and this row says so — reporting `ok` there
 * was how a typo in a security opt-in stayed invisible while the diagnostic
 * that exists to surface it called the repository healthy.
 */

import { configuredDirectiveTrustSetting } from '../../../core/trusted-authors.js';
import { check, type DoctorCheck, type DoctorContext } from '../model.js';

export const checkDirectiveTrustMode = (ctx: DoctorContext): DoctorCheck => {
  const setting = configuredDirectiveTrustSetting(ctx.opts.cwd ?? process.cwd(), ctx.git);

  if (setting === 'malformed') {
    return check(
      'directive-trust-mode',
      'delivery',
      'directive trust mode',
      'warn',
      'commitlore.requireSignedDirective is set to something Git cannot read as a boolean; ' +
        'directives are being held to signature mode until it is corrected.',
      'git config --local --bool commitlore.requireSignedDirective true (or false)',
      false,
      false,
      { evidence: { mode: 'malformed-setting-failing-closed' } },
    );
  }

  const enabled = setting === 'signature-required';
  return check(
    'directive-trust-mode',
    'delivery',
    'directive trust mode',
    'ok',
    enabled
      ? 'signature mode: directives need a configured author string and Git’s verified signature from this verifier’s trust store.'
      : 'author-string mode: directives need a configured author string, which anyone able to write a commit can forge.',
    null,
    false,
    false,
    { evidence: { mode: enabled ? 'verified-signature' : 'author-string' } },
  );
};
