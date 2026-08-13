/**
 * Single-record validation (SPEC §6).
 *
 * `spec/schema/record.schema.json` is the shape authority; this module is the
 * translation layer that turns AJV's errors into the `Violation` records the
 * repair loop consumes. AJV's own messages never escape this file — they name
 * JSON Schema keywords, not protocol rules.
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import { readInstalledFile } from './paths.js';
import { splitRuledOut } from './trailers.js';
import { BLAST_VALUES, CERTAINTY_VALUES, EXTENSION_KEY_RE, KNOWN_KEYS, PROVENANCE_FORMAT_WANT, SINGLE_VALUED, UNDO_VALUES, } from './types.js';
/**
 * Static import so a bundler can follow it.
 *
 * `createRequire` reached the real `module.exports` and kept the binding
 * typed, but it is opaque to esbuild: the dependency stayed external and a
 * distribution without node_modules failed at load (ADR-0011, #38).
 *
 * ajv-formats is CommonJS whose declaration ends in `export default`, so under
 * NodeNext the default import is the module namespace and the plugin sits on
 * `.default`. The same expression works in three places for two reasons: Node
 * hands ESM the CJS `module.exports`, which carries a `.default` from the
 * package own dual export, and esbuild reproduces that interop when it inlines
 * the module.
 */
import ajvFormats from "ajv-formats";
const addFormats = ajvFormats.default;
/**
 * Read relative to this module's own installation so it works from `src/`
 * under vitest, from `dist/` after a checkout install, and from a compiled
 * binary's embedded assets (`core/paths.ts`) — all three ship `spec/schema/`
 * one way or another.
 */
const SCHEMA_ASSET = ['spec', 'schema', 'record.schema.json'];
/** `want` text for the three closed enums (SPEC §3.1). */
const ENUM_WANT = {
    Blast: BLAST_VALUES.join('|'),
    Undo: UNDO_VALUES.join('|'),
    Certainty: CERTAINTY_VALUES.join('|'),
};
/** `want` text for value grammars that are not enums (SPEC §3.1, §3.2). */
const FORMAT_WANT = {
    'Ruled-out': 'alternative | reason',
    'Record-Id': 'r-[a-z0-9]{6,}',
    Follows: 'r-[a-z0-9]{6,}',
    Supersedes: 'r-[a-z0-9]{6,}',
    Expires: 'YYYY-MM-DD or a free-text condition',
    Evidence: 'path, path#anchor, or a URL',
    Provenance: PROVENANCE_FORMAT_WANT,
    'CommitLore-Version': 'semver',
};
const UNKNOWN_KEY_WANT = 'a key from SPEC §3 or X-<Name>';
/**
 * `Ruled-out:` fails its grammar two ways and the repair differs, so the
 * `want` is chosen from the value rather than looked up by key alone. Telling
 * an author to write `alternative | reason` when the value already holds a
 * separator is no advice at all: the separator is there, it is just inside a
 * code span the split cut open (SPEC §3.1, issue #372).
 */
const RULED_OUT_CODE_SPAN_WANT = 'alternative | reason — the alternative opens a code span that closes after the ' +
    'separator, so the first "|" sits inside quoted text; there is no escape, so ' +
    'rephrase the alternative to hold no "|"';
const formatWantFor = (trailer) => {
    const want = FORMAT_WANT[trailer.key];
    if (want === undefined || trailer.key !== 'Ruled-out')
        return want;
    return splitRuledOut(trailer.value).unterminatedCodeSpan ? RULED_OUT_CODE_SPAN_WANT : want;
};
let compiled = null;
const getValidator = () => {
    if (compiled === null) {
        const schema = JSON.parse(readInstalledFile(...SCHEMA_ASSET));
        const ajv = new Ajv2020({ allErrors: true, strict: true });
        addFormats(ajv);
        compiled = ajv.compile(schema);
    }
    return compiled;
};
/** `/trailers/3/value` -> `{ index: 3, field: 'value' }`. Anything else -> null. */
const locate = (instancePath) => {
    const match = /^\/trailers\/(\d+)\/(key|value)$/.exec(instancePath);
    if (match === null)
        return null;
    const [, rawIndex = '', field = ''] = match;
    return { index: Number(rawIndex), field };
};
/**
 * Trailers git's own ecosystem writes that are not CommitLore's and never
 * will be: DCO (`git commit -s`, and every Dependabot commit) and GitHub's
 * co-author attribution. Reproduced: a `git commit -s` with no CommitLore
 * content at all was refused outright by the hook with `unknown-key
 * Signed-off-by`, which would make DCO and CommitLore mutually exclusive in
 * the same repository. This list stays short on purpose — it admits trailers
 * that are standardised and near-impossible to type by mistake, not a general
 * escape hatch. A key merely resembling protocol vocabulary, such as
 * `Constraint:`, must keep failing as `unknown-key`: that is the case
 * spec/fixtures/invalid/03-unknown-key.txt exists to pin.
 */
const WELL_KNOWN_FOREIGN_KEYS = new Set(['Signed-off-by', 'Co-authored-by']);
/**
 * Whether the key is one the protocol defines, a well-formed extension, or a
 * trailer CommitLore does not own and should not judge.
 *
 * Asked directly rather than inferred from where AJV anchored its error. The
 * schema checks cardinality with `contains`, and a `contains` probe emits a
 * failure at `/trailers/N/key` for **every trailer that is not the key being
 * counted** — those failures are the probe working, not a bad key. Reading the
 * path alone turned one real cardinality violation into a phantom
 * `unknown-key` for each unrelated trailer, so a record with two `Provenance:`
 * lines reported that `Verified:` does not exist. Found by dogfooding: gitseed
 * rendered three records into one commit and was told to stop using half the
 * vocabulary.
 */
const isDefinedKey = (key) => KNOWN_KEYS.includes(key) ||
    EXTENSION_KEY_RE.test(key) ||
    WELL_KNOWN_FOREIGN_KEYS.has(key);
const violationFor = (trailer, field) => {
    if (field === 'key') {
        if (isDefinedKey(trailer.key))
            return null;
        return {
            key: trailer.key,
            value: trailer.value,
            rule: 'unknown-key',
            got: trailer.key,
            want: UNKNOWN_KEY_WANT,
        };
    }
    const enumWant = ENUM_WANT[trailer.key];
    if (enumWant !== undefined) {
        return {
            key: trailer.key,
            value: trailer.value,
            rule: 'enum',
            got: trailer.value,
            want: enumWant,
        };
    }
    const formatWant = formatWantFor(trailer);
    if (formatWant !== undefined) {
        return {
            key: trailer.key,
            value: trailer.value,
            rule: 'format',
            got: trailer.value,
            want: formatWant,
        };
    }
    return null;
};
/**
 * Maps AJV errors onto violations, one per (trailer, rule). A single bad value
 * produces several AJV errors (`anyOf` plus each failed branch); the protocol
 * has one violation to report for it.
 *
 * Errors anchored at `/trailers` rather than at a specific trailer are the
 * schema's `maxContains` cardinality checks. They are dropped here and redone
 * in `cardinalityViolations`, which can name the offending occurrence.
 */
const schemaViolations = (trailers) => {
    const validate = getValidator();
    if (validate({ trailers }))
        return [];
    const errors = validate.errors ?? [];
    const found = new Map();
    for (const error of errors) {
        const target = locate(error.instancePath);
        if (target === null)
            continue;
        const trailer = trailers[target.index];
        if (trailer === undefined)
            continue;
        const violation = violationFor(trailer, target.field);
        if (violation === null)
            continue;
        const dedupeKey = `${target.index}:${violation.rule}`;
        if (!found.has(dedupeKey))
            found.set(dedupeKey, { index: target.index, violation });
    }
    return [...found.values()];
};
/**
 * Cardinality (SPEC §6) lives in code, not in the schema: JSON Schema's
 * `maxContains` can say a record has too many `Blast:` trailers but cannot
 * point at which one, and the repair loop needs the offending occurrence.
 * Every occurrence after the first is reported.
 */
const cardinalityViolations = (trailers) => {
    const seen = new Map();
    const found = [];
    trailers.forEach((trailer, index) => {
        if (!SINGLE_VALUED.has(trailer.key))
            return;
        const count = (seen.get(trailer.key) ?? 0) + 1;
        seen.set(trailer.key, count);
        if (count === 1)
            return;
        found.push({
            index,
            violation: {
                key: trailer.key,
                value: trailer.value,
                rule: 'cardinality',
                got: String(count),
                want: 'at most 1',
            },
        });
    });
    return found;
};
/**
 * Validates one record — the trailers of a single commit — against SPEC §3,
 * returning every violation in trailer order. An empty array means the record
 * is well-formed (SPEC §4).
 *
 * Scope: this function sees one record and nothing else. It therefore never
 * reports the reference-class `dangling-ref` or `duplicate-id` violations.
 * A syntactically valid `Supersedes:` pointing at nothing is clean here by
 * design.
 */
export const validateRecord = (trailers) => [...schemaViolations(trailers), ...cardinalityViolations(trailers)]
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.violation);
//# sourceMappingURL=schema.js.map