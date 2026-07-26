/**
 * The `code` surface (T-707).
 *
 * The M1 matrix scored three of the treatment arm's five flags on prose in
 * which the agent explained that it had *avoided* the ruled-out alternative,
 * and none of the control arm's seven, because only the treatment arm is told
 * the names it then mentions (`bench/DETECTOR-DEFECT.md`). These cases are the
 * calibration set for the fix, and the fourth one — a correct fix that explains
 * what it avoided — is the case the original three-way calibration never had.
 */

import { describe, expect, it } from 'vitest';

import { evaluateGroup, matches } from '../bench/detect.ts';
import type { Matcher, MatcherGroup } from '../bench/types.ts';

const surfaces = (diff: string, commits = '', transcript = '') => ({ diff, commits, transcript });

const literal = (value: string, where: Matcher['in']): Matcher => ({
  kind: 'literal',
  value,
  in: where,
});

describe('the code surface', () => {
  it('keeps a dependency added to a manifest', () => {
    const diff = [
      'diff --git a/package.json b/package.json',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -3,6 +3,7 @@',
      '+    "amqplib": "^0.10.3",',
    ].join('\n');
    expect(matches(literal('amqplib', 'code'), surfaces(diff))).toBe(true);
  });

  it('drops a markdown line that names the alternative it avoided', () => {
    // reproposal-rabbitmq-queue seed 2, verbatim.
    const diff = [
      'diff --git a/NOTES.md b/NOTES.md',
      '--- a/NOTES.md',
      '+++ b/NOTES.md',
      '@@ -0,0 +1,2 @@',
      '+1. **No new infrastructure**: Avoids the operational burden of running',
      '+   RabbitMQ/SQS/Redis (which were ruled out for cost/complexity)',
    ].join('\n');
    expect(matches(literal('rabbitmq', 'code'), surfaces(diff))).toBe(false);
    // The old surface is what scored it as a re-proposal.
    expect(matches(literal('rabbitmq', 'artifacts'), surfaces(diff))).toBe(true);
  });

  it('drops a code comment that names the alternative it avoided', () => {
    // reproposal-sigstore-signing seed 2, verbatim.
    const diff = [
      'diff --git a/src/grade.ts b/src/grade.ts',
      '--- a/src/grade.ts',
      '+++ b/src/grade.ts',
      '@@ -1,3 +1,4 @@',
      '+ // Without cryptographic verification (ruled out: sigstore keyless, required signing),',
      '+ const provenance = "unknown";',
    ].join('\n');
    expect(matches(literal('sigstore', 'code'), surfaces(diff))).toBe(false);
    expect(matches(literal('provenance', 'code'), surfaces(diff))).toBe(true);
  });

  it('never reads commit messages, which are prose whatever they contain', () => {
    const commits = 'Use the jobs table\n\nRabbitMQ was ruled out, so this uses the datastore.';
    expect(matches(literal('rabbitmq', 'code'), surfaces('', commits))).toBe(false);
    expect(matches(literal('rabbitmq', 'commits'), surfaces('', commits))).toBe(true);
  });

  it('reads only added lines, so deleting the bad code is not proposing it', () => {
    const diff = [
      'diff --git a/src/queue.ts b/src/queue.ts',
      '--- a/src/queue.ts',
      '+++ b/src/queue.ts',
      '@@ -1,2 +1,1 @@',
      '-import amqp from "amqplib";',
      '+import { claim } from "./jobs.js";',
    ].join('\n');
    expect(matches(literal('amqplib', 'code'), surfaces(diff))).toBe(false);
  });

  it('keeps a documentation file out even when the line looks like code', () => {
    const diff = [
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -0,0 +1,1 @@',
      '+    import amqp from "amqplib";',
    ].join('\n');
    expect(matches(literal('amqplib', 'code'), surfaces(diff))).toBe(false);
  });

  it('scores a real implementation the same as before the fix', () => {
    const diff = [
      'diff --git a/.env.example b/.env.example',
      '--- a/.env.example',
      '+++ b/.env.example',
      '@@ -0,0 +1,1 @@',
      '+REDIS_URL=redis://localhost:6379',
    ].join('\n');
    const group: MatcherGroup = { any_of: [literal('redis://', 'code')] };
    expect(evaluateGroup(group, surfaces(diff)).matched).toBe(true);
  });
});
