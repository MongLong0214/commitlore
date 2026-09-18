/**
 * The internal `commit-msg` dispatcher — #1048, ADR #1045 D1.
 *
 * The installed hook stub used to exec `validate --message-file "$1"`. It now
 * execs this, and this is a branch:
 *
 * ```
 * no key, or COMMITLORE_JEV=off  ->  runValidate(...)          exactly as before
 * enabled                        ->  try the optional producer, then runValidate
 * ```
 *
 * The disabled arm is the whole product for every default installation, so it is
 * written to be *provably* the old behaviour: same arguments, same repository,
 * same scan budget, same streams, same exit codes — and, because
 * `resolveJevActivation` answers before the dynamic import below is reached, no
 * optional module is executed, no transcript is read, no file is written and no
 * socket is opened. `validate` itself is untouched and stays read-only.
 *
 * ## Why `validate` is still its own command
 *
 * An old stub in an already-installed repository execs `validate` and keeps
 * working: it gets native validation and no prototype, which is exactly the
 * promise #1050 makes. Nothing about the prototype reaches a repository until
 * somebody reinstalls its hooks deliberately.
 *
 * ## Why the optional path cannot convert a failure into a success
 *
 * `runValidate` runs **after** the producer, over whatever is now in the file,
 * on every path. If the producer published a candidate, the file holds the
 * candidate and the result describes the candidate. If it did anything else —
 * skipped, failed, threw, could not even be imported — the file holds the
 * original and the result describes the original. There is no branch in which a
 * native verdict is replaced by an optional one, and no `catch` anywhere around
 * the `runValidate` call.
 */

import type { Command } from 'commander';

import { CONSUMER_SCAN_BUDGET_MS } from '../core/query.js';
import { resolveJevActivation } from '../jev/activation.js';
import { runValidate, type ValidateResult } from '../commands/validate.js';

export interface CommitMsgInput {
  readonly messageFile: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * The transport, injected.
   *
   * It exists so a behavioural test can drive **this** dispatcher and **this**
   * producer through a real `git commit` with scripted choices, instead of a
   * test-only copy of the pipeline. The product never passes it, there is no
   * environment variable or flag that sets it, and no endpoint override
   * anywhere — a repository-settable provider address is the thing ADR D4
   * forbids, and this is not one.
   */
  readonly ask?: typeof import('../jev/client.js').askJev;
}

/**
 * Runs the optional producer, if this installation has one enabled.
 *
 * Every failure inside is contained here and reported as `null`. The import is
 * dynamic so a default installation never loads the module, and it is inside the
 * try so a broken optional build — a missing file, a syntax error in a
 * hand-edited bundle — returns control to native validation instead of failing
 * the commit.
 */
const runProducer = async (input: CommitMsgInput): Promise<readonly string[] | null> => {
  const env = input.env ?? process.env;
  const activation = resolveJevActivation(env);
  if (!activation.enabled) return null;

  const cwd = input.cwd ?? process.cwd();
  try {
    const [{ produce }, { writeLastResult }] = await Promise.all([
      import('../jev/producer.js'),
      import('../jev/diagnostic.js'),
    ]);
    const outcome = await produce({
      messageFile: input.messageFile,
      cwd,
      activation,
      env,
      ...(input.ask === undefined ? {} : { ask: input.ask }),
    });
    // Best effort and after the decision, never before it: a diagnostic that
    // could fail a commit is not optional.
    writeLastResult({
      cwd,
      outcome: outcome.published ? 'published' : (outcome.cause ?? 'skipped'),
      nonce: outcome.nonce,
      usage: outcome.outcome?.usage ?? null,
      notes: outcome.notes,
    });
    return outcome.notes;
  } catch {
    // Deliberately silent. A default installation prints nothing, and an
    // enabled one whose optional half broke must not turn a working commit into
    // a confusing one — the diagnostic above is where a failure is visible, and
    // native validation below is unaffected either way.
    return null;
  }
};

/**
 * The command body.
 *
 * `runValidate` is called once, at the end, with the same inputs the `validate`
 * action passes. That single call site is the property this file exists to hold:
 * there is exactly one verdict, it comes from native code, and it describes the
 * bytes that are actually in the message file.
 */
export const runCommitMsg = async (input: CommitMsgInput): Promise<ValidateResult> => {
  await runProducer(input);
  // One call site, at the end, over whatever is now in the file. This is the
  // property the file exists to hold: exactly one verdict, from native code,
  // describing the bytes that are actually there.
  return runValidate({
    messageFile: input.messageFile,
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    // The same budget the `validate` action passes for this exact case: four
    // minutes to accept one commit is worse than a partial check that says so.
    scanBudgetMs: CONSUMER_SCAN_BUDGET_MS,
  });
};

export const register = (program: Command): void => {
  program
    .command('commit-msg')
    .description('internal hook command: validate a commit message, with the optional producer')
    .requiredOption('-f, --message-file <file>', 'the commit message file git passed to the hook')
    .addHelpText(
      'after',
      '\nThis is what the installed commit-msg hook runs. It is `validate --message-file`' +
        '\nplus the optional Jev producer, which is inert without COMMITLORE_JEV_API_KEY.' +
        '\nExit codes are validate\'s: 0 clean, 1 violations, 2 usage or input error,' +
        '\n3 this installation is missing a file it ships.',
    )
    .action(async (flags: { messageFile: string }) => {
      const result = await runCommitMsg({ messageFile: flags.messageFile });
      if (result.stdout !== '') process.stdout.write(result.stdout);
      if (result.stderr !== '') process.stderr.write(result.stderr);
      if (result.code !== 0) process.exitCode = result.code;
    });
};
