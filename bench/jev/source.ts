/**
 * What a conversation source is, independent of which host produced it — #1049.
 *
 * One adapter exists (`source-claude.ts`). This file holds the shape it returns
 * so `discover.ts` never imports a host, and so a second adapter — deferred, not
 * required — has a contract to meet rather than a precedent to copy.
 *
 * ## The canonical string is the unit of trust
 *
 * `text` is decoded once and never re-derived. Every span offset, every line
 * locator, every quote handed to native verification and the whole `state` sent
 * to the provider all address *this* string. The alternative — quoting the raw
 * JSONL container and mapping back — is the mistake #1047 names directly: a
 * quote taken from escaped bytes does not appear in the decoded text, so native
 * verification rejects it, and a locator computed over container lines points at
 * a line the reader cannot see.
 *
 * ## Coverage is a statement about the read, not about the conversation
 *
 * A bounded window that found no decision has not established that the
 * conversation held none. `recordsOmitted`, `unknownForms` and `complete` are
 * carried so a caller can say "unassessed" where the truth is unassessed —
 * which the PRD separates from "nothing useful found" for exactly this reason.
 */

/** Why no source is available. Closed: these strings reach diagnostics. */
export type SourceUnavailable =
  /** No host session variable in the environment. The ordinary state. */
  | 'no-session'
  /** The actor is a subagent or child session, not the registered root. */
  | 'not-root-session'
  /** No descriptor for this session in this worktree. Needs a host restart. */
  | 'not-registered'
  /** A descriptor exists and names another worktree or another session. */
  | 'identity-mismatch'
  /** The descriptor's file is gone, is not a regular file, or cannot be read. */
  | 'transcript-unreadable'
  /** Read, and nothing in it decoded as visible conversation. */
  | 'no-visible-messages'
  /** The file's records are in a shape this adapter does not claim to read. */
  | 'unsupported-format'
  /** Checked again after the request and the bound region had moved. */
  | 'source-moved';

/**
 * One visible message, addressed in the canonical string.
 *
 * `start`/`end` are UTF-16 offsets, the units `String.prototype.slice` uses, and
 * are deliberately not byte offsets: the byte budgets in `client.ts` bound a
 * request and have nothing to do with addressing text. Confusing the two is how
 * a span lands mid-codepoint.
 */
export interface SourceBlock {
  /** Stable for the life of one read. Referenced by span ids in `discover.ts`. */
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly start: number;
  readonly end: number;
  /** 1-based, counted in the canonical string. */
  readonly startLine: number;
  readonly endLine: number;
  /**
   * False when this block sits at the truncated edge of the window.
   *
   * A truncated edge cannot be treated as a complete sentence, so such a block
   * is never enumerated as a candidate — its text may begin mid-word, and a
   * `Limit:` copied from it would assert a constraint nobody stated.
   */
  readonly complete: boolean;
}

export interface SourceCoverage {
  /** Container records decoded into visible messages. */
  readonly recordsInspected: number;
  /** Container records read and deliberately not treated as authored text. */
  readonly recordsOmitted: number;
  /** Records whose shape this adapter does not recognise at all. */
  readonly unknownForms: number;
  /** Bytes of the container read. */
  readonly bytesInspected: number;
  /** Total size of the container, when it can be measured. */
  readonly bytesTotal: number | null;
  /**
   * True only when the whole container was read. A bounded window is `false`,
   * and `false` means "the rest is uninspected", never "the rest was empty".
   */
  readonly complete: boolean;
}

export interface ConversationSource {
  readonly host: 'claude-code';
  readonly sessionId: string;
  /** Resolved working tree, physical. */
  readonly worktree: string;
  /** Resolved git directory for that tree. A linked worktree has its own. */
  readonly gitdir: string;
  /** The container file that was read. */
  readonly path: string;
  /** sha256 of the exact container region that produced `text`. */
  readonly digest: string;
  /**
   * The absolute byte range of the container that was read.
   *
   * Carried so the post-request recheck can re-read *that* region rather than
   * the tail. A transcript is appended to on every turn, so "the tail changed"
   * is true on almost every commit and says nothing about whether the assessed
   * text moved.
   */
  readonly windowFrom: number;
  readonly windowTo: number;
  /** Container size and mtime at read time, for the post-request recheck. */
  readonly size: number;
  readonly mtimeMs: number;
  /** The immutable canonical text. Every offset and quote addresses this. */
  readonly text: string;
  readonly blocks: readonly SourceBlock[];
  readonly coverage: SourceCoverage;
}

export type SourceResult =
  | { readonly status: 'available'; readonly source: ConversationSource }
  | { readonly status: 'unavailable'; readonly reason: SourceUnavailable };

export const unavailable = (reason: SourceUnavailable): SourceResult => ({
  status: 'unavailable',
  reason,
});

/** A sentence for a diagnostic. Distinguishes unavailable from "nothing found". */
export const describeSource = (result: SourceResult): string =>
  result.status === 'available'
    ? `available: ${String(result.source.blocks.length)} visible message(s), ` +
      `${String(result.source.coverage.recordsInspected)} record(s) read` +
      (result.source.coverage.complete ? '' : ' (bounded window; the rest is uninspected)')
    : {
        'no-session': 'unavailable: no host session in the environment',
        'not-root-session': 'unavailable: the actor is not the registered root session',
        'not-registered': 'unavailable: this session is not registered here (restart the host)',
        'identity-mismatch': 'unavailable: the descriptor names another session or worktree',
        'transcript-unreadable': 'unavailable: the registered transcript could not be read',
        'no-visible-messages': 'unavailable: nothing in the window decoded as conversation',
        'unsupported-format': 'unavailable: the transcript is in an unrecognised shape',
        'source-moved': 'unavailable: the source changed while it was being assessed',
      }[result.reason];
