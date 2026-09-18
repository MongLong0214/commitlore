/**
 * The pull-request issue-link gate.
 *
 * Every rule here exists because the shape it refuses has shipped in this
 * repository: a keyword bound to one issue while a second sat beside it looking
 * handled, a closing keyword on a branch it cannot fire from, a sentence that
 * says the opposite of what the parser does. Prose and parser disagreeing is
 * the whole subject, so the tests are written in pairs — the shape that fails
 * and the nearest shape that must not, because a rule with no passing
 * neighbour is indistinguishable from a rule that always fires.
 *
 * The API lookup is injected. A test that asked GitHub what `#4` is would be
 * testing GitHub.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  closingLinks,
  declaredNoIssue,
  issueLinkProblems,
} from '../scripts/check-issue-links.mjs';

interface LookupAnswer {
  kind: 'issue' | 'pull' | 'missing';
  state: 'open' | 'closed';
}

const pull = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  pull_request: {
    body: '',
    user: { login: 'a-person', type: 'User' },
    head: { ref: 'feature' },
    base: { ref: 'main', repo: { default_branch: 'main', full_name: 'o/r' } },
    ...over,
  },
});

const withBody = (body: string, over: Record<string, unknown> = {}): Record<string, unknown> =>
  pull({ body, ...over });

const openIssue: LookupAnswer = { kind: 'issue', state: 'open' };
const lookupAll = (answer: LookupAnswer) => (): LookupAnswer => answer;

const joined = (problems: string[]): string => problems.join('\n');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('a closing keyword binds exactly one issue', () => {
  it('refuses a list, and names the number that only looks linked', () => {
    const problems = issueLinkProblems(withBody('Closes #12, #13'), lookupAll(openIssue));
    expect(problems).toHaveLength(1);
    expect(joined(problems)).toContain('#13 reads as linked and is not');
  });

  it.each(['Closes #12 and #13', 'Fixes #12 & #13', 'resolves #12 #13'])(
    'refuses "%s" too — the separator is not what makes it wrong',
    (body) => {
      expect(issueLinkProblems(withBody(body), lookupAll(openIssue)).length).toBeGreaterThan(0);
    },
  );

  it('accepts one keyword per issue, which is the form that works', () => {
    const problems = issueLinkProblems(
      withBody('Closes #12\nCloses #13'),
      lookupAll(openIssue),
    );
    expect(problems).toEqual([]);
    expect(closingLinks('Closes #12\nCloses #13')).toHaveLength(2);
  });
});

describe('a closing keyword fires only on the default branch', () => {
  it('refuses one aimed at a non-default base, because merging will not close it', () => {
    const problems = issueLinkProblems(
      withBody('Closes #12', { base: { ref: 'dev', repo: { default_branch: 'main', full_name: 'o/r' } } }),
      lookupAll(openIssue),
    );
    expect(joined(problems)).toContain('closing keywords fire only on the');
    expect(joined(problems)).toContain('"dev"');
  });

  it('accepts the same body on a pull request into the default branch', () => {
    expect(issueLinkProblems(withBody('Closes #12'), lookupAll(openIssue))).toEqual([]);
  });
});

describe('GitHub reads the keyword, not the sentence', () => {
  it.each([
    'This does not close #12, it only narrows it.',
    "It doesn't fix #12.",
    'Refactor only — this never resolves #12.',
    'Narrows the scope rather than closes #12.',
  ])('refuses a negated keyword: %s', (body) => {
    const problems = issueLinkProblems(withBody(body), lookupAll(openIssue));
    expect(joined(problems)).toContain('reads the keyword rather than the');
  });

  it('accepts the form that means the same thing and does not close', () => {
    // `Refs` is not a closing keyword, so there is no link to grade — and the
    // body says something, so the no-link rule is satisfied too.
    const problems = issueLinkProblems(
      withBody('This narrows #12 without closing it.\n\nNo-Issue: narrows an existing issue, closes none'),
      lookupAll(openIssue),
    );
    expect(problems).toEqual([]);
  });

  it('does not see a negation belonging to an earlier sentence', () => {
    // The window is one clause. A paragraph-wide search would fire on this,
    // which is the false positive that would teach people to ignore the gate.
    const body = 'The old behaviour did not apply the record.\n\nCloses #12';
    expect(issueLinkProblems(withBody(body), lookupAll(openIssue))).toEqual([]);
  });
});

describe('what the number turns out to be', () => {
  it('refuses a keyword aimed at a pull request', () => {
    const problems = issueLinkProblems(withBody('Closes #12'), () => ({ kind: 'pull', state: 'open' }));
    expect(joined(problems)).toContain('is a pull request');
  });

  it('refuses a keyword aimed at something that does not exist', () => {
    const problems = issueLinkProblems(withBody('Closes #12'), () => ({ kind: 'missing', state: 'closed' }));
    expect(joined(problems)).toContain('does not exist');
  });

  it('refuses a keyword aimed at an issue already closed', () => {
    const problems = issueLinkProblems(withBody('Closes #12'), () => ({ kind: 'issue', state: 'closed' }));
    expect(joined(problems)).toContain('already closed');
  });

  it('a lookup that could not answer is "not checked", never "fine"', () => {
    // The control that matters: passing null must not turn a real defect green.
    const bad = withBody('Closes #12, #13');
    expect(issueLinkProblems(bad, null).length).toBeGreaterThan(0);
    // And a sound link with no lookup passes the rules that do not need one.
    expect(issueLinkProblems(withBody('Closes #12'), null)).toEqual([]);
  });
});

describe('an absent link is allowed, and silence is not', () => {
  it('refuses a body with neither a link nor a statement', () => {
    const problems = issueLinkProblems(withBody('Tidy up the installer output.'), null);
    expect(joined(problems)).toContain('no issue link and no "No-Issue:" line');
  });

  it('accepts a stated absence', () => {
    expect(
      issueLinkProblems(withBody('Tidy up.\n\nNo-Issue: found while releasing, nobody filed it'), null),
    ).toEqual([]);
  });

  it('refuses a marker with no reason in it', () => {
    const problems = issueLinkProblems(withBody('Tidy up.\n\nNo-Issue: n/a'), null);
    expect(joined(problems)).toContain('carries no reason');
    for (const marker of ['n/a', 'N/A.', 'none', 'TBD', '-', 'not applicable']) {
      expect(declaredNoIssue(`No-Issue: ${marker}`), marker).toBe('');
    }
    // The control: a short but real reason is not a placeholder. A word count
    // was tried here and refused this one.
    expect(declaredNoIssue('No-Issue: documentation only')).toBe('documentation only');
  });
});

describe('what the gate must not read', () => {
  it('ignores a keyword inside a fenced block, because GitHub does not link it', () => {
    const body = ['Explaining the form:', '', '```', 'Closes #12, #13', '```', '', 'No-Issue: documentation only'].join('\n');
    expect(closingLinks(body)).toEqual([]);
    expect(issueLinkProblems(withBody(body), null)).toEqual([]);
  });

  it('ignores one inside inline code for the same reason', () => {
    const body = 'Write `Closes #12` on its own line.\n\nNo-Issue: documentation only';
    expect(closingLinks(body)).toEqual([]);
  });

  it('still reads one inside a quote, because GitHub links those', () => {
    expect(closingLinks('> Closes #12')).toHaveLength(1);
  });
});

describe('who is exempt, and why', () => {
  it('a bot author is exempt — it did not write the link', () => {
    expect(
      issueLinkProblems(withBody('', { user: { login: 'dependabot[bot]', type: 'Bot' } }), null),
    ).toEqual([]);
  });

  it('the canonical rebuild is exempt — its source pull request carries the link', () => {
    expect(
      issueLinkProblems(withBody('', { head: { ref: 'canonical/pr-1057' } }), null),
    ).toEqual([]);
  });

  it('an ordinary branch with a similar name is not exempt', () => {
    // The control: the exemption is the canonical prefix, not "contains
    // canonical", so a human branch cannot opt itself out by naming.
    const problems = issueLinkProblems(withBody('', { head: { ref: 'fix/canonical-notes' } }), null);
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('the payload itself', () => {
  it('a payload with no pull_request is a problem, not a pass', () => {
    expect(issueLinkProblems({}, null)).toEqual(['event payload carries no pull_request']);
  });
});

/**
 * The exit codes are the contract CI reads, and the one that matters is the
 * separation between 1 and 2. Exit 1 says "this pull request's link is wrong"
 * and sends somebody to the body; exit 2 says "this was called wrongly" and
 * sends them to the command line. An unreadable payload used to produce 1,
 * which pointed at the wrong thing.
 */
describe('exit codes', () => {
  const SCRIPT = fileURLToPath(new URL('../scripts/check-issue-links.mjs', import.meta.url));
  const run = (args: string[]): number => {
    const result = spawnSync(process.execPath, [SCRIPT, ...args, '--offline'], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_EVENT_PATH: '' },
    });
    return result.status ?? -1;
  };
  const payloadFile = (body: string, over: Record<string, unknown> = {}): string => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-issue-links-'));
    scratch.push(dir);
    const path = join(dir, 'event.json');
    writeFileSync(path, JSON.stringify(withBody(body, over)));
    return path;
  };

  it('0 when the link is sound', () => {
    expect(run(['--from-file', payloadFile('Closes #12')])).toBe(0);
  });

  it('1 when the link is wrong', () => {
    expect(run(['--from-file', payloadFile('Closes #12, #13')])).toBe(1);
  });

  it('2 for every way the payload could not be read, never 1', () => {
    expect(run(['--from-file', '/definitely/not/here.json'])).toBe(2);
    expect(run(['--from-file', payloadFile('').replace('event.json', 'event.json') + '.missing'])).toBe(2);
    expect(run([])).toBe(2);
  });

  it('2 when a malformed file is handed in, because that is a call and not a link', () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-issue-links-bad-'));
    scratch.push(dir);
    const path = join(dir, 'event.json');
    writeFileSync(path, 'not json at all');
    expect(run(['--from-file', path])).toBe(2);
  });
});
