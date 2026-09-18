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
export const unavailable = (reason) => ({
    status: 'unavailable',
    reason,
});
/** A sentence for a diagnostic. Distinguishes unavailable from "nothing found". */
export const describeSource = (result) => result.status === 'available'
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
//# sourceMappingURL=source.js.map