/**
 * The `installation-integrity` doctor check.
 *
 * It owns the shipped-file probe because that verdict is independent of every
 * other check; a missing schema is not a degraded repository, it is a broken
 * installation, and doctor is the command that is supposed to say so.
 */
import { isMissingInstalledFile, readInstalledFile } from '../../../core/paths.js';
import { check } from '../model.js';
/**
 * Files this installation actually reads through `readInstalledFile`.
 *
 * Call sites, not a guess:
 *   src/core/paths.ts     packageVersion()  — package.json
 *   src/core/schema.ts    SCHEMA_ASSET      — spec/schema/record.schema.json
 *   src/core/harvest.ts   SPEC_ASSET        — spec/SPEC.md
 *
 * `installedPath` also names dist/ and hermes/skills; those are not read
 * through readInstalledFile. cli-runtime already probes the bundle.
 */
const SHIPPED_ASSETS = [
    ['package.json'],
    ['spec', 'schema', 'record.schema.json'],
    ['spec', 'SPEC.md'],
];
const relativeOf = (segments) => segments.join('/');
/**
 * Whether every file this installation ships and later reads is on disk.
 *
 * `validate` already refuses a missing schema with exit 3. doctor is the
 * command a user (and install-gate) run to learn that, and until this check
 * existed it reported healthy. `fail`, not `warn`: every commit against this
 * install is refused with a message the user cannot act on by editing, and a
 * warning would let install-gate keep passing.
 */
export const checkInstallationIntegrity = (_ctx) => {
    const title = 'installation integrity';
    const id = 'installation-integrity';
    const category = 'runtime';
    const present = [];
    const missing = [];
    for (const segments of SHIPPED_ASSETS) {
        try {
            readInstalledFile(...segments);
            present.push(relativeOf(segments));
        }
        catch (error) {
            if (!isMissingInstalledFile(error))
                throw error;
            // The detail is readInstalledFile's error — the same text validate
            // prints for this condition. There is no second wording because two
            // phrasings of one repair is how they drift.
            const detail = error instanceof Error ? error.message : String(error);
            missing.push({ relative: relativeOf(segments), detail });
        }
    }
    const [first] = missing;
    if (first !== undefined) {
        return check(id, category, title, 'fail', first.detail, null, false, undefined, {
            evidence: {
                missing: missing.map((entry) => entry.relative).join(', '),
                present: present.join(', ') || 'none',
            },
        });
    }
    return check(id, category, title, 'ok', `${String(present.length)} shipped files are present and readable`, null, false, undefined, {
        evidence: {
            files: present.join(', '),
        },
    });
};
//# sourceMappingURL=runtime-installation-integrity.js.map