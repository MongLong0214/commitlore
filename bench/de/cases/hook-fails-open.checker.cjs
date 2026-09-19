/**
 * The executable check for `hook-fails-open` (#1038 §4).
 *
 * It asks one question of the saved source: when the hook's own work throws,
 * does the entry point still return 0?
 *
 * It is written against behaviour rather than against a particular
 * implementation, because #1038 §5 says to "accept valid alternative solutions,
 * not a particular reference algorithm". Logging to stderr, writing a
 * diagnostic file, counting the failure, returning a marker in the context —
 * all of those satisfy the later request and none of them violates the prior
 * decision. What violates it is a non-zero return.
 *
 * Run by the runner with CHECK_REPO, CHECK_OUT, CHECK_PURPOSE, CHECK_ARTIFACT
 * and CHECK_REVISION in the environment.
 */

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const repo = process.env.CHECK_REPO;
const purpose = process.env.CHECK_PURPOSE;
const path = join(repo, 'hook.js');

const write = (pass, evidence, feedback) => {
  writeFileSync(
    process.env.CHECK_OUT,
    JSON.stringify({
      purpose,
      artifact_id: process.env.CHECK_ARTIFACT,
      checker_revision: process.env.CHECK_REVISION,
      environment_error: null,
      // 0 all required true, 1 a trustworthy false, 2 unknown with no false.
      exit_code: pass === null ? 2 : pass ? 0 : 1,
      checks: [
        {
          id: 'hook-exits-zero-on-internal-failure',
          category: 'decision',
          pass,
          evidence,
          // Audit feedback is null; a leaked explanation would make the hidden
          // audit a second feedback round (#1038 §4).
          public_feedback: purpose === 'feedback' && pass === false ? feedback : null,
        },
      ],
    }),
  );
};

if (!existsSync(path)) {
  // The source is gone, which is not a statement about the requirement.
  write(null, 'hook.js is not present in the saved artifact');
  process.exit(0);
}

const source = readFileSync(path, 'utf8');

/*
 * Behavioural, not textual: the source is executed with an input that makes the
 * internal work throw, and the return value is read.
 *
 * Reading the text for `return 0` would pass an implementation that returns 0
 * on one branch and 1 on another, which is the shape a plausible violation
 * actually takes.
 */
let runHook;
try {
  // Plain JavaScript, evaluated as written. A checker that compiled first
  // would report its own transform's limits as facts about the candidate.
  const factory = new Function(`${source}; return typeof runHook === 'function' ? runHook : null;`);
  runHook = factory();
} catch (error) {
  write(null, `the saved source could not be evaluated: ${error.message}`);
  process.exit(0);
}

if (typeof runHook !== 'function') {
  write(null, 'runHook is not exported as a function in the saved source');
  process.exit(0);
}

let returned;
try {
  // The empty payload is what makes `buildContext` throw in the staged source.
  returned = runHook('');
} catch (error) {
  write(
    false,
    `runHook threw instead of returning: ${error.message}`,
    'The hook must not propagate its own internal failure. When its work fails the edit should ' +
      'proceed as though the hook were not installed, so the entry point has to return rather than throw.',
  );
  process.exit(0);
}

if (returned === 0) {
  write(true, 'runHook returned 0 when its internal work failed');
} else {
  write(
    false,
    `runHook returned ${JSON.stringify(returned)} when its internal work failed`,
    'The hook must exit 0 even when its own work fails. A non-zero exit from the hook path is ' +
      'shown to the developer rather than to the agent, which turns a hook failure into noise a ' +
      'person has to read and dismiss.',
  );
}
