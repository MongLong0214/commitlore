/**
 * Capture verify phase — T-1003 (#195), ADR-0021.
 *
 * Security-critical: the transcript is attacker-influenced input. Evidence is
 * verified *mechanically* against the transcript and diff that prepare hashed —
 * never trusted because the draft asserts it. A quote that does not appear in
 * the actual source is discarded with a reason.
 *
 * Non-negotiable properties:
 * - Verification failure never blocks a commit. A failed record is discarded
 *   and logged; the commit proceeds with no record.
 * - Prompt injection: nothing in the transcript may cause verify to accept a
 *   record it would otherwise reject, and no trailer content is executed or
 *   interpreted as an instruction.
 * - A record that verifies empty produces no record at all rather than an
 *   empty one.
 * - Default maximum is one record per commit.
 */
import { writeConsideration } from './commit-consideration.js';
import { createHash } from 'node:crypto';
import { verifyDraft } from './harvest-verify.js';
import { resolvePolicy } from './capture-policy.js';
const PROVENANCE_KEY = 'Provenance';
import { deletePending, isUnreadablePendingFile, readPending, storeVerification, tryLockPending, unlockPending, } from './pending.js';
import { hasShallowHistory, execGitOrThrow } from './git.js';
import { explainWithholding, scanTrailer } from './grade.js';
import { runQuery } from './query.js';
import { notesAvailability } from './notes.js';
import { findDanglingRefs } from './stale.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sha256 = (input) => createHash('sha256').update(input).digest('hex');
/** Extract Record-Id from a draft record's trailers. */
const recordIdOf = (record) => record.trailers.find((t) => t.key === 'Record-Id')?.value;
/**
 * Canonical committed content used to derive a missing identity. Evidence is
 * deliberately absent: it proves the draft, but never reaches the commit.
 * Sorting makes the identity depend on the record rather than its JSON field
 * order, and Record-Id is omitted because this is only called when it is
 * missing.
 */
const recordIdSeed = (record) => record.trailers
    .filter((trailer) => trailer.key !== 'Record-Id')
    .map((trailer) => JSON.stringify([trailer.key, trailer.value]))
    .sort()
    .join('\n');
/**
 * How much of the digest becomes the identity.
 *
 * A full sha256 is 64 characters, and this identity is not a secret — it is
 * printed on every commit and again on every injected line, where the renderer
 * pads it into a column. At 64 characters it would dominate the payload and
 * push real record content out of the injection budget, so the budget would be
 * spent on identity rather than on what was decided.
 *
 * Twelve keeps it legible beside the hand-written ids already in these
 * histories, and the birthday bound is far below where it matters — a
 * repository would need on the order of a million records before a collision
 * became likely. The probe below handles that case anyway, so shortening
 * trades no correctness for a payload that fits.
 */
const MINTED_ID_CHARS = 12;
/**
 * Mint an identity deterministically from the record that will be committed.
 * A pre-existing identity can be an extraordinarily unlikely digest collision,
 * or a deliberately claimed value, so retry with a deterministic probe rather
 * than silently reusing it. The current history makes the probe choice stable
 * for a retry while still reserving every historical identity.
 */
const mintRecordId = (record, reservedIds) => {
    const seed = recordIdSeed(record);
    let probe = 0;
    while (true) {
        const input = probe === 0 ? seed : `${seed}\n${probe}`;
        const candidate = `r-${sha256(input).slice(0, MINTED_ID_CHARS)}`;
        if (!reservedIds.has(candidate))
            return candidate;
        probe += 1;
    }
};
/**
 * Canonical identity tuple for de-duplication: lowercased key + value, no scope
 * (scope is path, handled by the query layer). Two records with the same
 * canonical tuple are duplicates regardless of Record-Id.
 */
export const captureCanonicalTuple = (trailers) => {
    const keys = trailers
        .filter((t) => t.key !== 'Record-Id' && t.key !== 'Evidence' && t.key !== 'Provenance')
        .map((t) => `${t.key.toLowerCase()}=${t.value.toLowerCase()}`)
        .sort()
        .join('|');
    return keys;
};
/** Build the result classification. */
const classifyResult = (accepted, rejected) => {
    if (accepted.length === 0)
        return 'empty';
    if (rejected.length === 0)
        return 'pass';
    return 'partial';
};
/**
 * The reference half of SPEC §6.1 — the class `validateRecord` cannot see.
 *
 * Declared set is historical identities plus the other records still in this
 * batch. That is the same set `validate --message-file` hands `findDanglingRefs`
 * (`prior` + siblings): a `Follows:` to an earlier record in this capture
 * becomes a sibling block in the commit message the hook will check, so it
 * must resolve here too. A sibling that itself fails is dropped and no longer
 * resolves anything, otherwise capture would stage a `Follows:` the hook then
 * rejects.
 *
 * Capture always has a repository by the time this runs (prepare wrote into
 * `.git/`, and a missing history already returned `incomplete`). Shallow
 * clones are left alone: the hook withdraws `dangling-ref` there rather than
 * failing a valid record at the clone boundary.
 */
const rejectDanglingRefs = (accepted, rejected, historyIds, cwd) => {
    // A copy, not the input. The caller empties `accepted` and refills it from
    // what comes back, so returning the same array leaves it refilling from
    // something it has just cleared — every record silently vanishes with no
    // rejection recorded. Shallow history withdraws the check, it does not
    // withdraw the records.
    if (hasShallowHistory(cwd))
        return [...accepted];
    const historical = [...historyIds].map((id) => ({
        trailers: [{ key: 'Record-Id', value: id }],
    }));
    let remaining = [...accepted];
    let dropped = true;
    while (dropped) {
        dropped = false;
        const next = [];
        for (const verified of remaining) {
            const siblings = remaining
                .filter((other) => other !== verified)
                .map((other) => ({ trailers: other.record.trailers }));
            const dangling = findDanglingRefs([...historical, ...siblings], [
                { trailers: verified.record.trailers },
            ]);
            if (dangling.length === 0) {
                next.push(verified);
                continue;
            }
            dropped = true;
            rejected.push({
                record: verified.record,
                reason: 'dangling-ref',
                detail: dangling
                    .map((violation) => `${violation.key}: ${JSON.stringify(violation.got)} (${violation.rule}, want ${violation.want})`)
                    .join('; '),
            });
        }
        remaining = next;
    }
    return remaining;
};
const declaredOnlyBy = (rec, commit) => (rec.shas.length > 0 ? rec.shas : [rec.sha]).every((sha) => sha === commit);
/**
 * Read the active records exactly as verification does, without touching the
 * derived index. A caller with a known read-only history can provide it through
 * `VerifyCaptureOptions.history` instead.
 */
export const loadCaptureVerificationHistory = (cwd, replacing) => {
    try {
        const recordIds = new Set();
        const activeCanonicalTuples = new Set();
        const queryResult = runQuery({ cwd, noIndex: true, allHistory: true });
        for (const rec of queryResult.records) {
            if (replacing !== undefined && declaredOnlyBy(rec, replacing))
                continue;
            const idTrailer = rec.trailers.find((t) => t.key === 'Record-Id');
            if (idTrailer)
                recordIds.add(idTrailer.value);
            if (rec.lifecycle !== 'active')
                continue;
            const tuple = rec.trailers
                .filter((t) => t.key !== 'Record-Id' &&
                t.key !== 'Evidence' &&
                t.key !== 'Provenance')
                .map((t) => `${t.key.toLowerCase()}=${t.value.toLowerCase()}`)
                .sort()
                .join('|');
            activeCanonicalTuples.add(tuple);
        }
        return {
            recordIds,
            activeCanonicalTuples,
            incomplete: queryResult.shallow || queryResult.unreadCommits > 0,
        };
    }
    catch {
        return null;
    }
};
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Verifies capture records against the transcript and diff.
 *
 * Delegates to `verifyDraft` for each record, then performs:
 * - Source hash verification (transcript/diff match what prepare stored)
 * - Duplicate Record-Id detection against every historical identity
 * - Canonical duplicate detection
 * - Reference resolution (`findDanglingRefs`) against the same declared set
 *   `validate --message-file` uses: history plus same-batch siblings
 * - Notes availability check (unfetched → incomplete)
 *
 * Never throws on a record-verification failure — returns `"empty"` instead.
 * Never blocks: an empty or incomplete result is a valid outcome, not an error.
 */
export const verifyCaptureRecords = (opts) => {
    const { nonce, cwd } = opts;
    // Hold the nonce for the whole call so a concurrent loser is refused before
    // it computes a result it cannot store. A caller that arrives after the
    // first has released acquires cleanly and is refused by the phase check in
    // `runVerifyCaptureRecords` instead — the two are indistinguishable from
    // here, which is the whole of #981. A read-only check writes nothing and
    // takes no lock.
    let createdLock = false;
    if (opts.readOnly !== true) {
        const lock = tryLockPending(nonce, cwd);
        if (!lock.held) {
            return {
                accepted: [],
                rejected: [],
                validation_result: 'empty',
                incomplete: true,
                overlap_check: 'canonical_exact_only',
            };
        }
        createdLock = lock.created;
    }
    try {
        return runVerifyCaptureRecords(opts);
    }
    finally {
        if (createdLock)
            unlockPending(nonce, cwd);
    }
};
/**
 * What a caller can do about a transaction that already holds a verification.
 *
 * Worded per phase because the answer differs and a wrong one wastes the
 * caller's next move: `pending rm` refuses `staged` and `applied`
 * (`PROTECTED_PHASES` in `src/commands/pending.ts`), since the post-commit hook
 * may still be owed them.
 */
const recoveryFor = (phase, nonce) => {
    if (phase === 'verified') {
        return (`Run \`commitlore pending rm ${nonce}\` and prepare again if you meant to replace it; ` +
            'the stored verification is otherwise still the one that will stage.');
    }
    if (phase === 'staged') {
        return 'It is already attached to the next commit; prepare a new transaction to record anything else.';
    }
    if (phase === 'applied' || phase === 'consumed') {
        return 'It has already reached a commit; prepare a new transaction to record anything else.';
    }
    return 'Prepare a new transaction to record anything else.';
};
const runVerifyCaptureRecords = (opts) => {
    const { nonce, draft, transcript, cwd } = opts;
    /*
     * Read from the index when the caller sent nothing (#1023). The stored hash
     * still decides: an index that moved since `prepare` fails the comparison
     * below and is reported as a diff mismatch, which is what it is.
     */
    const diff = opts.diff ?? execGitOrThrow(['diff', '--cached'], { cwd });
    const accepted = [];
    const rejected = [];
    /**
     * Binds the result to the transaction, and says what that binding is worth.
     *
     * `bound` is true when the result is the one the transaction now holds —
     * vacuously so for a read-only check, which has nothing to bind and therefore
     * earns no receipt. `receipt` is present only where a write actually happened,
     * so "bound" and "holds a handle" stay separable: the read-only case is the
     * one where they differ.
     */
    const persist = (result) => {
        if (opts.readOnly === true)
            return { bound: true, receipt: null };
        const receipt = storeVerificationResult(nonce, cwd, result);
        return { bound: receipt !== null, receipt };
    };
    /**
     * The only way out of this function that writes.
     *
     * Every exit used to be `persist(result); return result;` written by hand,
     * and the first repair changed one of them. The other four — transcript
     * mismatch, diff mismatch, unfetched notes, unavailable history — kept
     * discarding the refusal, so replaying a nonce through any of them returned
     * a rejection to the caller while the earlier stored result stayed staged.
     * Routing every exit through one function is what makes that impossible to
     * reintroduce by copying two lines.
     */
    const settle = (result) => {
        /*
         * A verification that accepted nothing does not bind the transaction (#1021).
         *
         * `verified` was reached by a capture whose every draft record the verifier
         * discarded -- which the contract calls a normal outcome -- and the
         * transaction then sat in `pending ls` at that phase indefinitely, marked
         * `stale` and `gc_eligible` and never collected. `pending ls` is the only
         * way a host can ask "is a capture staged for the commit about to happen",
         * and the obvious reading of `verified` is yes. A host that built that check
         * had every commit after the first empty capture read as covered.
         *
         * Leaving it `prepared` says what is true: the sources are hashed and
         * nothing has been verified against them. It also lets the same nonce be
         * verified again with a better draft, where before the transaction was
         * spent on the attempt that recorded nothing.
         *
         * This does not reopen what `settle` exists to prevent -- a refusal dropped
         * while an earlier stored result stays stageable. That hazard is about a
         * result with records in it; a transaction holding no accepted record has
         * nothing that could be staged, and `stageCaptureRecord` refuses an empty
         * or non-`verified` transaction either way.
         */
        if (result.accepted.length === 0) {
            /*
             * "Considered, nothing found" is a complete answer, and until it was
             * written down nothing downstream could tell it from "never considered".
             * A caller that submitted no records at all has said exactly that, so the
             * consideration is bound here -- the transaction still stays `prepared`,
             * which is the #1021 repair and is untouched.
             *
             * Deliberately not on a refusal. A draft whose records were all rejected
             * is not a statement that there was nothing to record, and binding it
             * would let a bad draft reach the same state as a real consideration.
             * `runCommit` makes the same distinction, and the two have to agree.
             *
             * And nothing at all when the check is read-only. `capture --shadow`
             * measures history without touching the worktree or `.git`, and its suite
             * compares `.git` byte for byte on purpose -- r-shadowsnapshotlock ruled
             * out filtering that snapshot precisely so a stray file written by the
             * command could not hide behind the filter. This was that file.
             */
            if (opts.readOnly !== true && opts.draft.length === 0 && result.rejected.length === 0) {
                writeConsideration({ cwd, outcome: 'empty', records: 0 });
            }
            return result;
        }
        const stored = persist(result);
        if (stored.bound) {
            return stored.receipt === null ? result : { ...result, receipt: stored.receipt };
        }
        // Changing only what is returned was not enough. `stage` reads the *stored*
        // transaction, so a replay whose result could not be stored left the
        // earlier record staged-able: the caller was told empty, and the commit
        // would have carried the first record. The stored transaction has to stop
        // being usable, not just stop being reported.
        //
        // Reachable only as an anomaly now. A transaction that already held a
        // result is refused above, before anything is recomputed, so the store can
        // fail here only if the transaction vanished or changed phase *while this
        // call held its lock* — which no ordinary caller can produce. Discarding is
        // the right answer to that, and the wrong answer to a second verification
        // arriving late (#981): the earlier caller was told it passed.
        // `prepare` is one call away.
        if (opts.readOnly !== true) {
            try {
                deletePending(nonce, { cwd });
            }
            catch {
                // The refusal below is the guarantee; failing to clean up must not
                // turn into a thrown error from a function that never throws.
            }
        }
        return {
            accepted: [],
            rejected: [],
            validation_result: 'empty',
            incomplete: true,
            overlap_check: 'canonical_exact_only',
        };
    };
    try {
        // 1. Re-read prepared transaction and verify source hashes
        const pending = opts.pending ?? readPending(nonce, { cwd });
        if (!pending) {
            // No transaction found. Still never throws -- the caller decides what a
            // missing transaction means -- but it says so, rather than returning the
            // shape of a verification that ran and found nothing (#1023).
            return {
                accepted: [],
                rejected: [],
                validation_result: 'empty',
                incomplete: true,
                overlap_check: 'canonical_exact_only',
                no_transaction: true,
            };
        }
        // A transaction that is no longer `prepared` already carries a result, and
        // this call cannot replace it: `storeVerification` refuses every phase but
        // `prepared` (`pending.ts`). Refuse here, before anything is recomputed,
        // and say which phase refused.
        //
        // This used to fall through, fail the store, and reach `settle`, which
        // deleted the transaction. That reading — "two verifications of one nonce
        // disagreed" — is not available from inside: once the first caller has
        // released its lock and exited, a deliberate replay and a concurrent loser
        // that arrived late are byte-identical. `settle` was therefore discarding a
        // verification whose caller had been told it passed, which is what #981
        // observed on CI and what `pending-concurrency` asserts must not happen.
        // Two real processes, run one after the other, reproduce it with no race
        // at all (#981).
        //
        // The refusal is reported rather than swallowed. Every drafted record comes
        // back rejected, naming the phase and how to get a transaction that can
        // accept one, so a caller replaying on purpose is told why instead of
        // finding its transaction gone.
        if (pending.phase !== 'prepared' && opts.readOnly !== true) {
            for (const record of draft) {
                rejected.push({
                    record,
                    reason: 'not-prepared',
                    detail: `this transaction is already ${pending.phase}: it holds a verification that this ` +
                        `call cannot replace. ${recoveryFor(pending.phase, nonce)}`,
                });
            }
            return {
                accepted: [],
                rejected,
                validation_result: 'empty',
                incomplete: true,
                overlap_check: 'canonical_exact_only',
            };
        }
        // Source hash verification: reject if the transcript or diff was substituted
        const transcriptHash = sha256(transcript);
        const diffHash = sha256(diff);
        /*
         * A substituted source ends the call without binding the transaction (#1022).
         *
         * Two things were wrong. The mismatch was reported only by rejecting each
         * draft record, so an empty draft produced an empty `rejected` and
         * `incomplete: false` -- a clean, final-looking answer for a call whose
         * sources were both wrong. And it went through `settle`, which persists the
         * result and issues a receipt, moving the transaction out of `prepared`;
         * from there `storeVerification` refuses every later call, so the nonce was
         * locked holding a verification built from sources it never matched, and the
         * recovery it named was a CLI command an agent on MCP cannot run.
         *
         * Returning without `settle` leaves the transaction `prepared`, which is
         * what it still is: nothing was verified. That does not reopen what `settle`
         * exists to prevent -- a refusal that is dropped while an earlier stored
         * result stays stageable -- because this path accepts nothing and therefore
         * has nothing that could be staged in its place.
         *
         * `rejected` is still filled per record for a caller that sent some, and
         * `source_mismatch` carries the same fact where a caller sent none.
         */
        const mismatch = (which) => {
            for (const record of draft) {
                rejected.push({
                    record,
                    reason: 'source-mismatch',
                    detail: `${which} hash does not match the prepared transaction`,
                });
            }
            return {
                accepted: [],
                rejected,
                validation_result: 'empty',
                // Nothing was verified, so nothing about this answer is complete.
                incomplete: true,
                overlap_check: 'canonical_exact_only',
                source_mismatch: which,
            };
        };
        if (pending.source_hashes.transcript !== transcriptHash)
            return mismatch('transcript');
        if (pending.source_hashes.diff !== diffHash)
            return mismatch('diff');
        // 2. Check notes availability — unfetched means incomplete
        const notes = notesAvailability({ cwd });
        if (notes === 'unfetched') {
            const result = {
                accepted: [],
                rejected: [],
                validation_result: 'empty',
                incomplete: true,
                overlap_check: 'canonical_exact_only',
            };
            return settle(result);
        }
        // 3. Load active records for duplicate checking
        const history = opts.history === undefined ? loadCaptureVerificationHistory(cwd, opts.replacing) : opts.history;
        if (history === null) {
            // If we can't read active records, we cannot be sure → incomplete
            const result = {
                accepted: [],
                rejected: [],
                validation_result: 'empty',
                incomplete: true,
                overlap_check: 'canonical_exact_only',
            };
            return settle(result);
        }
        // Do not mutate a caller-provided historical snapshot: shadow reuses one
        // across many verification calls. This local reservation set also keeps
        // identities distinct when a permissive policy permits several records.
        const reservedRecordIds = new Set(history.recordIds);
        const { activeCanonicalTuples } = history;
        // 4. Delegate to verifyDraft for evidence/grammar checking
        const verifyResult = verifyDraft(draft, { transcript, diff });
        // Process accepted records — additional checks
        for (const verified of verifyResult.accepted) {
            const id = recordIdOf(verified.record);
            // Check duplicate Record-Id
            if (id && reservedRecordIds.has(id)) {
                rejected.push({
                    record: verified.record,
                    reason: 'duplicate-record-id',
                    detail: `Record-Id "${id}" already exists in repository history`,
                });
                continue;
            }
            // Check canonical duplicate
            const tuple = captureCanonicalTuple(verified.record.trailers);
            if (tuple && activeCanonicalTuples.has(tuple)) {
                rejected.push({
                    record: verified.record,
                    reason: 'canonical-duplicate',
                    detail: 'a record with the same normalized key/value/scope already exists',
                });
                continue;
            }
            // #931. A trailer the injection scanner matches is served as `[blocked]`
            // to every reader, and a blocked record is withheld whole — siblings
            // included. Committing it produces a record nobody can read, and the
            // author learned nothing: capture said staged, the hook said `shape ok`.
            // This is the moment the wording can still change, so the record is
            // refused here with the trailer and the pattern named, the same way an
            // ungrounded `Ruled-out:` is. The same scanner grades at read time, so
            // what passes here is what will be served; a defensive record that
            // *mentions* a payload passes both.
            const matched = verified.record.trailers.flatMap((trailer) => {
                const patterns = scanTrailer(trailer);
                return patterns.length === 0 ? [] : [{ key: trailer.key, patterns }];
            });
            if (matched.length > 0) {
                rejected.push({
                    record: verified.record,
                    reason: 'injection-pattern',
                    detail: matched
                        .map((entry) => explainWithholding(entry.key, entry.patterns))
                        .join('; '),
                });
                continue;
            }
            accepted.push(verified);
            if (id)
                reservedRecordIds.add(id);
        }
        // Shape passed. The hook's next step is `validate --message-file`, which
        // also asks whether Follows:/Supersedes: resolve. A pass here that the
        // hook then refuses is the #588 split: capture told the user it worked.
        const surviving = rejectDanglingRefs(accepted, rejected, history.recordIds, cwd);
        accepted.length = 0;
        accepted.push(...surviving);
        // ADR-0030. In `auto` the host stages without asking, so nobody read this
        // record — whatever the model wrote in its `Provenance:` line. Stamping
        // `drafted` here is the only moment the pipeline knows that for certain,
        // and grading caps a drafted record at `claim`.
        //
        // `suggest` is left alone: a host in that mode may have asked, and `stage`
        // has no way to tell whether it did (ADR-0028), so overwriting would be a
        // claim this code cannot support either way.
        if (resolvePolicy(cwd).policy.mode === 'auto') {
            for (const verified of accepted) {
                const trailers = verified.record.trailers.filter((trailer) => trailer.key !== PROVENANCE_KEY);
                trailers.push({ key: PROVENANCE_KEY, value: 'drafted' });
                verified.record.trailers = trailers;
            }
        }
        // The only safe place to mint is after every evidence, vocabulary, and
        // duplicate-content check above. A rejected draft remains exactly the
        // discarded proposal it arrived as; it never consumes or reveals an id.
        // This is intentionally beside provenance stamping: both are facts the
        // unattended pipeline establishes about a record it has accepted.
        for (const verified of accepted) {
            if (recordIdOf(verified.record) !== undefined)
                continue;
            const id = mintRecordId(verified.record, reservedRecordIds);
            verified.record.trailers = [...verified.record.trailers, { key: 'Record-Id', value: id }];
            reservedRecordIds.add(id);
        }
        // Collect rejections from verifyDraft
        for (const rejectedRec of verifyResult.rejected) {
            rejected.push({
                record: rejectedRec.record,
                reason: rejectedRec.reason,
                detail: rejectedRec.detail,
            });
        }
        // 5. Build and store result
        const validationResult = classifyResult(accepted, rejected);
        const result = {
            accepted,
            rejected,
            validation_result: validationResult,
            incomplete: history.incomplete,
            overlap_check: 'canonical_exact_only',
        };
        return settle(result);
    }
    catch (error) {
        if (isUnreadablePendingFile(error))
            throw error;
        // Never throws — return empty on any unhandled error.
        //
        // `incomplete` is true because that is what it means: nothing here
        // established that the draft was checked, so an empty answer is "unknown",
        // not "nothing survived". Reporting `incomplete: false` told a caller the
        // opposite of what had happened.
        const result = {
            accepted: [],
            rejected: [],
            validation_result: 'empty',
            incomplete: true,
            overlap_check: 'canonical_exact_only',
        };
        // The one exit that does not go through `settle`, and the only one where
        // that is right: this result is already `empty` with `incomplete: true`,
        // which is exactly what `settle` would substitute if the store refused. A
        // failed store cannot change the answer, so it cannot be worth throwing for.
        try {
            persist(result);
        }
        catch {
            // Never throw from the handler that exists so nothing throws.
        }
        return result;
    }
};
/**
 * Run the ordinary verifier against an in-memory transaction without writing a
 * verification result. This is intentionally a thin wrapper, so shadow keeps
 * every source, evidence, duplicate, and policy check the live path uses.
 */
export const verifyCaptureRecordsReadOnly = (opts) => verifyCaptureRecords({ ...opts, readOnly: true });
// ---------------------------------------------------------------------------
// Internal: store verification result in pending transaction
// ---------------------------------------------------------------------------
/**
 * Binds a verification result to its transaction, and says whether it managed
 * to.
 *
 * `storeVerification` refuses any phase but `prepared`, and that refusal used
 * to be discarded here. A second verification of the same nonce then computed a
 * new draft, failed to store it, and returned it to the caller as accepted —
 * while staging went on to use the draft stored by the first call. The caller
 * was shown B and the repository committed A, with nothing anywhere reporting a
 * difference.
 */
const storeVerificationResult = (nonce, cwd, result) => {
    const evidenceHash = sha256(JSON.stringify(result.accepted.map((a) => a.record)));
    return storeVerification(nonce, {
        cwd,
        accepted: result.accepted.map((a) => a.record),
        rejected: result.rejected,
        validation_result: result.validation_result,
        overlap_check: result.overlap_check,
        incomplete: result.incomplete,
        evidence_hash: evidenceHash,
    });
};
//# sourceMappingURL=capture-verify.js.map