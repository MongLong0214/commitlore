/**
 * Capture policy — the single definition of the policy defaults and the policy
 * identity hash (T-1110, acceptance row B-7 / matrix row P1-5, ADR-0021 §7).
 *
 * This file exists because the definition used to exist three times. At
 * `da1c733` `computePolicyIdentityHash` and its defaults object were declared
 * independently in `capture-prepare.ts`, `capture-stage.ts` and
 * `prepare-commit-msg.ts` — under two different constant names — and agreed only
 * because the three object literals happened to list the same three keys in the
 * same order. Key order is what `JSON.stringify` serialises, and nothing tested
 * that the three agreed.
 *
 * That matters more than duplication usually does. The hook compares the hash it
 * computes against the one `prepare` wrote into the pending file. If the two
 * sites disagree, the hook reports a policy change that never happened, and the
 * user sees a capture declined for a reason that is not true.
 *
 * ADR-0021 fixed the migration before the file existed: with no policy file the
 * identity is `sha256(canonical-defaults-json)`; with one it is
 * `sha256(file-contents)`. The pending format needs no version bump either way,
 * which is why `PendingRecord.version` stays `1`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execGit } from './git.js';
export const CAPTURE_MODES = ['auto', 'suggest', 'off'];
/**
 * Key order is load-bearing: it is the input to `JSON.stringify` and therefore
 * to the identity hash. Reordering these three lines changes the digest every
 * pending file in flight was written with. See `test/capture-policy.test.ts`,
 * which pins the value.
 */
export const POLICY_DEFAULTS = {
    mode: 'auto',
    // Off by default and deliberately so: a repository that never set this must
    // capture exactly as it did before the setting existed (#511). Turning it on
    // is a separate decision with its own evidence — shipping the switch is not
    // flipping it.
    unattended: false,
    max_records_per_commit: 1,
    require_verified_evidence: true,
};
/** The only keys a policy file may set. An unknown key is rejected, not merged. */
export const POLICY_KEYS = [
    'mode',
    'unattended',
    'max_records_per_commit',
    'require_verified_evidence',
];
/**
 * One location, deliberately. PRD-F13 requirement 11 allows either a stated
 * precedence between a repository-local and a user-global file, or a single
 * location. A single location is chosen: an ambiguous precedence is worse than a
 * missing feature, and the user story this file answers ("one record per commit
 * generally, two on this repository") is repository-scoped anyway.
 */
export const POLICY_FILE_NAME = '.commitlore-policy.json';
// ---------------------------------------------------------------------------
// Identity hash
// ---------------------------------------------------------------------------
const sha256 = (input) => createHash('sha256').update(input).digest('hex');
/**
 * The identity of a policy that came from the defaults.
 *
 * `JSON.stringify` over an object literal whose keys are declared in
 * `POLICY_DEFAULTS`' order — the exact expression the three former call sites
 * used, preserved so that consolidation is a no-op on the digest.
 *
 * `unattended` is deliberately absent (#511). The setting can only be turned
 * on by a policy file, and a file's identity is its own bytes — so every
 * identity the setting can change is hashed already. Putting a fixed-false
 * default into this digest too would refuse every capture in flight across the
 * upgrade in every repository that never opted in: a policy change that never
 * happened, the exact false positive this hash exists to avoid. If the default
 * ever becomes `true`, this input must move with it.
 */
export const computePolicyIdentityHash = (policy = POLICY_DEFAULTS) => sha256(JSON.stringify({
    mode: policy.mode,
    max_records_per_commit: policy.max_records_per_commit,
    require_verified_evidence: policy.require_verified_evidence,
}));
/**
 * The identity of a policy that came from a file: the bytes as written.
 *
 * Hashing the contents rather than the parsed object is ADR-0021's choice, and
 * it is the stronger one — a reformat that changes nothing semantically still
 * changes the identity, so the hook reports "the policy file changed", which is
 * true.
 */
export const computePolicyFileIdentityHash = (contents) => sha256(contents);
const defaultsResolution = (error, path) => ({
    ok: error === null,
    policy: POLICY_DEFAULTS,
    identityHash: computePolicyIdentityHash(POLICY_DEFAULTS),
    source: 'defaults',
    path,
    error,
});
/** Repository root, or null outside a repository. */
const repoRoot = (cwd) => {
    const res = execGit(['rev-parse', '--show-toplevel'], { cwd });
    if (res.code !== 0)
        return null;
    const root = res.stdout.trim();
    return root.length > 0 ? root : null;
};
/**
 * Validate a parsed policy file.
 *
 * The file is untrusted input. It may set only the declared keys, with values of
 * the declared shape, and nothing it contains reaches a path, a command, or Git.
 * An unknown key is an error rather than an ignored field, because ignoring it
 * would let a user believe a setting applied.
 */
const validate = (raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: `${POLICY_FILE_NAME} must contain a JSON object` };
    }
    const obj = raw;
    const unknown = Object.keys(obj).filter((k) => !POLICY_KEYS.includes(k));
    if (unknown.length > 0) {
        return {
            error: `${POLICY_FILE_NAME} sets ${unknown.length === 1 ? 'an unknown key' : 'unknown keys'}: ` +
                `${unknown.join(', ')}. Allowed keys are ${POLICY_KEYS.join(', ')}.`,
        };
    }
    const policy = { ...POLICY_DEFAULTS };
    if ('mode' in obj) {
        if (typeof obj.mode !== 'string' || !CAPTURE_MODES.includes(obj.mode)) {
            return {
                error: `${POLICY_FILE_NAME}: mode must be one of ${CAPTURE_MODES.map((mode) => `"${mode}"`).join(', ')} (got ${JSON.stringify(obj.mode)})`,
            };
        }
        policy.mode = obj.mode;
    }
    if ('max_records_per_commit' in obj) {
        const v = obj.max_records_per_commit;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 32) {
            return {
                error: `${POLICY_FILE_NAME}: max_records_per_commit must be an integer between 1 and 32 ` +
                    `(got ${JSON.stringify(v)})`,
            };
        }
        policy.max_records_per_commit = v;
    }
    if ('unattended' in obj) {
        const v = obj.unattended;
        if (typeof v !== 'boolean') {
            return {
                error: `${POLICY_FILE_NAME}: unattended must be a boolean (got ${JSON.stringify(v)})`,
            };
        }
        policy.unattended = v;
    }
    // ADR-0030's guarantee is a property of `auto` mode (#511): a record staged
    // without asking is stamped `drafted` there and only there. A consent the
    // mode cannot honour is rejected rather than ignored, so a user never
    // believes a setting applied.
    if (policy.unattended && policy.mode !== 'auto') {
        return {
            error: `${POLICY_FILE_NAME}: "unattended": true requires mode "auto" (mode is "${policy.mode}")`,
        };
    }
    if ('require_verified_evidence' in obj) {
        const v = obj.require_verified_evidence;
        if (typeof v !== 'boolean') {
            return {
                error: `${POLICY_FILE_NAME}: require_verified_evidence must be a boolean (got ${JSON.stringify(v)})`,
            };
        }
        policy.require_verified_evidence = v;
    }
    return { policy };
};
/**
 * Resolve the policy for `cwd`.
 *
 * Never throws. Every failure path returns the defaults **and** a named reason,
 * so a caller that ignores `error` still behaves as it did before the policy
 * file existed, and a caller that reports it tells the truth about which policy
 * ran.
 */
export const resolvePolicy = (cwd) => {
    const root = repoRoot(cwd);
    if (root === null)
        return defaultsResolution(null, null);
    const path = join(root, POLICY_FILE_NAME);
    if (!existsSync(path))
        return defaultsResolution(null, null);
    let contents;
    try {
        contents = readFileSync(path, 'utf8');
    }
    catch (err) {
        return defaultsResolution(`${POLICY_FILE_NAME} could not be read: ${err.message}`, path);
    }
    let parsed;
    try {
        parsed = JSON.parse(contents);
    }
    catch (err) {
        return defaultsResolution(`${POLICY_FILE_NAME} is not valid JSON: ${err.message}`, path);
    }
    const checked = validate(parsed);
    if ('error' in checked)
        return defaultsResolution(checked.error, path);
    return {
        ok: true,
        policy: checked.policy,
        identityHash: computePolicyFileIdentityHash(contents),
        source: 'repository',
        path,
        error: null,
    };
};
//# sourceMappingURL=capture-policy.js.map