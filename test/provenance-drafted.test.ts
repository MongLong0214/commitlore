/**
 * ADR-0030: capture may stage a record without anyone reading it, and such a
 * record is real — its quotes were machine-checked against the transcript and
 * the diff it was drafted from. What it lacks is a person who stood behind the
 * wording, and standing behind the wording is exactly what `directive` claims.
 *
 * `Provenance: drafted` marks that, and grading caps it at `claim` — the
 * treatment `reconstructed` already gets, for the same reason.
 *
 * The cap lives in grading rather than in the capture pipeline because grading
 * is what consumer routes ask, and a rule the writer could decline to apply is
 * not a rule. So these assertions go through `gradeRecord` and through
 * `buildInjection`, not through the thing that writes the trailer.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { execGit } from '../src/core/git.js';
import { gradeRecord } from '../src/core/grade.js';
import { buildInjection } from '../src/core/inject.js';
import { PROVENANCE_PREFIXES, type Record } from '../src/core/types.js';
import { createTestRepo } from './git-fixtures.js';

const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: string[]): void => {
  const result = execGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
};

const AT = new Date('2026-08-07T00:00:00Z');
const TRUSTED = 'writer <writer@example.invalid>';

const recordWith = (provenance: string): Record => ({
  trailers: [
    { key: 'Warn', value: 'session entries must stay under 4KB' },
    { key: 'Record-Id', value: 'r-draft01' },
    { key: 'Provenance', value: provenance },
  ],
});

describe('ADR-0030 a record nobody read cannot direct an agent', () => {
  it('is part of the vocabulary', () => {
    expect(PROVENANCE_PREFIXES).toContain('drafted');
  });

  it('grades drafted as claim even for a trusted author of an active record', () => {
    const grade = gradeRecord(recordWith('drafted'), {
      at: AT,
      author: TRUSTED,
      trustedAuthors: [TRUSTED],
    });

    expect(grade.trust).toBe('claim');
    expect(grade.provenance).toBe('drafted');
    expect(grade.reason).toMatch(/without a person reading it/);
  });

  /**
   * The control. Everything about the record above is the same except the one
   * word, so if this did not come back `directive` the case above would be
   * proving nothing.
   */
  it('grades the identical record authored as directive', () => {
    const grade = gradeRecord(recordWith('authored'), {
      at: AT,
      author: TRUSTED,
      trustedAuthors: [TRUSTED],
    });

    expect(grade.trust).toBe('directive');
  });

  it('reaches the injection as a claim, not an instruction', () => {
    const dir = createTestRepo({
      path: mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-drafted-')),
    });
    scratch.push(dir);
    git(dir, ['config', 'user.email', 'writer@example.invalid']);
    git(dir, ['config', 'user.name', 'writer']);
    writeFileSync(join(dir, 'src.ts'), 'export const a = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, [
      'commit',
      '--quiet',
      '-m',
      'feat: cache sessions in process\n\n' +
        'Warn: session entries must stay under 4KB\n' +
        'Record-Id: r-draft02\n' +
        'Provenance: drafted\n',
    ]);

    const injection = buildInjection({ cwd: dir, path: 'src.ts', trustedAuthors: [TRUSTED] });
    const line = injection.text
      .split('\n')
      .find((candidate) => candidate.includes('session entries must stay under 4KB'));

    expect(line, 'the drafted record should still be delivered').toBeDefined();
    expect(line).toContain('[claim]');
    expect(line).not.toContain('[directive]');
  });

  /**
   * Additive by design: an implementation that predates the value reads it as
   * `unknown`, which also grades `claim`. An old reader is therefore safe
   * rather than wrong, and that property is why this is a `Provenance:` value
   * and not a new key.
   */
  it('an unrecognised provenance value also grades claim', () => {
    const grade = gradeRecord(recordWith('something-from-the-future'), {
      at: AT,
      author: TRUSTED,
      trustedAuthors: [TRUSTED],
    });

    expect(grade.trust).toBe('claim');
    expect(grade.provenance).toBe('unknown');
  });
});

/**
 * ADR-0030 decision 3: promotion is a **new record that `Supersedes:` the old
 * one**, never an edit, because a commit message is immutable.
 *
 * Nothing was built for this — `Supersedes:` and the lifecycle fold already
 * did it, and `drafted` was the only missing piece. That is worth a test
 * rather than a sentence: the claim "promotion works" is otherwise resting on
 * two mechanisms nobody has run together.
 */
describe('ADR-0030 promotion is a superseding record, not an edit', () => {
  it('retires the drafted record and serves the endorsement as a directive', () => {
    const dir = createTestRepo({
      path: mkdtempSync(join(realpathSync(tmpdir()), 'commitlore-promote-')),
    });
    scratch.push(dir);
    git(dir, ['config', 'user.email', 'writer@example.invalid']);
    git(dir, ['config', 'user.name', 'writer']);

    const body = 'Warn: session entries must stay under 4KB\n';
    writeFileSync(join(dir, 'src.ts'), 'export const a = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, [
      'commit',
      '--quiet',
      '-m',
      `feat: cache in process\n\n${body}Record-Id: r-promo01\nProvenance: drafted\n`,
    ]);

    const before = buildInjection({ cwd: dir, path: 'src.ts', trustedAuthors: [TRUSTED] }).text;
    expect(before).toContain('r-promo01');
    expect(before).not.toContain('[directive]  r-promo01');

    writeFileSync(join(dir, 'src.ts'), 'export const a = 2;\n');
    git(dir, ['add', '-A']);
    git(dir, [
      'commit',
      '--quiet',
      '-m',
      `feat: stand behind it\n\n${body}Supersedes: r-promo01\nRecord-Id: r-promo02\nProvenance: authored\n`,
    ]);

    const after = buildInjection({ cwd: dir, path: 'src.ts', trustedAuthors: [TRUSTED] }).text;
    const line = after
      .split('\n')
      .find((candidate) => candidate.includes('session entries must stay under 4KB'));

    expect(line).toContain('[directive]');
    expect(line).toContain('r-promo02');
    // The drafted one is retired by the fold, not left beside its endorsement.
    expect(after).not.toContain('r-promo01  ');
  });
});
