/**
 * `commitlore init` — one command instead of the three-command onboarding
 * sequence (`doctor --fix`, `hooks install`, `index --rebuild`; see
 * `runInit` below for why this file runs them hooks, index, doctor instead
 * of that order).
 *
 * The three pieces stay: this file calls the same functions their own
 * commands call (`runDoctor`, `installHook`, `rebuildIndex`) rather than
 * re-implementing them, so `init` can never disagree with running the steps
 * by hand. It exists only to remove the four-command discovery problem (the
 * install path sits ~100 lines into the README) and the three-command
 * sequencing problem (a new clone has to know the order and that all three
 * are needed at all).
 *
 * The one rule this command exists to enforce on itself: **a step that fails
 * is reported as failed, never folded into a cheerful "done".** #63 (`doctor
 * --fix` silently broke `git fetch`) and #67 (a hook could fail with nothing
 * on stderr) were both this same defect — a step that did not do what it
 * claimed, discovered later, far from the command that hid it. `init` runs
 * three steps that can each fail independently and are not allowed to hide
 * that from one another: doctor's own fail/warn distinction is preserved
 * verbatim, and a hook or index step that could not run is a step this
 * command marks failed, not a step it skips past.
 *
 * Idempotent by construction, not by a special case: every step it calls is
 * already idempotent on its own (doctor's checks re-report `ok` once fixed,
 * `hooks install` reports "already installed ... (unchanged)", and an index
 * rebuild is a deterministic function of repository state) — running `init`
 * twice with nothing else changing degrades gracefully because with nothing
 * else changing, none of the three sub-invocations do.
 */

import type { Command } from 'commander';

import { formatReport, runDoctor, type DoctorReport } from './doctor.js';
import { installHook, type HookResult } from './hooks.js';
import { closeIndex, indexInfo, openIndex, rebuildIndex, type IndexStats } from '../core/index-db.js';
import { notesAvailability } from '../core/notes.js';
import { claudeSettingsPath, installClaudeHook, type ClaudeHookResult } from '../hooks/claude-settings.js';
import { installPrepareCommitMsgHook, type PrepareCommitMsgHookResult } from '../hooks/prepare-commit-msg.js';
import { installPostCommitHook, type PostCommitHookResult } from '../hooks/post-commit.js';
import { installPrePushHook, type PrePushHookResult } from '../hooks/pre-push.js';
import { seedTrustedAuthor, type TrustSeedResult } from '../core/trusted-authors.js';

export interface InitOptions {
  cwd?: string;
  /** Forwarded to `hooks install --force` — replace an already-preserved foreign hook. */
  force?: boolean;
}

type StepName = 'doctor' | 'hooks' | 'index' | 'claude-hook' | 'trust';

export interface InitStep {
  step: StepName;
  title: string;
  /** 0 clean, 1 doctor found something it could not fix itself, 2 the step could not run. */
  code: 0 | 1 | 2;
  /** Human-readable lines this step contributes to the report. */
  lines: string[];
  detail: DoctorReport | HookResult | IndexStepDetail | ClaudeHookResult | TrustSeedResult | readonly [HookResult, PrepareCommitMsgHookResult, PostCommitHookResult, PrePushHookResult];
}

interface IndexStepDetail {
  ok: boolean;
  message: string;
  stats?: IndexStats;
}

export interface InitReport {
  steps: InitStep[];
  /**
   * `notesAvailability()` as it stood **before** any step ran (#402).
   *
   * It has to be captured first because `init`'s own doctor step writes the
   * notes refspec, which moves the state from `unfetched` to `absent` before
   * the report is formatted. Reading it at format time therefore always misses
   * the case the user is in: a fresh clone where `git fetch` did not carry
   * `refs/notes/commitlore`, which after `init` becomes a correct refspec over
   * an index that still has none of the records kept in notes.
   */
  notesBefore: ReturnType<typeof notesAvailability>;
  /** Worst of the three step codes — 2 outranks 1 outranks 0, same order SPEC §10 gives the codes themselves. */
  exitCode: 0 | 1 | 2;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** `exactOptionalPropertyTypes` treats `{ cwd: undefined }` as distinct from omitting `cwd` entirely. */
const cwdOption = (opts: InitOptions): { cwd: string } | Record<string, never> =>
  opts.cwd === undefined ? {} : { cwd: opts.cwd };

/**
 * Stricter than `doctor`'s own exit code on purpose. `doctor` exits 0 for a
 * `warn` check by design — it reports, it never blocks a command on its own
 * (`commitlore-setup` skill). `init` is not just reporting: it is the command
 * that is supposed to have taken care of everything at once, so a warning it
 * cannot fix itself has to move the needle even though it would not move
 * `doctor`'s. A missing remote remains visible but is non-actionable: a fresh
 * repository has not reached sharing yet, rather than being misconfigured.
 * Folding actionable warnings back into "3/3 steps completed cleanly" is the
 * silent-success shape #63 and #67 were.
 */
const runDoctorStep = (opts: InitOptions): InitStep => {
  const report = runDoctor({ ...cwdOption(opts), fix: true });
  const code: 0 | 1 = report.checks.some((entry) => entry.needsAttention) ? 1 : 0;
  return {
    step: 'doctor',
    title: 'doctor --fix',
    code,
    lines: formatReport(report).trimEnd().split('\n'),
    detail: report,
  };
};

const runHooksStep = (opts: InitOptions): InitStep => {
  const commitMsg = installHook({ ...cwdOption(opts), ...(opts.force === undefined ? {} : { force: opts.force }) });
  const prepareCommitMsg = installPrepareCommitMsgHook(opts.cwd);
  const postCommit = installPostCommitHook(opts.cwd);
  // #416: without this the notes mirror is written locally and never leaves the
  // machine, so a teammate's clone cannot see a record it holds.
  const prePush = installPrePushHook(opts.cwd);
  const lines = [commitMsg, prepareCommitMsg, postCommit, prePush].flatMap((result) =>
    result.code === 0
      ? result.stdout.trimEnd().split('\n')
      : [result.stderr.trimEnd() || 'hooks install failed with no diagnostic'],
  );
  return {
    step: 'hooks',
    title: 'hooks install',
    code: [commitMsg, prepareCommitMsg, postCommit, prePush].some((r) => r.code === 2) ? 2 : 0,
    lines,
    detail: [commitMsg, prepareCommitMsg, postCommit, prePush],
  };
};

const runIndexStep = (opts: InitOptions): InitStep => {
  const cwd = opts.cwd ?? process.cwd();
  let handle;
  try {
    handle = openIndex({ cwd });
  } catch (error) {
    const message = `could not open the index: ${messageOf(error)}`;
    return {
      step: 'index',
      title: 'index --rebuild',
      code: 2,
      lines: [message],
      detail: { ok: false, message },
    };
  }

  try {
    const stats = rebuildIndex(handle, { reason: 'commitlore init' });
    const info = indexInfo(handle);
    const message = `rebuilt: scanned ${stats.commitsScanned} commit(s), indexed ${
      stats.trailersIndexed + stats.noteTrailersIndexed
    } trailer(s) in ${stats.elapsedMs}ms`;
    return {
      step: 'index',
      title: 'index --rebuild',
      code: 0,
      lines: [message, `index holds ${info.trailers} trailer(s) over ${info.commits} commit(s)`],
      detail: { ok: true, message, stats },
    };
  } catch (error) {
    const message = `could not rebuild the index: ${messageOf(error)}`;
    return {
      step: 'index',
      title: 'index --rebuild',
      code: 2,
      lines: [message],
      detail: { ok: false, message },
    };
  } finally {
    try {
      closeIndex(handle);
    } catch {
      // A close failure on a handle we are about to discard changes nothing the caller can act on.
    }
  }
};

/**
 * #415: with no trusted author recorded, grading fails closed and every record
 * the agent ever sees is `[claim]` — the `[directive]` tier the injected legend
 * advertises was unreachable on every install. Seeding the installer's own
 * identity makes it reachable without weakening the property it protects: a
 * different author's commit still grades `claim`.
 */
const runTrustStep = (opts: InitOptions): InitStep => {
  const result = seedTrustedAuthor(opts.cwd ?? process.cwd());
  return {
    step: 'trust',
    title: 'trusted author',
    code: 0,
    lines: [result.author === null ? result.reason : `${result.author} — ${result.reason}`],
    detail: result,
  };
};

const runClaudeHookStep = (opts: InitOptions): InitStep => {
  const cwd = opts.cwd ?? process.cwd();
  const settingsPath = claudeSettingsPath(cwd);
  const result = installClaudeHook({ settingsPath });

  const lines = result.stdout.trimEnd().split('\n').filter((line) => line.length > 0);
  if (result.stderr) {
    lines.push(...result.stderr.trimEnd().split('\n').filter((line) => line.length > 0));
  }

  // If the hook is already installed (unchanged), treat as success with code 0.
  // If there's an error but it's just about missing settings, that's not a failure — Claude Code may not be on this machine.
  const code: 0 | 1 | 2 =
    result.code === 0
      ? 0
      : result.status?.state === 'unreadable' && result.status.problem?.includes('cannot read')
        ? 0
        : 2;

  return {
    step: 'claude-hook',
    title: 'claude hook install',
    code,
    lines: lines.length > 0 ? lines : [result.stderr.trim() || 'failed with no diagnostic'],
    detail: result,
  };
};

/**
 * Order of execution:
 * 1. Hooks install — sets up the commit-msg hook
 * 2. Index rebuild — builds the index of trailers
 * 3. Claude hook install — wires the PreToolUse hook into .claude/settings.json
 * 4. Doctor (final check) — verifies everything is working
 *
 * Doctor runs last on purpose. `doctor` diagnoses the hook and the index among
 * its checks, and it does not install either: run it first and its own
 * report would open with "no commit-msg hook" and "no index yet" for
 * conditions this same invocation is about to fix in earlier steps. That is
 * not wrong, but it reads as though `init` shipped with a problem it did not
 * — a false alarm this command is specifically trying not to raise. The other
 * steps do not depend on each other or on doctor's fixes, so running doctor
 * last costs nothing and makes its report describe the state `init` actually
 * leaves behind, not the state it started from.
 */
export const runInit = (opts: InitOptions = {}): InitReport => {
  const notesBefore = notesAvailability(cwdOption(opts));
  const steps = [runHooksStep(opts), runTrustStep(opts), runIndexStep(opts), runClaudeHookStep(opts), runDoctorStep(opts)];
  const exitCode = steps.some((s) => s.code === 2) ? 2 : steps.some((s) => s.code === 1) ? 1 : 0;
  return { steps, notesBefore, exitCode: exitCode as 0 | 1 | 2 };
};

/** User-facing step labels — no internal command names. */
const STEP_LABEL: Record<StepName, string> = {
  hooks: 'Hooks',
  trust: 'Trust',
  index: 'Index',
  'claude-hook': 'Agent integration',
  doctor: 'Final check',
};

/** Verbose format headings (preserved for --verbose, T-1013). */
export const STEP_HEADING: Record<StepName, string> = {
  trust: 'trusted author',
  hooks: '[1/4] hooks install',
  index: '[2/4] index --rebuild',
  'claude-hook': '[3/4] claude hook install',
  doctor: '[4/4] doctor --fix (final check)',
};

export const VERBOSE_INDENT = '        ';

/**
 * Result-oriented default output: a concise summary telling the user what is
 * ready and what is not. Internal command names are absent. Failures and
 * warnings are always named — never folded into a cheerful summary (#63, #67).
 */
export const formatInitReport = (report: InitReport): string => {
  const failed = report.steps.filter((step) => step.code === 2);
  const needsAttention = report.steps.filter((step) => step.code === 1);

  const lines: string[] = [];

  if (failed.length === 0 && needsAttention.length === 0) {
    // All clean — one summary line per step + a final ready line.
    for (const step of report.steps) {
      lines.push(`  ✓ ${STEP_LABEL[step.step]}`);
    }
    lines.push('');
    lines.push('init: ready');
    // #402: every step succeeded and the index is still missing whatever the
    // team kept in notes, because `git fetch` does not carry
    // `refs/notes/commitlore`. That is the default state of a fresh clone, and
    // this is the one screen most users will read. The clean run has a line to
    // spare inside the ≤6 the output contract allows, and a `ready` that is not
    // ready costs more than the line does. The state is `notesAvailability`'s,
    // so this reports rather than checks.
    if (report.notesBefore === 'unfetched') {
      lines.push(
        'note: the notes mirror has not been fetched, so the index covers commit messages alone — run: git fetch',
      );
    }
  } else {
    // At least one step needs attention or could not run.
    for (const step of report.steps) {
      if (step.code === 0) {
        lines.push(`  ✓ ${STEP_LABEL[step.step]}`);
      } else if (step.code === 2) {
        lines.push(`  ✗ ${STEP_LABEL[step.step]} — ${step.title} could not run`);
        for (const detail of step.lines) {
          lines.push(`    ${detail}`);
        }
      } else {
        lines.push(`  ! ${STEP_LABEL[step.step]} — needs attention`);
        for (const detail of step.lines) {
          lines.push(`    ${detail}`);
        }
      }
    }
    lines.push('');
    if (failed.length > 0) {
      lines.push(`init: ${failed.length}/4 step(s) could not run — ${failed.map((s) => s.title).join(', ')}`);
    } else {
      lines.push(
        `init: ${needsAttention.length} step(s) need(s) attention — ${needsAttention.map((s) => s.title).join(', ')}`,
      );
    }
  }

  return lines.join('\n') + '\n';
};

/**
 * Verbose output: step-by-step `[1/4]`…`[4/4]` format with indented detail
 * lines. Preserves the pre-T-1012 output style for users who want the full
 * view. Failures and warnings are always visible — never folded (#63, #67).
 */
export const formatInitReportVerbose = (report: InitReport): string => {
  const lines: string[] = [];

  for (const step of report.steps) {
    lines.push(STEP_HEADING[step.step]);
    for (const detail of step.lines) {
      lines.push(`${VERBOSE_INDENT}${detail}`);
    }
  }

  return lines.join('\n') + '\n';
};

export const register = (program: Command): void => {
  program
    .command('init')
    .description('one-command onboarding: hooks install, index --rebuild, claude hook install, doctor --fix')
    .option('--force', 'forward to hooks install — replace an already-preserved foreign hook')
    .option('--verbose', 'show step-by-step detail output instead of the result summary')
    .option('--json', 'emit the report as JSON')
    .addHelpText(
      'after',
      '\nRuns four setup steps in sequence — hooks install, index --rebuild, claude hook install, ' +
        'then doctor --fix as a final check — and reports each one\'s own outcome rather than a single ' +
        'pass/fail. A step this command could not complete is named, never absorbed into a success message ' +
        '(see #63, #67). Safe to run more than once: every step it calls is independently idempotent, so ' +
        're-running with nothing else changed changes nothing else.' +
        '\n\n`doctor`, `hooks install`, `index --rebuild`, and `commitlore inject install-claude-hook` ' +
        'still exist on their own for anyone who wants one piece rather than all four.' +
        '\n\nExit codes: 0 all four steps ran clean, 1 the final doctor check found something init could not ' +
        'fix itself (an actionable warning or failure — read the detail above), 2 hooks install, index rebuild, or claude ' +
        'hook install could not run at all (SPEC §10).',
    )
    .action((options: { force?: boolean; json?: boolean; verbose?: boolean }) => {
      const report = runInit(options.force === undefined ? {} : { force: options.force });
      let output: string;
      if (options.json === true) {
        output = `${JSON.stringify(report, null, 2)}\n`;
      } else if (options.verbose === true) {
        output = formatInitReportVerbose(report);
      } else {
        output = formatInitReport(report);
      }
      process.stdout.write(output);
      process.exitCode = report.exitCode;
    });
};
