/**
 * The commit gate's decision: may this `git commit` proceed?
 *
 * It asks one question — **was this tree considered?** — and never "does a
 * record exist". An agent that must produce a record produces a false one, and
 * a false record is permanent; so `records: []` satisfies this gate exactly as
 * completely as ten records do. What it refuses is a commit where the capture
 * flow never ran at all, which is the state nothing could previously detect.
 *
 * Everything here is pure. Git, the filesystem and the policy arrive through
 * {@link GuardWorld}, so each rule can be exercised against a world built to
 * trigger it rather than against a repository coaxed into the right shape —
 * and so the rules can be read without reading git.
 *
 * **It fails open, always.** Every unknown is an allow: a command it cannot
 * parse, a repository it cannot read, a policy it cannot resolve. A gate that
 * blocks on its own confusion trains people to disable it, and the thing it
 * protects is worth less than committing is.
 */

import { basename } from 'node:path';

/** Why a commit was allowed or refused, in the vocabulary the reasons use. */
export type GuardReason =
  | 'no-commit-in-command'
  | 'unparseable'
  | 'help-or-dry-run'
  | 'not-a-repository'
  | 'policy-not-auto'
  | 'merge-in-progress'
  | 'sequencer-in-progress'
  | 'index-mutated-in-the-same-call'
  | 'pathspec-limited'
  | 'trivial'
  | 'considered'
  | 'no-verify-would-drop-records'
  | 'not-considered';

export interface GuardVerdict {
  decision: 'allow' | 'deny';
  reason: GuardReason;
  /** What to say to the agent. Empty when allowing — nothing is said at all. */
  lines: readonly string[];
}

const allow = (reason: GuardReason): GuardVerdict => ({ decision: 'allow', reason, lines: [] });
const deny = (reason: GuardReason, lines: readonly string[]): GuardVerdict => ({
  decision: 'deny',
  reason,
  lines,
});

// ---------------------------------------------------------------------------
// Reading the command
// ---------------------------------------------------------------------------

/** One pipeline stage: the words of a single command. */
export interface Segment {
  readonly argv: readonly string[];
}

/**
 * Splits a shell command into segments of words.
 *
 * Deliberately small, and allowed to give up. It understands single quotes,
 * double quotes, backslash escapes and the operators that separate commands;
 * it does not understand substitution, expansion, or heredocs, and returns
 * `null` the moment it meets something it cannot account for. `null` is an
 * allow at every call site, because a gate guessing at shell syntax it does not
 * implement would refuse correct commands, and one wrong refusal costs more
 * than one missed commit.
 */
export const shellSegments = (command: string): Segment[] | null => {
  // A heredoc body can contain anything, operators included. Rather than parse
  // one, give up: `git commit -m "$(cat <<'EOF' ... EOF)"` is a real shape and
  // guessing at it is how a gate starts refusing real commands.
  if (command.includes('<<')) return null;

  const segments: Segment[] = [];
  let argv: string[] = [];
  let word = '';
  let wordStarted = false;
  let quote: "'" | '"' | null = null;

  const endWord = (): void => {
    if (wordStarted) argv.push(word);
    word = '';
    wordStarted = false;
  };
  const endSegment = (): void => {
    endWord();
    if (argv.length > 0) segments.push({ argv });
    argv = [];
  };

  for (let at = 0; at < command.length; at += 1) {
    const char = command[at] as string;

    if (quote !== null) {
      if (char === '\\' && quote === '"' && at + 1 < command.length) {
        word += command[at + 1] as string;
        at += 1;
        continue;
      }
      // Double quotes do not stop substitution, and the message is read out of
      // this word to decide whether the commit is trivial -- so a substituted
      // message must not be graded as the literal text between the quotes.
      // Single quotes are literal in the shell too, and are left alone.
      if (quote === '"' && (char === '`' || (char === '$' && command[at + 1] === '('))) return null;
      if (char === quote) {
        quote = null;
        continue;
      }
      word += char;
      wordStarted = true;
      continue;
    }

    if (char === '\\') {
      if (at + 1 >= command.length) return null;
      word += command[at + 1] as string;
      wordStarted = true;
      at += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      wordStarted = true;
      continue;
    }
    // Substitution can put anything anywhere, including a whole other command.
    if (char === '$' && (command[at + 1] === '(' || command[at + 1] === '{')) return null;
    if (char === '`') return null;
    if (char === '\n' || char === ';' || char === '&' || char === '|') {
      endSegment();
      // `&&` and `||` are two characters; a lone `&` or `|` separates too.
      if (command[at + 1] === char) at += 1;
      continue;
    }
    if (char === ' ' || char === '\t') {
      endWord();
      continue;
    }
    word += char;
    wordStarted = true;
  }

  if (quote !== null) return null;
  endSegment();
  return segments;
};

/** git's own options that may precede the subcommand. */
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const GIT_GLOBAL_FLAGS = new Set(['--no-pager', '--paginate', '--no-replace-objects', '--bare', '--literal-pathspecs']);

export interface CommitInvocation {
  /** Where in the pipeline it sits, so earlier segments can be judged. */
  readonly at: number;
  /** The value of `-C`, when the command named one. */
  readonly repository: string | null;
  readonly amend: boolean;
  readonly all: boolean;
  readonly noVerify: boolean;
  readonly helpOrDryRun: boolean;
  /** A pathspec, `--only` or `--include`: what is committed is not the index. */
  readonly pathspecLimited: boolean;
  readonly allowEmpty: boolean;
  readonly message: string | null;
}

/**
 * The `git commit` in a pipeline, if there is one.
 *
 * `git` is identified by the basename of argv[0] so `/usr/bin/git` counts, and
 * the subcommand is the first word that is not one of git's own options —
 * `git -C /x commit` is a commit, and `git commit-graph write` is not.
 */
export const findCommit = (segments: readonly Segment[]): CommitInvocation | null => {
  for (const [at, segment] of segments.entries()) {
    const argv = segment.argv;
    const first = argv[0];
    if (first === undefined || basename(first) !== 'git') continue;

    let cursor = 1;
    let repository: string | null = null;
    while (cursor < argv.length) {
      const word = argv[cursor] as string;
      if (GIT_GLOBAL_WITH_VALUE.has(word)) {
        if (word === '-C') repository = argv[cursor + 1] ?? null;
        cursor += 2;
        continue;
      }
      if (GIT_GLOBAL_FLAGS.has(word) || /^--(git-dir|work-tree|namespace)=/.test(word)) {
        if (word.startsWith('--git-dir=') || word.startsWith('--work-tree=')) repository = null;
        cursor += 1;
        continue;
      }
      break;
    }

    if (argv[cursor] !== 'commit') continue;
    const rest = argv.slice(cursor + 1);
    const flag = (...names: string[]): boolean => rest.some((word) => names.includes(word));
    const messageAt = rest.findIndex((word) => word === '-m' || word === '--message');

    return {
      at,
      repository,
      amend: flag('--amend'),
      all: flag('-a', '--all') || rest.some((w) => /^-[a-zA-Z]*a[a-zA-Z]*$/.test(w) && !w.startsWith('--')),
      noVerify: flag('-n', '--no-verify'),
      helpOrDryRun: flag('-h', '--help', '--dry-run'),
      pathspecLimited: rest.includes('--') || flag('--only', '-o', '--include', '-i'),
      allowEmpty: flag('--allow-empty'),
      message:
        messageAt === -1
          ? (rest.find((word) => word.startsWith('--message='))?.slice('--message='.length) ??
            rest.find((word) => word.startsWith('-m') && word.length > 2)?.slice(2) ??
            null)
          : (rest[messageAt + 1] ?? null),
    };
  }
  return null;
};

/** Subcommands that change what is staged, so a binding made before is stale. */
const INDEX_MUTATING = new Set([
  'add',
  'rm',
  'mv',
  'reset',
  'restore',
  'stash',
  'checkout',
  'apply',
  'cherry-pick',
  'rebase',
  'switch',
]);

/**
 * The directory a `cd` earlier in the same call moved to.
 *
 * `cd ../other && git commit` is a commit in another repository, and grading it
 * against the session's directory would ask about the wrong tree — which is the
 * whole failure this feature exists to remove, reintroduced one layer up. Only
 * a single-argument `cd` counts; anything cleverer returns null and the caller
 * falls back to the session's own directory.
 */
export const directoryChangedBefore = (segments: readonly Segment[], commitAt: number): string | null => {
  let moved: string | null = null;
  for (const segment of segments.slice(0, commitAt)) {
    if (segment.argv[0] !== 'cd') continue;
    const target = segment.argv[1];
    if (target === undefined || segment.argv.length !== 2 || target.startsWith('-')) return null;
    moved = target;
  }
  return moved;
};

export const mutatesIndexBefore = (segments: readonly Segment[], commitAt: number): boolean =>
  segments.slice(0, commitAt).some((segment) => {
    const first = segment.argv[0];
    if (first === undefined || basename(first) !== 'git') return false;
    let cursor = 1;
    while (cursor < segment.argv.length) {
      const word = segment.argv[cursor] as string;
      if (GIT_GLOBAL_WITH_VALUE.has(word)) {
        cursor += 2;
        continue;
      }
      if (GIT_GLOBAL_FLAGS.has(word) || word.startsWith('--')) {
        cursor += 1;
        continue;
      }
      break;
    }
    return INDEX_MUTATING.has(segment.argv[cursor] ?? '');
  });

// ---------------------------------------------------------------------------
// The trivial rule
// ---------------------------------------------------------------------------

/**
 * What a change has to be for the gate to step aside.
 *
 * Mechanical, and it only ever *removes* a refusal — it never suppresses a
 * record. The instructions still tell an agent to record whenever it has
 * something worth recording, however small the change.
 *
 * The numbers are chosen, not measured, and are stated here rather than hidden
 * so the next person can argue with them.
 */
export const TRIVIAL_MAX_FILES = 1;
export const TRIVIAL_MAX_LINES = 5;

const TRIVIAL_SUFFIXES = ['.md', '.txt', '.lock'];
const TRIVIAL_NAMES = new Set([
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const TRIVIAL_PREFIXES = ['LICENSE', 'CHANGELOG', 'NOTICE'];

/** Paths a `release:` commit may touch and still be mechanical. */
const RELEASE_PATHS = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);

const pathIsTrivial = (path: string): boolean => {
  const name = basename(path);
  if (TRIVIAL_NAMES.has(name)) return true;
  if (TRIVIAL_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  return TRIVIAL_PREFIXES.some((prefix) => name.startsWith(prefix));
};

const releasePathIsTrivial = (path: string): boolean =>
  RELEASE_PATHS.has(basename(path)) ||
  basename(path).startsWith('CHANGELOG') ||
  path.startsWith('dist/');

/** What is about to be committed, as the guard needs to see it. */
export interface ChangeStat {
  readonly paths: readonly string[];
  readonly files: number;
  readonly lines: number;
  readonly binary: boolean;
  /** No change at all: `--allow-empty`, or a message-only amend. */
  readonly empty: boolean;
}

export const isTrivial = (stat: ChangeStat, message: string | null): boolean => {
  if (stat.empty) return true;
  if (stat.binary) return false;
  if (stat.paths.length > 0 && stat.paths.every(pathIsTrivial)) return true;
  if (stat.files <= TRIVIAL_MAX_FILES && stat.lines <= TRIVIAL_MAX_LINES) return true;
  if (message === null) return false;
  // autosquash throws these messages away, so nothing a record could attach to
  // survives the rebase that consumes them.
  if (/^(fixup|squash)! /.test(message)) return true;
  return /^release: /.test(message) && stat.paths.length > 0 && stat.paths.every(releasePathIsTrivial);
};

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/** Everything the rules need from outside, so every rule is testable without it. */
export interface GuardWorld {
  isRepository(cwd: string): boolean;
  /** Null when no policy could be resolved, which is an allow. */
  policyMode(cwd: string): 'auto' | 'suggest' | 'off' | null;
  /** A merge or a sequencer operation git is driving, not a commit somebody typed. */
  operationInProgress(cwd: string): 'merge' | 'sequencer' | null;
  consideration(cwd: string): { covered: boolean; outcome: 'empty' | 'recorded' | null };
  changeStat(cwd: string, all: boolean, amend: boolean): ChangeStat;
}

export interface GuardInput {
  readonly command: string;
  readonly cwd: string;
}

const DENIAL = (tool: string) => [
  'CommitLore: this staged tree has not been considered for decision records.',
  `Do this instead: ${tool}`,
  'records: [] is the complete answer when there is nothing worth recording — it is not a shortfall, and nothing checks that a record exists.',
];

export const MCP_INSTRUCTION = 'commitlore_commit { message: "<your message>", records: [] }';
export const CLI_INSTRUCTION = 'commitlore commit -m "<your message>"';

/**
 * Allow or refuse one Bash call.
 *
 * The order is load-bearing: the cheap textual tests come first so the common
 * case — a Bash call that is not a commit at all — costs a substring search and
 * nothing else, and the questions that touch git are asked only once a commit
 * is known to be there.
 */
export const guardVerdict = (input: GuardInput, world: GuardWorld): GuardVerdict => {
  if (!input.command.includes('commit')) return allow('no-commit-in-command');

  const segments = shellSegments(input.command);
  if (segments === null) return allow('unparseable');

  const commit = findCommit(segments);
  if (commit === null) return allow('no-commit-in-command');
  if (commit.helpOrDryRun) return allow('help-or-dry-run');

  const cwd = commit.repository ?? directoryChangedBefore(segments, commit.at) ?? input.cwd;
  if (!world.isRepository(cwd)) return allow('not-a-repository');
  if (world.policyMode(cwd) !== 'auto') return allow('policy-not-auto');

  const operation = world.operationInProgress(cwd);
  // Neither is a commit somebody composed: a merge's staged diff is the whole
  // branch, and a sequencer commit carries a message git is replaying.
  if (operation === 'merge') return allow('merge-in-progress');
  if (operation === 'sequencer') return allow('sequencer-in-progress');

  if (mutatesIndexBefore(segments, commit.at)) {
    return deny('index-mutated-in-the-same-call', [
      'CommitLore: this call stages and commits together, so the tree to consider does not exist yet when the consideration would be made.',
      'Stage in one call, then commit in the next.',
    ]);
  }

  if (commit.pathspecLimited) {
    return deny('pathspec-limited', [
      'CommitLore: a path-limited commit does not commit the index, so what was considered and what is committed are different trees.',
      'Stage exactly those paths, then commit without a pathspec.',
    ]);
  }

  const stat = world.changeStat(cwd, commit.all, commit.amend);
  if (isTrivial(stat, commit.message)) return allow('trivial');

  const considered = world.consideration(cwd);
  // `-a` builds its tree at commit time, so no binding can describe it.
  if (considered.covered && !commit.all) {
    if (commit.noVerify && considered.outcome === 'recorded') {
      return deny('no-verify-would-drop-records', [
        'CommitLore: a record is staged for this commit, and --no-verify skips the hook that applies it — the commit would land without it.',
        'Run the same command without --no-verify.',
      ]);
    }
    return allow('considered');
  }

  return deny('not-considered', [
    ...DENIAL(MCP_INSTRUCTION),
    `No commitlore_commit tool in this session? Run: ${CLI_INSTRUCTION}`,
  ]);
};
