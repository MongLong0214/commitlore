/**
 * The `hook-runtime` doctor check.
 *
 * It owns execution of the installed hook under Git's environment; consumers
 * receive its completed row through the registry rather than importing it.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir as tmpdirPath } from 'node:os';
import { join, resolve } from 'node:path';
import { check, gitOptions, PROBE_MESSAGE, streamEvidence } from '../model.js';
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
    try {
        writeFileSync(probe, PROBE_MESSAGE);
        const run = spawn('/bin/sh', [hook, probe], {
            shell: false,
            encoding: 'utf8',
            cwd,
            // No node, and no PATH entry that could supply one. `git` must stay
            // reachable: the hook reads its own config through it.
            env: { PATH: '/usr/bin:/bin', HOME: env['HOME'] ?? '' },
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
            const nodeMissing = run.status === 127 ||
                /\bnode\b.*not found|ENOENT|command not found.*\bnode\b/i.test(said);
            const nodeThrew = /^\s*at\s|\.js:\d+/.test(said);
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