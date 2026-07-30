/**
 * T-1010 (#202): Demo scenario fixture.
 *
 * Tests that `src/demo/fixture.ts` exports valid static commit-message data
 * suitable for the demo command. The fixture declares trailers only — lifecycle
 * is computed downstream by `foldLifecycle`, never authored here.
 */

import { describe, expect, it } from 'vitest';

import {
  predecessorCommitMessage,
  successorCommitMessage,
  proposalText,
  targetPath,
  expectedActiveRecordId,
  expectedSupersededRecordId,
} from '../src/demo/fixture.js';

import { parseCommitMessage } from '../src/core/trailers.js';
import { validateRecord } from '../src/core/schema.js';

describe('demo fixture', () => {
  it('fixture exports predecessor commit message, successor commit message, and proposal text', () => {
    expect(typeof predecessorCommitMessage).toBe('string');
    expect(typeof successorCommitMessage).toBe('string');
    expect(typeof proposalText).toBe('string');
    expect(predecessorCommitMessage.length).toBeGreaterThan(0);
    expect(successorCommitMessage.length).toBeGreaterThan(0);
    expect(proposalText.length).toBeGreaterThan(0);
  });

  it('predecessor and successor are each a valid CommitMessage per spec/schema when parsed', () => {
    const predecessorTrailers = parseCommitMessage(predecessorCommitMessage);
    const successorTrailers = parseCommitMessage(successorCommitMessage);

    expect(predecessorTrailers.length).toBeGreaterThan(0);
    expect(successorTrailers.length).toBeGreaterThan(0);

    const predecessorViolations = validateRecord(predecessorTrailers);
    const successorViolations = validateRecord(successorTrailers);

    expect(predecessorViolations).toEqual([]);
    expect(successorViolations).toEqual([]);
  });

  it("successor's trailer block declares Supersedes with the predecessor's Record-Id", () => {
    const successorTrailers = parseCommitMessage(successorCommitMessage);
    const supersedesTrailer = successorTrailers.find((t) => t.key === 'Supersedes');

    expect(supersedesTrailer).toBeDefined();
    expect(supersedesTrailer!.value).toBe(expectedSupersededRecordId);
  });

  it('Record ids match the exported expectations', () => {
    const predecessorTrailers = parseCommitMessage(predecessorCommitMessage);
    const successorTrailers = parseCommitMessage(successorCommitMessage);

    const predecessorRecordId = predecessorTrailers.find((t) => t.key === 'Record-Id');
    const successorRecordId = successorTrailers.find((t) => t.key === 'Record-Id');

    expect(predecessorRecordId).toBeDefined();
    expect(predecessorRecordId!.value).toBe(expectedSupersededRecordId);

    expect(successorRecordId).toBeDefined();
    expect(successorRecordId!.value).toBe(expectedActiveRecordId);
  });

  it('proposal text is non-empty and distinct from both commit messages', () => {
    expect(proposalText).not.toBe(predecessorCommitMessage);
    expect(proposalText).not.toBe(successorCommitMessage);
    expect(proposalText.length).toBeGreaterThan(10);
  });

  it('no fixture object exposes a lifecycle property', () => {
    // The fixture exports are all strings/primitives, not objects with lifecycle.
    // This confirms the binding constraint: lifecycle is computed, not authored.
    const exports = {
      predecessorCommitMessage,
      successorCommitMessage,
      proposalText,
      targetPath,
      expectedActiveRecordId,
      expectedSupersededRecordId,
    };

    for (const [key, value] of Object.entries(exports)) {
      if (typeof value === 'object' && value !== null) {
        expect((value as Record<string, unknown>).lifecycle).toBeUndefined();
      }
      // String exports cannot have a lifecycle property by nature — that's correct.
    }
  });
});
