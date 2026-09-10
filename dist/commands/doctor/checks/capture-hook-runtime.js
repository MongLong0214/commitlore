/**
 * The `hook-runtime` doctor check.
 *
 * It owns execution of the installed hook under Git's environment; consumers
 * receive its completed row through the registry rather than importing it.
 */
import { accessSync, constants as fsConstants, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir as tmpdirPath } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CHAINED_HOOK_NAME } from '../../../hooks/commit-msg.js';
import { check, gitOptions, PROBE_MESSAGE, streamEvidence } from '../model.js';
/**
 * The stub runs `"$chained" "$@"` only when `[ -x "$chained" ]` holds, so a
 * preserved hook without its execute bit is inert to git and to the stub alike.
 * The same test here, so this check does not probe a file the hook will skip.
 */
const isExecutable = (path) => {
    try {
        accessSync(path, fsConstants.X_OK);
        return true;
    }
    catch {
        return false;
    }
};
/**
 * How the stub's failure reads on its first stderr line: node was never found,
 * node ran and threw, or neither. Shared between the two hooks this check runs,
 * because the preserved hook fails in the same three shapes and the
 * classification is about the line, not about who wrote it.
 */
const classifyFailure = (status, said) => {
    if (status === 127 || /\bnode\b.*not found|ENOENT|command not found.*\bnode\b/i.test(said))
        return 'node-missing';
    if (/^\s*at\s|\.js:\d+/.test(said))
        return 'node-threw';
    return 'unclear';
};
/**
 * Whether the installed hook actually runs, in the environment git gives it.
 *
 * Not a config read but an execution, against a probe message and a PATH that
 * carries no node. That is the environment the hook really gets — git does not
 * hand a hook the interactive shell's PATH — and it is the only way to catch the
 * failure this project has now shipped three times: a resolution branch ending
 * in a bare `node`.
 *
 * A config-only version of this check was written first and reported `ok` for a
 * hook that failed the moment it ran, because it inspected `commitlore.node`
 * while the hook was resolving through `node_modules/.bin` — a branch that had
 * no interpreter of its own. Checking the inputs to a decision is not checking
 * the decision.
 *
 * The probe message is valid, so a healthy hook exits 0. A hook that cannot find
 * a runtime exits non-zero having parsed nothing, which is indistinguishable
 * from "your message was fine" to everyone except this check.
 *
 * Two hooks run here, not one. The stub hands the message to the hook it
 * preserved at install time before it resolves commitlore, and exits with that
 * hook's code if it fails -- so the preserved hook is probed on its own first,
 * and its failure is reported as its own, with a fix aimed at it. `hooks
 * install` cannot move a finding about a file it does not write (#876).
 */
export const checkHookRuntime = (ctx) => {
    const { opts, git, spawn, env } = ctx;
    const title = 'hook runtime';
    const id = 'hook-runtime';
    const category = 'capture';
    const fix = 'commitlore hooks install';
    const cwd = opts.cwd ?? process.cwd();
    const located = git(['rev-parse', '--git-path', 'hooks/commit-msg'], gitOptions(opts));
    if (located.code !== 0) {
        return check(id, category, title, 'warn', 'not inside a git repository', fix, false, undefined, {
            evidence: {
                hook_path: 'unavailable',
                exit_code: String(located.code),
                ...streamEvidence('stderr', located.stderr),
            },
        });
    }
    const hook = resolve(cwd, located.stdout.trim());
    // The hook's absence is `checkHook`'s finding; saying it twice teaches the
    // reader to skim both.
    if (!existsSync(hook)) {
        return check(id, category, title, 'ok', 'no hook installed — nothing to run', null, false, undefined, { evidence: { hook_path: hook } });
    }
    const probe = join(tmpdirPath(), `commitlore-doctor-${String(process.pid)}.txt`);
    // No node, and no PATH entry that could supply one. `git` must stay
    // reachable: the hook reads its own config through it.
    const hookEnv = { PATH: '/usr/bin:/bin', HOME: env['HOME'] ?? '' };
    try {
        // The stub runs the hook it preserved at install time first, and that
        // hook's non-zero exit is the stub's exit, verbatim, before commitlore is
        // reached. Probed through the stub alone, the two are one process with one
        // stderr, and the row attributed a preserved hook's `node: command not
        // found` to the installed hook and prescribed `hooks install` -- which
        // reports the file unchanged, because the file it writes was never the one
        // failing (#876). So the preserved hook runs on its own first, the way the
        // stub runs it: through sh, so a script without a shebang behaves the same
        // here as it does there.
        const chained = join(dirname(hook), CHAINED_HOOK_NAME);
        if (isExecutable(chained)) {
            writeFileSync(probe, PROBE_MESSAGE);
            const preserved = spawn('/bin/sh', ['-c', '"$0" "$1"', chained, probe], {
                shell: false,
                encoding: 'utf8',
                cwd,
                env: hookEnv,
            });
            const exit = preserved.error === undefined ? preserved.status : null;
            if (preserved.error !== undefined || exit !== 0) {
                const spoke = `${preserved.stderr ?? ''}`.trim();
                const said = preserved.error?.message ?? (spoke.split('\n')[0] ?? '');
                const shape = preserved.error === undefined ? classifyFailure(exit, said) : 'unclear';
                /*
                 * #910: a preserved hook that refuses when it cannot run its own check is
                 * behaving correctly, and this row called it a broken installation and
                 * prescribed "fix or remove" -- which for a fail-closed hook means making
                 * it fail open, reopening the defect it was written to close.
                 *
                 * CommitLore cannot read intent, and parsing the hook's prose for it was
                 * ruled out: the wording is the repository's and this check is not the
                 * place to standardise it. What it can do is ask the same question twice.
                 * Under an inherited PATH the interpreter is present, so a hook that
                 * passes there and refuses here is PATH-sensitive rather than broken --
                 * the operator's own decision, reported as a fact with its consequence.
                 * A hook that fails under any PATH is broken whatever it intended, and
                 * that is still this check's finding to make.
                 *
                 * CommitLore's own hook keeps the stricter contract: it is required to
                 * work with no node on PATH, because it records its interpreter.
                 */
                writeFileSync(probe, PROBE_MESSAGE);
                const withPath = spawn('/bin/sh', ['-c', '"$0" "$1"', chained, probe], {
                    shell: false,
                    encoding: 'utf8',
                    cwd,
                    env: { ...hookEnv, PATH: env['PATH'] ?? hookEnv.PATH },
                });
                const pathSensitive = withPath.error === undefined && withPath.status === 0;
                if (pathSensitive) {
                    return check(id, category, title, 'warn', `commitlore's hook runs. The hook it preserved -- ${chained} -- accepts this message when an interpreter is on PATH and refuses when none is: ${(said || `exit ${String(exit ?? 'unavailable')}`).replace(/[.\s]+$/, '')}. A hook written to refuse rather than pass a check it could not run is doing that deliberately, and nothing here needs repairing; the consequence is that commits started where git's PATH carries no interpreter (a GUI or a daemon, not a shell) are blocked by it, with that message`, null, false, undefined, {
                        evidence: {
                            hook_path: hook,
                            chained_hook_path: chained,
                            exit_code: String(exit ?? 'unavailable'),
                            exit_code_with_path: '0',
                            ...streamEvidence('stderr', preserved.stderr ?? ''),
                        },
                    });
                }
                const because = shape === 'node-missing'
                    ? `it calls node by name and git's PATH has none: ${said}`
                    : shape === 'node-threw'
                        ? `its node process ran but threw (exit ${String(exit)}): ${said}`
                        : `it exited ${String(exit ?? 'unavailable')} under the restricted PATH: ${said || 'no output'}`;
                return check(id, category, title, 'fail', `commitlore's hook is not what failed. It runs the hook it preserved first, and that hook -- ${chained} -- stops the commit before commitlore is reached: ${because}. That file was this repository's commit-msg hook before commitlore was installed; \`hooks install\` rewrites only commitlore's own and leaves it as it is`, shape === 'node-missing'
                    ? `edit ${chained} to call node by absolute path (or remove it if it is no longer wanted)`
                    : `fix or remove ${chained}`, false, undefined, {
                    evidence: {
                        hook_path: hook,
                        chained_hook_path: chained,
                        exit_code: String(exit ?? 'unavailable'),
                        ...(preserved.error === undefined ? {} : { error: preserved.error.message }),
                        ...streamEvidence('stderr', preserved.stderr ?? ''),
                    },
                });
            }
        }
        // A commit-msg hook may rewrite the message it is given; the probe is
        // written again so the stub reads the same bytes the preserved hook did.
        writeFileSync(probe, PROBE_MESSAGE);
        const run = spawn('/bin/sh', [hook, probe], {
            shell: false,
            encoding: 'utf8',
            cwd,
            env: hookEnv,
        });
        if (run.error !== undefined) {
            return check(id, category, title, 'fail', `could not run the hook: ${run.error.message}`, fix, false, undefined, {
                evidence: {
                    hook_path: hook,
                    exit_code: String(run.status ?? 'unavailable'),
                    error: run.error.message,
                    ...streamEvidence('stderr', run.stderr),
                },
            });
        }
        if (run.status !== 0) {
            const spoke = `${run.stderr ?? ''}`.trim();
            const said = spoke.split('\n')[0] ?? '';
            // The preserved hook, if any, has already exited 0 on its own above, so
            // whatever follows is commitlore's resolution failing, not a hand-off.
            const shape = classifyFailure(run.status, said);
            const nodeMissing = shape === 'node-missing';
            const nodeThrew = shape === 'node-threw';
            // The stub says this when the recorded pair resolved and the containment
            // check refused it: present, executable, and under a tree this install
            // did not record. An upgrade produces it, because `commitlore.bin` follows
            // `<data-root>/current` while `commitlore.root` stays on the tree that
            // wrote the pin -- deliberately, so a repointed `current` cannot carry the
            // boundary with it (#746).
            //
            // Reported here instead of as `cause unclear`, which is what it fell to
            // while the answer was in the two lines underneath: this needs
            // `hooks install`, not a node on PATH, and those are different days of
            // work if the operator has to find it themselves.
            const containmentRefused = /outside the install this hook trusts/.test(spoke);
            let detail;
            if (containmentRefused) {
                // The paths are on the lines below the first, and they are the whole
                // answer -- which recorded value moved and which did not.
                const where = spoke.split('\n').slice(1, 3).map((line) => line.trim()).join('; ');
                detail = `the hook found its recorded CLI and refused it: it is outside the install this repository was wired to (${where}). An upgrade does this; re-running the fix below re-points it`;
            }
            else if (nodeMissing) {
                detail = `the hook cannot find a node interpreter on git's PATH: ${said || `exit ${String(run.status)}`}`;
            }
            else if (nodeThrew) {
                detail = `the hook's node process ran but threw (exit ${String(run.status)}): ${said}`;
            }
            else {
                detail = `the hook exited ${String(run.status)} under the restricted PATH — cause unclear: ${said || 'no output'}`;
            }
            return check(id, category, title, 'fail', detail, fix, false, undefined, {
                evidence: {
                    hook_path: hook,
                    exit_code: String(run.status),
                    ...streamEvidence('stderr', run.stderr),
                },
            });
        }
        return check(id, category, title, 'ok', 'the hook runs and validates without node on PATH', null, false, undefined, { evidence: { hook_path: hook, exit_code: '0' } });
    }
    catch (error) {
        return check(id, category, title, 'warn', `could not probe the hook: ${error instanceof Error ? error.message : String(error)}`, fix, false, undefined, {
            evidence: {
                hook_path: hook,
                exit_code: 'unavailable',
                error: error instanceof Error ? error.message : String(error),
                ...streamEvidence('stderr', ''),
            },
        });
    }
    finally {
        rmSync(probe, { force: true });
    }
};
//# sourceMappingURL=capture-hook-runtime.js.map