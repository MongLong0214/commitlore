#!/usr/bin/env node
// Validates the `trailers` array of a fixture's *.expected.json against
// spec/schema/record.schema.json (draft 2020-12). Used by spec/verify.sh.
//
// Usage: node validate.mjs <schema.json> <fixture.expected.json>
// Exit 0 = schema-valid, exit 1 = schema-invalid (errors printed to stderr).

import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const [, , schemaPath, fixturePath] = process.argv;
if (!schemaPath || !fixturePath) {
  console.error('usage: node validate.mjs <schema.json> <fixture.expected.json>');
  process.exit(2);
}

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const document = { trailers: fixture.trailers ?? [] };
const ok = validate(document);

if (!ok) {
  console.error(JSON.stringify(validate.errors, null, 2));
}
process.exit(ok ? 0 : 1);
