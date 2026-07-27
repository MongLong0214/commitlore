/**
 * Harvest — the two deterministic ends of the draft pipeline (ADR-0006 §5).
 *
 * CommitLore is free forever, so the CLI carries no model and no API key. The
 * judgement in the middle of a harvest belongs to the user's own agent session.
 * This module owns everything on either side of that session, and everything on
 * either side is deterministic: the prompt contract handed *to* it, and the
 * format check applied to whatever comes *back*.
 *
 * `parseDraft` never repairs. A draft that omits a citation, names a key outside
 * SPEC §3, or carries a value the vocabulary rejects is discarded with a reason.
 * Repairing it would manufacture the one thing this protocol exists to prevent:
 * a record nobody actually made. A missing record costs a reader nothing; a
 * fabricated one costs every reader after it (ADR-0006).
 *
 * Checking that a quote is *true* — that it really appears in the transcript or
 * the diff it names — is deliberately not here. That is the verifier's job
 * (T-404): maker and checker stay separate (ADR-0006 ruled out self-checking
 * harvest agents).
 */
import { readFileSync } from 'node:fs';
import { validateRecord } from './schema.js';
import { installedPath } from './paths.js';
import { BLAST_VALUES, CERTAINTY_VALUES, KNOWN_KEYS, PROVENANCE_PREFIXES, RECORD_ID_RE, SINGLE_VALUED, UNDO_VALUES, } from './types.js';
/**
 * Resolved relative to this module so it works from `src/` under vitest and
 * from `dist/` after install — both sit one directory below the package root,
 * and `package.json#files` ships `spec/`. Same arrangement as `schema.ts`.
 */
const SPEC_PATH = installedPath('spec', 'SPEC.md');
/**
 * The two SPEC §3 tables, in order. Their titles are load-bearing, not
 * decorative: §3.1 is what a record *claims* and therefore what evidence must
 * cover, §3.2 is bookkeeping that no transcript can be expected to prove. If
 * SPEC renumbers or retitles them, the prompt must fail loudly rather than
 * silently harvest against a vocabulary that has moved.
 */
const CLAIM_SECTION = '3.1 Decision context';
const BOOKKEEPING_SECTION = '3.2 Identity, lifecycle, provenance';
const VOCABULARY_SECTIONS = [CLAIM_SECTION, BOOKKEEPING_SECTION];
/**
 * Value grammars the prompt states from `types.ts` rather than from SPEC prose,
 * so that changing a constant changes the prompt. SPEC's own cell for each of
 * these is compared against this string during parsing — the two are one fact
 * with two homes, and a disagreement is a drift, not a preference.
 */
const GRAMMAR_FROM_TYPES = {
    Blast: BLAST_VALUES.join(' | '),
    Undo: UNDO_VALUES.join(' | '),
    Certainty: CERTAINTY_VALUES.join(' | '),
    'Record-Id': RECORD_ID_RE.source.replace(/^\^/, '').replace(/\$$/, ''),
};
const drift = (detail) => new Error(`SPEC §3 has drifted from src/core/types.ts: ${detail}`);
/**
 * Splits one markdown table row into its cells. Pipes inside a cell are
 * backslash-escaped in SPEC (`Ruled-out`'s own separator is a pipe), so the
 * split must ignore those — and unescape them afterwards.
 */
const splitRow = (line) => line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').replace(/`/g, '').trim());
/** The lines of `## 3. Vocabulary`, up to the next top-level heading. */
const vocabularySection = (specText) => {
    const lines = specText.split('\n');
    const start = lines.findIndex((line) => /^## 3\.\s/.test(line));
    if (start === -1)
        throw new Error('SPEC.md has no "## 3." vocabulary section');
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^## /.test(line));
    return end === -1 ? rest : rest.slice(0, end);
};
/**
 * Reads the vocabulary out of SPEC §3 and checks it against `types.ts`,
 * throwing on any disagreement. Both are required: SPEC carries the grammar and
 * the meaning that a prompt needs, `types.ts` carries the values the validator
 * enforces, and a prompt built from only one of them can teach a session to
 * write records the other half rejects.
 */
export const parseVocabulary = (specText) => {
    const entries = [];
    const sections = [];
    let section = '';
    for (const line of vocabularySection(specText)) {
        const heading = /^###\s+(\d+\.\d+\s+.+?)\s*$/.exec(line);
        if (heading !== null) {
            section = heading[1] ?? '';
            continue;
        }
        if (!line.startsWith('|'))
            continue;
        const cells = splitRow(line);
        if (cells.length !== 4)
            continue;
        const [rawKey = '', specGrammar = '', repeatable = '', meaning = ''] = cells;
        if (rawKey === 'Key' || /^-+$/.test(rawKey))
            continue;
        const key = rawKey.replace(/:$/, '');
        if (key === '')
            throw drift(`a §3 table row has an empty key: ${line}`);
        if (repeatable !== 'yes' && repeatable !== 'no') {
            throw drift(`${key}: Repeatable is ${JSON.stringify(repeatable)}, want "yes" or "no"`);
        }
        const fromTypes = GRAMMAR_FROM_TYPES[key];
        if (fromTypes !== undefined && fromTypes !== specGrammar) {
            throw drift(`${key}: SPEC says ${JSON.stringify(specGrammar)}, types.ts says ${JSON.stringify(fromTypes)}`);
        }
        if (!sections.includes(section))
            sections.push(section);
        entries.push({
            key,
            grammar: fromTypes ?? specGrammar,
            repeatable: repeatable === 'yes',
            meaning,
            section,
            claim: section === CLAIM_SECTION,
        });
    }
    assertMatchesTypes(entries, sections);
    return entries;
};
const assertMatchesTypes = (entries, sections) => {
    if (sections.join(' / ') !== VOCABULARY_SECTIONS.join(' / ')) {
        throw drift(`§3 tables are [${sections.join(', ')}], want [${VOCABULARY_SECTIONS.join(', ')}]`);
    }
    const extensions = entries.filter((entry) => entry.key.startsWith('X-'));
    if (extensions.length !== 1) {
        throw drift(`§3 lists ${extensions.length} extension keys, want exactly one (X-<Name>)`);
    }
    const specKeys = entries.filter((entry) => !entry.key.startsWith('X-')).map((entry) => entry.key);
    if (specKeys.join(',') !== KNOWN_KEYS.join(',')) {
        throw drift(`keys are [${specKeys.join(', ')}], types.ts KNOWN_KEYS is [${KNOWN_KEYS.join(', ')}]`);
    }
    for (const entry of entries) {
        if (entry.repeatable === SINGLE_VALUED.has(entry.key)) {
            throw drift(`${entry.key}: SPEC says Repeatable=${entry.repeatable ? 'yes' : 'no'}, ` +
                `types.ts SINGLE_VALUED ${SINGLE_VALUED.has(entry.key) ? 'contains' : 'omits'} it`);
        }
    }
    const provenance = entries.find((entry) => entry.key === 'Provenance');
    const prefixes = (provenance?.grammar ?? '').split(' | ').map((value) => value.split(' ')[0] ?? '');
    if (prefixes.join(',') !== PROVENANCE_PREFIXES.join(',')) {
        throw drift(`Provenance prefixes are [${prefixes.join(', ')}], ` +
            `types.ts PROVENANCE_PREFIXES is [${PROVENANCE_PREFIXES.join(', ')}]`);
    }
};
let vocabulary = null;
/** The vocabulary of SPEC §3, read once per process. */
export const loadVocabulary = () => {
    if (vocabulary === null)
        vocabulary = parseVocabulary(readFileSync(SPEC_PATH, 'utf8'));
    return vocabulary;
};
/**
 * The shape a session must emit, kept as a typed value rather than as prose in
 * the prompt: it cannot drift from `DraftRecord`, and `parseDraft` accepting it
 * is a test, not a hope.
 */
export const EXAMPLE_DRAFT = {
    records: [
        {
            trailers: [
                { key: 'Limit', value: 'the CDN times out at 30s' },
                {
                    key: 'Ruled-out',
                    value: 'queue worker | needs infrastructure the free tier does not have',
                },
            ],
            evidence: [
                {
                    key: 'Limit',
                    source: 'transcript',
                    quote: 'the CDN times out at 30s',
                    locator: 'L4-L4',
                },
                {
                    key: 'Ruled-out',
                    source: 'transcript',
                    quote: 'needs infrastructure the free tier does not have',
                    locator: 'L3-L3',
                },
            ],
        },
    ],
};
const RULES = [
    '1. Cite or omit. Every claim you record must quote the transcript or the diff.',
    '   A missing record is better than a false one.',
    '2. Do not infer. If it is not in the transcript or the diff below, it did not',
    '   happen. Do not supply context from anywhere else, including what you already',
    '   know about this codebase.',
    '3. Quote verbatim. A separate verifier checks every quote against the original',
    '   text and discards any record whose quote does not appear there character for',
    '   character. Copy the line content only, never the "NN | " line-number prefix.',
    '4. Use the listed values exactly. A plausible synonym for an enum value is a',
    '   violation, not a shortcut: it is rejected, never corrected.',
    '5. Record nothing for a trivial change. Typo fixes and formatting carry no',
    '   record — noise costs more than it returns.',
    '6. When unsure, emit less. Everything you emit will be read by an agent that',
    '   cannot check it.',
    '7. Do not emit Verified. Reading a transcript or diff cannot prove a check ran.',
    '   Record Verified only from the command or test run that performed the check.',
];
/**
 * A list, not a markdown table. Two value grammars in SPEC §3 contain a literal
 * pipe — `Ruled-out`'s separator is one — which a table cell cannot carry
 * without escaping, and an escape is one more thing for a reader to get wrong
 * about the exact bytes it must emit.
 */
const vocabularyList = (entries) => entries.flatMap((entry) => [
    `- \`${entry.key}:\` = ${entry.grammar} (${entry.repeatable ? 'repeatable' : 'single-valued'})`,
    `  ${entry.meaning}`,
]);
const vocabularyBlock = (entries) => {
    const lines = [
        '## Vocabulary',
        '',
        `${entries.length} keys. No other key exists — anything else is rejected, not stored.`,
    ];
    for (const section of VOCABULARY_SECTIONS) {
        const rows = entries.filter((entry) => entry.section === section);
        lines.push('', `### ${section}`, '', ...vocabularyList(rows));
    }
    return lines;
};
/** Line-numbered so a citation can name a range the verifier can find again. */
const numberLines = (text) => {
    const lines = text.split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '')
        lines.pop();
    const width = String(lines.length).length;
    return lines.map((line, index) => `${String(index + 1).padStart(width)} | ${line}`).join('\n');
};
const outputBlock = (entries) => {
    const claims = entries.filter((entry) => entry.claim).map((entry) => entry.key);
    return [
        '## Output',
        '',
        'Emit one JSON object and nothing else — no prose before or after it, no',
        'markdown code fence around it:',
        '',
        JSON.stringify(EXAMPLE_DRAFT, null, 2),
        '',
        'Field rules:',
        '',
        '- `trailers` — one entry per line of the record. `key` is a vocabulary key',
        '  without its colon; `value` is a single unfolded line.',
        '- `evidence` — the citations. `key` names the trailer this citation supports',
        "  and must be one of the record's own trailer keys. `source` is",
        '  "transcript" or "diff". `quote` is copied verbatim from that source.',
        '  `locator` is `L<start>-L<end>` for the transcript, or the `@@ ... @@` hunk',
        '  header for the diff.',
        '- Every decision-context key that appears in a record needs at least one',
        '  evidence entry:',
        `  ${claims.join(', ')}.`,
        '  A record carrying one of them with nothing to cite is discarded whole.',
        '  Identity and lifecycle keys need no citation.',
        '- A record may carry no field other than `trailers` and `evidence`.',
        '- Nothing worth recording: emit {"records": []}. That is a correct answer,',
        '  and the common one.',
    ];
};
/**
 * Builds the prompt contract handed to the user's agent session. Deterministic
 * by construction — no clock, no randomness, no model — so the same transcript
 * and diff always produce the same bytes.
 */
export const buildHarvestPrompt = (input) => {
    const entries = loadVocabulary().filter((entry) => entry.key !== 'Verified');
    const diff = input.diff.trim() === '' ? '(no diff)' : input.diff.replace(/\n+$/, '');
    return [
        '# CommitLore harvest',
        '',
        'You are recording the decision context for a change that is about to be',
        'committed. A CommitLore record is a set of git commit trailers that captures',
        'what the diff cannot show: the conditions that shaped the decision, the',
        'alternatives that were dropped, and the warnings whoever modifies this next',
        'will need.',
        '',
        'Work only from the TRANSCRIPT and the DIFF at the end of this prompt.',
        '',
        '## Rules',
        '',
        ...RULES,
        '',
        ...vocabularyBlock(entries),
        '',
        ...outputBlock(entries),
        '',
        '## TRANSCRIPT',
        '',
        numberLines(input.transcript),
        '',
        '## DIFF',
        '',
        diff,
        '',
    ].join('\n');
};
const RECORD_FIELDS = ['trailers', 'evidence'];
const EVIDENCE_FIELDS = ['key', 'source', 'quote', 'locator'];
const EVIDENCE_SOURCES = ['transcript', 'diff'];
const isEvidenceSource = (value) => EVIDENCE_SOURCES.some((source) => source === value);
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const unknownFields = (value, allowed) => Object.keys(value)
    .filter((field) => !allowed.includes(field))
    .sort();
const reject = (index, rule, detail, violations = []) => ({ index, rule, detail, violations });
/**
 * Trailers are read, never coerced: a numeric `value` is a malformed draft, not
 * a value to `String()`. Coercion is how a session's mistake becomes a record.
 */
const readTrailers = (value) => {
    if (!Array.isArray(value))
        return `"trailers" is ${typeof value}, want an array`;
    if (value.length === 0)
        return '"trailers" is empty — a record with no trailers records nothing';
    const trailers = [];
    for (const [index, entry] of value.entries()) {
        if (!isObject(entry))
            return `trailers[${index}] is not an object`;
        const extra = unknownFields(entry, ['key', 'value']);
        if (extra.length > 0)
            return `trailers[${index}] has unknown field(s): ${extra.join(', ')}`;
        if (!isNonEmptyString(entry['key']))
            return `trailers[${index}].key is not a non-empty string`;
        if (typeof entry['value'] !== 'string')
            return `trailers[${index}].value is not a string`;
        trailers.push({ key: entry['key'], value: entry['value'] });
    }
    return trailers;
};
const readEvidence = (value) => {
    if (!Array.isArray(value))
        return `"evidence" is ${typeof value}, want an array`;
    const evidence = [];
    for (const [index, entry] of value.entries()) {
        if (!isObject(entry))
            return `evidence[${index}] is not an object`;
        const extra = unknownFields(entry, EVIDENCE_FIELDS);
        if (extra.length > 0)
            return `evidence[${index}] has unknown field(s): ${extra.join(', ')}`;
        const source = entry['source'];
        if (!isEvidenceSource(source)) {
            return `evidence[${index}].source is ${JSON.stringify(source)}, want ${EVIDENCE_SOURCES.join(' or ')}`;
        }
        const key = entry['key'];
        const quote = entry['quote'];
        const locator = entry['locator'];
        if (!isNonEmptyString(key))
            return `evidence[${index}].key is not a non-empty string`;
        if (!isNonEmptyString(quote))
            return `evidence[${index}].quote is not a non-empty string`;
        if (!isNonEmptyString(locator))
            return `evidence[${index}].locator is not a non-empty string`;
        evidence.push({ key, source, quote, locator });
    }
    return evidence;
};
/** `got` repeats the key for `unknown-key`; printing it twice reads like a bug. */
const describeViolation = (violation) => violation.got === violation.key
    ? `${violation.key} (${violation.rule}, want ${violation.want})`
    : `${violation.key}: ${JSON.stringify(violation.got)} (${violation.rule}, want ${violation.want})`;
const reviewRecord = (entry, index) => {
    if (!isObject(entry))
        return reject(index, 'not-an-object', `record is ${typeof entry}`);
    const extra = unknownFields(entry, RECORD_FIELDS);
    if (extra.length > 0) {
        return reject(index, 'unknown-field', `unknown field(s): ${extra.join(', ')}`);
    }
    const trailers = readTrailers(entry['trailers']);
    if (typeof trailers === 'string')
        return reject(index, 'malformed-trailers', trailers);
    if (entry['evidence'] === undefined) {
        return reject(index, 'missing-evidence', 'no "evidence" — an uncited record is discarded');
    }
    const evidence = readEvidence(entry['evidence']);
    if (typeof evidence === 'string')
        return reject(index, 'malformed-evidence', evidence);
    if (evidence.length === 0) {
        return reject(index, 'missing-evidence', '"evidence" is empty — an uncited record is discarded');
    }
    const keys = new Set(trailers.map((trailer) => trailer.key));
    const orphans = [...new Set(evidence.map((cite) => cite.key))].filter((key) => !keys.has(key));
    if (orphans.length > 0) {
        return reject(index, 'evidence-orphan', `evidence cites ${orphans.map((key) => `"${key}"`).join(', ')}, which the record does not carry`);
    }
    const cited = new Set(evidence.map((cite) => cite.key));
    const claimKeys = new Set(loadVocabulary()
        .filter((vocabularyEntry) => vocabularyEntry.claim)
        .map((vocabularyEntry) => vocabularyEntry.key));
    const uncited = [...keys].filter((key) => claimKeys.has(key) && !cited.has(key));
    if (uncited.length > 0) {
        return reject(index, 'evidence-gap', `no evidence cites ${uncited.map((key) => `"${key}"`).join(', ')}`);
    }
    const violations = validateRecord(trailers);
    if (violations.length > 0) {
        return reject(index, 'vocabulary', violations.map(describeViolation).join('; '), violations);
    }
    return { trailers, evidence };
};
const parseDocument = (raw) => {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const fenced = raw.trimStart().startsWith('```')
            ? ' — the draft is wrapped in a markdown code fence; emit bare JSON'
            : '';
        throw new Error(`draft is not valid JSON: ${detail}${fenced}`);
    }
    if (!isObject(parsed)) {
        throw new Error('draft must be a JSON object with a "records" array');
    }
    const extra = unknownFields(parsed, ['records']);
    if (extra.length > 0) {
        throw new Error(`draft has unknown top-level field(s): ${extra.join(', ')}`);
    }
    const records = parsed['records'];
    if (!Array.isArray(records)) {
        throw new Error('draft must be a JSON object with a "records" array');
    }
    return records;
};
/**
 * Parses and format-checks a draft produced by an agent session.
 *
 * Throws only when the document itself cannot be read as a draft — malformed
 * JSON, a missing `records` array. Anything wrong with an individual record is
 * a rejection, not a throw: one bad record must not cost the good ones, and the
 * reason is data the repair loop (T-404) reads.
 */
export const parseDraft = (raw) => {
    const records = [];
    const rejected = [];
    parseDocument(raw).forEach((entry, index) => {
        const reviewed = reviewRecord(entry, index);
        if ('rule' in reviewed)
            rejected.push(reviewed);
        else
            records.push(reviewed);
    });
    return { records, rejected };
};
//# sourceMappingURL=harvest.js.map