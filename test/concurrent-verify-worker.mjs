/**
 * Child process for the #591 concurrency test.
 *
 * Loaded as a real Node process against the committed `dist/` so two callers
 * share nothing but the pending file. The parent writes a JSON payload path
 * as argv[2] and reads one JSON object from stdout.
 */
import { readFileSync } from 'node:fs';

import { verifyCaptureRecords } from '../dist/core/capture-verify.js';

const payloadPath = process.argv[2];
if (typeof payloadPath !== 'string' || payloadPath.length === 0) {
  process.stderr.write('usage: concurrent-verify-worker.mjs <payload.json>\n');
  process.exit(2);
}

const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
const result = verifyCaptureRecords(payload);
const acceptedIds = [];
for (const accepted of result.accepted) {
  const id = accepted.record.trailers.find((trailer) => trailer.key === 'Record-Id')?.value;
  if (typeof id === 'string') acceptedIds.push(id);
}

process.stdout.write(
  JSON.stringify({
    validation_result: result.validation_result,
    incomplete: result.incomplete,
    acceptedIds,
  }),
);
