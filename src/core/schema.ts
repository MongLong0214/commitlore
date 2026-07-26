/**
 * Single-record validation (SPEC §6).
 *
 * `spec/schema/record.schema.json` is the shape authority; this module is the
 * translation layer that turns AJV's errors into the `Violation` records the
 * repair loop consumes. AJV's own messages never escape this file — they name
 * JSON Schema keywords, not protocol rules.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AnySchemaObject, ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';
import type { FormatsPlugin } from 'ajv-formats';

import {
  BLAST_VALUES,
  CERTAINTY_VALUES,
  SINGLE_VALUED,
  UNDO_VALUES,
  type Trailer,
  type Violation,
} from './types.js';

/**
 * ajv-formats is CommonJS and this package compiles without `esModuleInterop`,
 * under which TypeScript models the module's default export as the namespace
 * itself rather than as the plugin function. `createRequire` reaches the real
 * `module.exports` and keeps the binding typed.
 */
const addFormats: FormatsPlugin = createRequire(import.meta.url)('ajv-formats');

/**
 * Resolved relative to this module so it works from `src/` under vitest and
 * from `dist/` after install — both sit one directory below the package root,
 * and `package.json#files` ships `spec/`.
 */
const SCHEMA_PATH = fileURLToPath(new URL('../../spec/schema/record.schema.json', import.meta.url));

/** `want` text for the three closed enums (SPEC §3.1). */
const ENUM_WANT: Readonly<Record<string, string>> = {
  Blast: BLAST_VALUES.join('|'),
  Undo: UNDO_VALUES.join('|'),
  Certainty: CERTAINTY_VALUES.join('|'),
};

/** `want` text for value grammars that are not enums (SPEC §3.1, §3.2). */
const FORMAT_WANT: Readonly<Record<string, string>> = {
  'Ruled-out': 'alternative | reason',
  'Record-Id': 'r-[a-z0-9]{6,}',
  Follows: 'r-[a-z0-9]{6,}',
  Supersedes: 'r-[a-z0-9]{6,}',
  Expires: 'YYYY-MM-DD or a free-text condition',
  Evidence: 'path, path#anchor, or a URL',
  Provenance: 'authored | inherited <sha> | reconstructed | unknown',
  'CommitLore-Version': 'semver',
};

const UNKNOWN_KEY_WANT = 'a key from SPEC §3 or X-<Name>';

interface RecordDocument {
  trailers: Trailer[];
}

let compiled: ValidateFunction<RecordDocument> | null = null;

const getValidator = (): ValidateFunction<RecordDocument> => {
  if (compiled === null) {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as AnySchemaObject;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    compiled = ajv.compile<RecordDocument>(schema);
  }
  return compiled;
};

/** `/trailers/3/value` -> `{ index: 3, field: 'value' }`. Anything else -> null. */
const locate = (instancePath: string): { index: number; field: string } | null => {
  const match = /^\/trailers\/(\d+)\/(key|value)$/.exec(instancePath);
  if (match === null) return null;
  const [, rawIndex = '', field = ''] = match;
  return { index: Number(rawIndex), field };
};

const violationFor = (trailer: Trailer, field: string): Violation | null => {
  if (field === 'key') {
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

  const formatWant = FORMAT_WANT[trailer.key];
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
const schemaViolations = (trailers: Trailer[]): { index: number; violation: Violation }[] => {
  const validate = getValidator();
  if (validate({ trailers })) return [];

  const errors: ErrorObject[] = validate.errors ?? [];
  const found = new Map<string, { index: number; violation: Violation }>();

  for (const error of errors) {
    const target = locate(error.instancePath);
    if (target === null) continue;

    const trailer = trailers[target.index];
    if (trailer === undefined) continue;

    const violation = violationFor(trailer, target.field);
    if (violation === null) continue;

    const dedupeKey = `${target.index}:${violation.rule}`;
    if (!found.has(dedupeKey)) found.set(dedupeKey, { index: target.index, violation });
  }

  return [...found.values()];
};

/**
 * Cardinality (SPEC §6) lives in code, not in the schema: JSON Schema's
 * `maxContains` can say a record has too many `Blast:` trailers but cannot
 * point at which one, and the repair loop needs the offending occurrence.
 * Every occurrence after the first is reported.
 */
const cardinalityViolations = (trailers: Trailer[]): { index: number; violation: Violation }[] => {
  const seen = new Map<string, number>();
  const found: { index: number; violation: Violation }[] = [];

  trailers.forEach((trailer, index) => {
    if (!SINGLE_VALUED.has(trailer.key)) return;
    const count = (seen.get(trailer.key) ?? 0) + 1;
    seen.set(trailer.key, count);
    if (count === 1) return;
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
 * reports `dangling-ref`, which asks whether a `Follows:`/`Supersedes:` target
 * exists elsewhere in history — a cross-record question owned by the stale
 * engine (T-205). A syntactically valid `Supersedes:` pointing at nothing is
 * clean here by design.
 */
export const validateRecord = (trailers: Trailer[]): Violation[] =>
  [...schemaViolations(trailers), ...cardinalityViolations(trailers)]
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.violation);
