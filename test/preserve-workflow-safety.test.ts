/**
 * #723: the squash-inheritance job runs on `pull_request_target`, and that is
 * only safe because of what it does not do.
 *
 * A fork's pull request gets a read-only token on the `pull_request` event, so
 * the job built its note correctly and then could not publish it — #720's four
 * records were discarded that way and were recovered by hand. `contents: write`
 * cannot grant what the event does not carry, so the event had to change.
 *
 * `pull_request_target` is the event with the well-known hole: it runs with a
 * writable token, and checking out the fork's head under it hands an attacker
 * that token. This job never does. It checks out the base branch, builds from
 * the base tree, and fetches the fork's commits only as `refs/commitlore/pr-head`
 * to read their trailer blocks — data, not scripts.
 *
 * That distinction is currently a comment, and a comment is a request. These
 * assertions are what makes it a constraint: an edit that checks out the head
 * or runs anything from that ref fails here rather than at the next fork
 * pull request.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'demo-preserve.yml');

const source = (): string => readFileSync(WORKFLOW, 'utf8');

/** The file with comment lines removed — what the runner actually acts on. */
const directives = (): string =>
  source()
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

describe('#723 the preserve job can publish from a fork', () => {
  it('triggers on pull_request_target, which is the event that carries a writable token', () => {
    // With `pull_request` a fork's records are built and then dropped, which is
    // the defect: silent to every required check, because this job is not one.
    expect(directives()).toMatch(/^on:\s*\n\s*pull_request_target:/m);
    expect(directives(), 'the plain event cannot publish from a fork').not.toMatch(
      /^\s*pull_request:\s*$/m,
    );
  });

  it('still asks for contents: write, which the event now actually grants', () => {
    expect(directives()).toMatch(/permissions:\s*\n\s*contents:\s*write/);
  });
});

describe('#723 and it is safe only because it never runs the fork', () => {
  it('checks out the base branch, never the pull request head', () => {
    const text = directives();

    expect(text, 'the checkout must name the base branch').toMatch(
      /ref:\s*\$\{\{\s*github\.event\.pull_request\.base\.ref\s*\}\}/,
    );
    for (const forbidden of [
      'github.event.pull_request.head.sha',
      'github.event.pull_request.head.ref',
      'refs/pull/${{ github.event.pull_request.number }}/merge',
    ]) {
      expect(
        text,
        `checking out ${forbidden} under pull_request_target hands a fork the write token`,
      ).not.toContain(`ref: ${forbidden}`);
    }
  });

  it('treats the fork\'s commits as data: fetched into a ref, never checked out or run', () => {
    // Shell continuations split one command over several lines, so the check
    // is per command rather than per line -- otherwise the refspec looks like
    // a bare mention of the ref and this passes for the wrong reason.
    const commands = directives().replace(/\\\n\s*/g, ' ').split('\n');
    const mentions = commands.filter((line) => line.includes('refs/commitlore/pr-head'));

    expect(mentions.length, 'the fork ref should appear where it is fetched').toBeGreaterThan(0);
    for (const command of mentions) {
      expect(command, `${command.trim()} does more than fetch the fork ref`).toMatch(/git fetch/);
    }
  });

  it('never checks out or resets onto the fork ref', () => {
    const text = directives();
    for (const pattern of [/git\s+checkout[^\n]*pr-head/, /git\s+reset[^\n]*pr-head/, /git\s+merge[^\n]*pr-head/]) {
      expect(text, 'the fork ref must not become the working tree').not.toMatch(pattern);
    }
  });

  it('runs its build before the fork ref exists in the checkout, not from it', () => {
    // `npm ci` resolves lifecycle scripts from whatever tree is checked out.
    // With the base checked out that is this repository's own package.json;
    // it must never be a fork's.
    const text = directives();
    expect(text).toMatch(/run:\s*npm ci/);
    expect(text, 'no install or build may name the fork ref').not.toMatch(
      /npm (ci|install|run)[^\n]*pr-head/,
    );
  });
});
