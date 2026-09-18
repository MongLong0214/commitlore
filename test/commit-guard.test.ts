/**
 * The commit gate's decision.
 *
 * Two properties decide whether this gate is worth having, and both are
 * negative: it must not refuse a correct command, and it must not silently
 * allow an unconsidered one. A gate that fires on correct work is one people
 * learn to route around, so most of what follows is the allow side — the shapes
 * that must get through untouched.
 *
 * The world is injected and counts its own calls. That is not only convenience:
 * the claim that a Bash call which is not a commit costs nothing but a substring
 * search is a claim about how many times git is asked, and it is asserted here
 * rather than described.
 */

import { describe, expect, it } from 'vitest';

import {
  type ChangeStat,
  type GuardWorld,
  directoryChangedBefore,
  findCommit,
  guardVerdict,
  isTrivial,
  shellSegments,
} from '../src/core/commit-guard.js';
import { hookCall } from '../src/commands/commit-guard.js';

interface Spy extends GuardWorld {
  calls: number;
  seen: string[];
}

const world = (over: Partial<GuardWorld> & { stat?: Partial<ChangeStat> } = {}): Spy => {
  const stat: ChangeStat = {
    paths: ['src/a.ts', 'src/b.ts'],
    files: 2,
    lines: 40,
    binary: false,
    empty: false,
    ...over.stat,
  };
  const spy: Spy = {
    calls: 0,
    seen: [],
    isRepository: (cwd) => {
      spy.calls += 1;
      spy.seen.push(cwd);
      return true;
    },
    policyMode: () => {
      spy.calls += 1;
      return 'auto';
    },
    operationInProgress: () => {
      spy.calls += 1;
      return null;
    },
    consideration: () => {
      spy.calls += 1;
      return { covered: false, outcome: null };
    },
    changeStat: () => {
      spy.calls += 1;
      return stat;
    },
    ...over,
  };
  return spy;
};

const verdict = (command: string, over: Parameters<typeof world>[0] = {}) =>
  guardVerdict({ command, cwd: '/repo' }, world(over));

const said = (command: string, over: Parameters<typeof world>[0] = {}): string =>
  verdict(command, over).lines.join('\n');

describe('a Bash call that is not a commit costs nothing', () => {
  it.each(['ls -la', 'npm test', 'git status', 'git log --oneline -5'])(
    'allows %s without asking git anything',
    (command) => {
      const spy = world();
      const answer = guardVerdict({ command, cwd: '/repo' }, spy);
      expect(answer.decision).toBe('allow');
      expect(spy.calls).toBe(0);
    },
  );

  it('allows a command that merely says the word, and still asks nothing', () => {
    const spy = world();
    const answer = guardVerdict({ command: 'echo "commit early, commit often"', cwd: '/repo' }, spy);
    expect(answer.decision).toBe('allow');
    expect(spy.calls).toBe(0);
  });

  it('is not fooled by a subcommand that merely starts with commit', () => {
    expect(verdict('git commit-graph write').decision).toBe('allow');
  });
});

describe('an unconsidered commit is refused, and told exactly what to do', () => {
  it('refuses, naming the one call and saying that recording nothing is complete', () => {
    const answer = verdict('git commit -m "feat: x"');
    expect(answer.decision).toBe('deny');
    expect(answer.reason).toBe('not-considered');
    expect(answer.lines.join('\n')).toContain('commitlore_commit');
    expect(answer.lines.join('\n')).toContain('records: []');
  });

  it('offers the CLI too, because a session whose MCP failed to connect has no tool', () => {
    expect(said('git commit -m "feat: x"')).toContain('commitlore commit -m');
  });

  it.each([
    'git commit -m "feat: x" --no-verify',
    'git -C /repo commit -m "feat: x"',
    'cd /repo && git commit -m "feat: x"',
    '/usr/bin/git commit -m "feat: x"',
    "git commit --message='feat: x'",
  ])('refuses %s too — the spelling is not what makes it allowed', (command) => {
    expect(verdict(command).decision).toBe('deny');
  });
});

describe('a considered commit goes through', () => {
  const considered = (outcome: 'empty' | 'recorded') => ({
    consideration: () => ({ covered: true, outcome }),
  });

  it('allows one whose tree was considered and found nothing', () => {
    expect(verdict('git commit -m "chore: x"', considered('empty')).decision).toBe('allow');
  });

  it('allows one whose tree was considered and produced a record', () => {
    expect(verdict('git commit -m "feat: x"', considered('recorded')).decision).toBe('allow');
  });

  it('refuses --no-verify when a record is staged, because it would be dropped', () => {
    const answer = verdict('git commit -m "feat: x" --no-verify', considered('recorded'));
    expect(answer.decision).toBe('deny');
    expect(answer.reason).toBe('no-verify-would-drop-records');
    expect(answer.lines.join('\n')).toContain('without --no-verify');
  });

  it('allows --no-verify when nothing was recorded — there is nothing to drop', () => {
    // The control for the case above. Without it the rule could be "refuse
    // --no-verify", which is a different and worse rule.
    expect(verdict('git commit -m "chore: x" -n', considered('empty')).decision).toBe('allow');
  });

  it('refuses -a even when considered, because its tree is built at commit time', () => {
    expect(verdict('git commit -am "feat: x"', considered('empty')).decision).toBe('deny');
  });
});

describe('what the gate steps aside for', () => {
  it.each([
    ['--help', 'git commit --help'],
    ['-h', 'git commit -h'],
    ['--dry-run', 'git commit --dry-run'],
  ])('allows %s', (_label, command) => {
    expect(verdict(command).decision).toBe('allow');
  });

  it('allows anything it cannot parse, rather than guessing at shell syntax', () => {
    for (const command of [
      'git commit -m "$(cat <<\'EOF\'\nfeat: x\nEOF\n)"',
      'git commit -m `date`',
      'git commit -m "unterminated',
      'git commit -m "$(printf x)"',
    ]) {
      expect(verdict(command).decision, command).toBe('allow');
    }
  });

  it.each([
    ['not a repository', { isRepository: () => false }],
    ['policy suggest', { policyMode: () => 'suggest' as const }],
    ['policy off', { policyMode: () => 'off' as const }],
    ['no policy at all', { policyMode: () => null }],
    ['a merge in progress', { operationInProgress: () => 'merge' as const }],
    ['a sequencer operation', { operationInProgress: () => 'sequencer' as const }],
  ])('allows when %s', (_label, over) => {
    expect(verdict('git commit -m "feat: x"', over).decision).toBe('allow');
  });
});

describe('what it refuses for a reason other than consideration', () => {
  it('refuses staging and committing in one call, because the tree does not exist yet', () => {
    const answer = verdict('git add -A && git commit -m "feat: x"');
    expect(answer.decision).toBe('deny');
    expect(answer.reason).toBe('index-mutated-in-the-same-call');
    expect(answer.lines.join('\n')).toContain('Stage in one call');
  });

  it.each(['git rm -r old && git commit -m x', 'git reset --soft HEAD~1 ; git commit -m x'])(
    'refuses %s for the same reason',
    (command) => {
      expect(verdict(command).reason).toBe('index-mutated-in-the-same-call');
    },
  );

  it('allows an unrelated command in the same call', () => {
    // The control: the rule is "the index moved", not "two commands".
    expect(verdict('npm test && git commit -m x', {
      consideration: () => ({ covered: true, outcome: 'empty' as const }),
    }).decision).toBe('allow');
  });

  it('refuses a path-limited commit, which commits something other than the index', () => {
    for (const command of ['git commit -m x -- src/a.ts', 'git commit --only -m x', 'git commit --include -m x']) {
      expect(verdict(command).reason, command).toBe('pathspec-limited');
    }
  });
});

describe('the trivial rule removes a refusal and never suppresses a record', () => {
  const stat = (over: Partial<ChangeStat>): ChangeStat => ({
    paths: ['src/a.ts'],
    files: 1,
    lines: 3,
    binary: false,
    empty: false,
    ...over,
  });

  it('a one-file, three-line change is trivial', () => {
    expect(isTrivial(stat({}), 'chore: x')).toBe(true);
  });

  it('a two-file, forty-line change is not', () => {
    expect(isTrivial(stat({ paths: ['a.ts', 'b.ts'], files: 2, lines: 40 }), 'feat: x')).toBe(false);
  });

  it('documentation-only is trivial however large', () => {
    expect(isTrivial(stat({ paths: ['README.md', 'docs/a.md'], files: 2, lines: 400 }), 'docs: x')).toBe(true);
  });

  it('a binary file is never trivial, whatever its diffstat says', () => {
    expect(isTrivial(stat({ binary: true, files: 1, lines: 0 }), 'chore: x')).toBe(false);
  });

  it('an empty change is trivial — there is nothing to consider', () => {
    expect(isTrivial(stat({ empty: true, paths: [], files: 0, lines: 0 }), 'chore: x')).toBe(true);
  });

  it('fixup! and squash! are trivial because autosquash discards their messages', () => {
    const big = stat({ paths: ['a.ts', 'b.ts'], files: 2, lines: 400 });
    expect(isTrivial(big, 'fixup! feat: earlier')).toBe(true);
    expect(isTrivial(big, 'squash! feat: earlier')).toBe(true);
  });

  it('a release commit is trivial only while it touches release paths', () => {
    const releaseOnly = stat({ paths: ['package.json', 'package-lock.json', 'CHANGELOG.md'], files: 3, lines: 90 });
    expect(isTrivial(releaseOnly, 'release: 1.4.3')).toBe(true);

    const alsoSource = stat({ paths: ['package.json', 'src/a.ts'], files: 2, lines: 90 });
    expect(isTrivial(alsoSource, 'release: 1.4.3')).toBe(false);
  });

  it('a message that merely mentions a release is not a release commit', () => {
    const big = stat({ paths: ['src/a.ts'], files: 1, lines: 400 });
    expect(isTrivial(big, 'feat: prepare for release: 1.4.3')).toBe(false);
  });

  it('is reached before the consideration is asked for at all', () => {
    const spy = world({ stat: { paths: ['README.md'], files: 1, lines: 200 } });
    const answer = guardVerdict({ command: 'git commit -m "docs: x"', cwd: '/repo' }, spy);
    expect(answer.reason).toBe('trivial');
  });
});

describe('reading the command', () => {
  it('splits on every operator that separates commands', () => {
    expect(shellSegments('a && b || c ; d | e')?.map((s) => s.argv[0])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps a quoted operator inside its word', () => {
    expect(shellSegments('git commit -m "a && b"')?.at(-1)?.argv).toEqual(['git', 'commit', '-m', 'a && b']);
  });

  it('gives up on substitution rather than guessing', () => {
    expect(shellSegments('git commit -m "$(date)"')).toBeNull();
    expect(shellSegments('git commit -m `date`')).toBeNull();
    expect(shellSegments('git commit -m "x')).toBeNull();
    // Single quotes are literal in the shell, so this really is that message
    // and must not be given up on -- the control that keeps the rule from
    // degenerating into "any dollar sign is unparseable".
    expect(shellSegments("git commit -m 'costs $(five) dollars'")?.at(-1)?.argv).toEqual([
      'git',
      'commit',
      '-m',
      'costs $(five) dollars',
    ]);
  });

  it('finds the commit after git’s own options', () => {
    expect(findCommit(shellSegments('git -C /x -c a.b=c commit -m y') ?? [])?.repository).toBe('/x');
  });

  it('reads the message from every spelling it has to', () => {
    const of = (command: string): string | null => findCommit(shellSegments(command) ?? [])?.message ?? null;
    expect(of('git commit -m "fixup! x"')).toBe('fixup! x');
    expect(of('git commit --message="fixup! x"')).toBe('fixup! x');
    expect(of('git commit -mfixup! x')).toBe('fixup!');
  });

  it('follows a cd earlier in the same call, because that is another tree', () => {
    expect(directoryChangedBefore(shellSegments('cd ../other && git commit -m x') ?? [], 1)).toBe('../other');
    expect(directoryChangedBefore(shellSegments('git commit -m x') ?? [], 0)).toBeNull();
    // Anything cleverer than one argument is not followed.
    expect(directoryChangedBefore(shellSegments('cd -- ../other && git commit -m x') ?? [], 1)).toBeNull();
  });

  it('grades the commit against the directory the cd moved to', () => {
    const spy = world();
    guardVerdict({ command: 'cd /elsewhere && git commit -m "feat: x"', cwd: '/repo' }, spy);
    expect(spy.seen).toContain('/elsewhere');
    expect(spy.seen).not.toContain('/repo');
  });
});

/**
 * Reading the hook payload. Everything it does not understand is an allow, so
 * these are all about the null answer: a changed payload shape, a tool that is
 * not Bash, a call with no command. A gate has no business refusing what it
 * cannot read, and the way that goes wrong is a parser that guesses.
 */
describe('the hook payload', () => {
  const bash = (command: string, over: Record<string, unknown> = {}): string =>
    JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: '/from-payload', ...over });

  it('reads the command and the directory the host reported', () => {
    expect(hookCall(bash('git commit -m x'), '/fallback')).toEqual({
      command: 'git commit -m x',
      cwd: '/from-payload',
    });
  });

  it('falls back to the process directory when the payload names none', () => {
    expect(hookCall(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'x' } }), '/fallback')?.cwd).toBe(
      '/fallback',
    );
  });

  it.each([
    ['empty input', ''],
    ['not JSON', 'not json at all'],
    ['not an object', '"a string"'],
    ['another tool', JSON.stringify({ tool_name: 'Edit', tool_input: { command: 'git commit' } })],
    ['no tool_input', JSON.stringify({ tool_name: 'Bash' })],
    ['no command', JSON.stringify({ tool_name: 'Bash', tool_input: {} })],
    ['an empty command', JSON.stringify({ tool_name: 'Bash', tool_input: { command: '' } })],
    ['a command that is not a string', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 12 } })],
  ])('answers null for %s, which the caller treats as allow', (_label, raw) => {
    expect(hookCall(raw, '/fallback')).toBeNull();
  });
});
