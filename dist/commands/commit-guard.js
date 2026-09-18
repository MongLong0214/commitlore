/**
 * `commitlore commit-guard --hook-input` — the gate, wired to a real repository.
 *
 * The decision lives in `core/commit-guard.ts` and is pure. This is the impure
 * half: reading the hook payload, answering git, and turning a verdict into the
 * two things a `PreToolUse` hook can say.
 *
 * **Exit 2 refuses; everything else allows.** Claude Code reads an exit-2
 * hook's stderr back to the agent and blocks the call, which is exactly the
 * shape this needs — the agent hears why and what to do instead, and the
 * developer is not prompted. Exit 1 is deliberately never produced: its stderr
 * goes to the developer rather than the agent, so a crash would become noise a
 * person has to read instead of the silence a fail-open should be.
 *
 * Every question asked of git is asked only after the command is known to
 * contain a commit, so the ordinary Bash call — which is most of them — costs a
 * substring search and no subprocess at all.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolvePolicy } from '../core/capture-policy.js';
import { considerationVerdict } from '../core/commit-consideration.js';
import { guardVerdict, } from '../core/commit-guard.js';
import { execGit } from '../core/git.js';
/** The tool this gate watches. Anything else is none of its business. */
const GUARDED_TOOL = 'Bash';
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const readStdin = () => {
    try {
        return readFileSync(0, 'utf8');
    }
    catch {
        return '';
    }
};
/**
 * The command and the directory, or null when this payload is not a Bash call
 * this gate should read.
 *
 * Null for everything it does not understand, which is an allow: a payload
 * shape that changed, a tool that is not Bash, a call with no command. The gate
 * has no business refusing what it cannot read.
 */
export const hookCall = (raw, fallbackCwd) => {
    if (raw.trim() === '')
        return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (!isPlainObject(parsed))
        return null;
    if (parsed['tool_name'] !== GUARDED_TOOL)
        return null;
    const input = parsed['tool_input'];
    if (!isPlainObject(input))
        return null;
    const command = input['command'];
    if (typeof command !== 'string' || command === '')
        return null;
    const cwd = parsed['cwd'];
    return { command, cwd: typeof cwd === 'string' && cwd !== '' ? cwd : fallbackCwd };
};
/** Counts insertions and deletions out of `--numstat`, and spots a binary file. */
const readNumstat = (numstat) => {
    const paths = [];
    let lines = 0;
    let binary = false;
    for (const row of numstat.split('\n')) {
        if (row.trim() === '')
            continue;
        const [added, removed, path] = row.split('\t');
        if (path === undefined)
            continue;
        paths.push(path);
        // git writes `-` for both counts on a binary file, which is not a diff
        // anybody can read and therefore not a change anybody can call trivial.
        if (added === '-' || removed === '-')
            binary = true;
        else
            lines += Number(added ?? 0) + Number(removed ?? 0);
    }
    return { paths, files: paths.length, lines, binary };
};
/** The real world: git, the policy file and the consideration on disk. */
export const liveWorld = () => ({
    isRepository: (cwd) => execGit(['rev-parse', '--show-toplevel'], { cwd }).code === 0,
    policyMode: (cwd) => {
        const resolution = resolvePolicy(cwd);
        // A policy that could not be read is not a policy that said `auto`.
        return resolution.ok ? resolution.policy.mode : null;
    },
    operationInProgress: (cwd) => {
        // `--git-path` rather than a join onto `.git`, so a linked worktree and a
        // relocated git directory both answer correctly. It returns a path relative
        // to cwd unless it is already absolute.
        const marker = (name) => {
            const resolved = execGit(['rev-parse', '--git-path', name], { cwd });
            if (resolved.code !== 0)
                return false;
            const reported = resolved.stdout.trim();
            return reported !== '' && existsSync(resolve(cwd, reported));
        };
        if (marker('MERGE_HEAD'))
            return 'merge';
        // A rebase, cherry-pick or revert git is driving: the message is being
        // replayed rather than composed, so there is nothing new to consider.
        for (const name of ['CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
            if (marker(name))
                return 'sequencer';
        }
        return null;
    },
    consideration: (cwd) => {
        const verdict = considerationVerdict(cwd);
        return verdict.covered
            ? { covered: true, outcome: verdict.consideration.outcome }
            : { covered: false, outcome: null };
    },
    changeStat: (cwd, all, amend) => {
        // `-a` commits the tracked working tree, not the index, so that is what has
        // to be measured; an amend with an empty index is a message-only amend.
        const args = all ? ['diff', '--numstat', 'HEAD'] : ['diff', '--cached', '--numstat'];
        const numstat = execGit(args, { cwd });
        const counted = readNumstat(numstat.code === 0 ? numstat.stdout : '');
        // Nothing to commit at all: `--allow-empty`, or an amend that only edits
        // the message. Either way there is no tree change to consider.
        return { ...counted, empty: counted.files === 0 };
    },
});
export const register = (program) => {
    program
        .command('commit-guard')
        .description('decide whether a Bash tool call may commit an unconsidered tree (for a PreToolUse hook)')
        .option('--hook-input', 'read a PreToolUse payload on stdin')
        .option('--command <command>', 'grade this command instead of reading a payload')
        .addHelpText('after', '\nExit codes: 2 refuse the tool call, with the reason on stderr for the agent; 0 allow it. ' +
        'Never 1 -- every failure of this command is an allow, because a gate that blocks on its own ' +
        'confusion is one people disable.' +
        '\n\nIt asks whether the tree was considered, never whether a record exists. `records: []` ' +
        'satisfies it exactly as completely as ten records do.')
        .action((options) => {
        const cwd = process.cwd();
        const call = options.command === undefined
            ? hookCall(options.hookInput === true ? readStdin() : '', cwd)
            : { command: options.command, cwd };
        // Nothing to grade is an allow, silently. This runs on every Bash call.
        if (call === null)
            return;
        let verdict;
        try {
            verdict = guardVerdict(call, liveWorld());
        }
        catch {
            // The gate failing is not a reason to stop somebody committing.
            return;
        }
        if (verdict.decision === 'allow')
            return;
        for (const line of verdict.lines)
            process.stderr.write(`${line}\n`);
        process.exitCode = 2;
    });
};
//# sourceMappingURL=commit-guard.js.map