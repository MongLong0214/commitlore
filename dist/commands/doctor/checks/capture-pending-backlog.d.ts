/**
 * The `pending-backlog` doctor check.
 *
 * It owns the pending-transaction diagnosis because only that subsystem can
 * distinguish an ordinary waiting capture from one that can no longer apply.
 */
import { type DoctorCheck, type DoctorContext } from '../model.js';
/**
 * #458: captures that were prepared and then never reached a commit.
 *
 * Found in the field, not in a fixture. A repository with 815 commits, hooks
 * installed and an index current with HEAD held **zero** CommitLore records —
 * and `doctor` reported all ten of its checks `ok`. Four captures sat in
 * `.git/commitlore/pending/`, one of them staged with a passing validation and
 * a record ready to attach, all four eight days old.
 *
 * The chain: `capture-stage` stamps `expires_at = staged_at + 5 minutes`; the
 * commit did not happen inside that window; `prepare-commit-msg` skipped the
 * record because it had expired; `pending-gc` protects the staged phase and so
 * never collected the file. Every step behaved as designed, and the net effect
 * was that the product silently stopped producing records.
 *
 * `pending ls` already prints `stale` and `never-collected` on exactly these
 * rows. The information existed; the command people actually run did not carry
 * it. That is #402 and #400's category — the first screen reporting ready while
 * the thing it reports on has stopped working — and it is why this check exists
 * rather than a longer TTL. The expiry is doing its job: a staged record binds
 * to the tree it was prepared for, and attaching it to a different one is worse
 * than dropping it. The defect is the silence.
 */
export declare const checkPendingBacklog: (ctx: DoctorContext) => DoctorCheck;
