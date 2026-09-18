/** The live-process identity check for MCP servers (#F-001). */
import { runtimeIdentity } from '../../../core/runtime-identity.js';
import { check } from '../model.js';
/**
 * None of the `warn` rows below claims attention, and the reason is the one this
 * file already gives for refusing to `fail`: what it observes is the machine,
 * not this repository. A server another session left running, from an install
 * that may since have been deleted, is not something a checkout can act on --
 * which is the same test the two existing `needsAttention` overrides use (#192,
 * #221: "neither is something the user can act on here").
 *
 * It matters beyond `doctor`, which exits 0 for a `warn` anyway. `init` is
 * stricter on purpose and treats any check needing attention as a step that did
 * not complete, so without this a repository-scoped command reports failure
 * because of an unrelated process on the developer's machine -- and it did:
 * six cases in `test/init.test.ts` failed for every developer with an editor
 * session open, and passed on CI runners, which is a suite that stops carrying
 * information (#750).
 */
const identityOf = (runtime) => `${runtime.entrypointRealpath} (root ${runtime.packageRoot})`;
/**
 * Group the scan by identity, keeping every pid rather than the first (#885).
 *
 * The scan already knows each process id and this row used to drop all of them
 * on the way to a deduplicated identity string. That left an operator told three
 * runtimes were answering and given nothing to act on — the reporter had to run
 * `ps` themselves to find the five processes behind those three names.
 */
const pidsByIdentity = (runtimes) => {
    const grouped = new Map();
    for (const runtime of runtimes) {
        const key = identityOf(runtime);
        const pids = grouped.get(key);
        if (pids === undefined)
            grouped.set(key, [runtime.pid]);
        else
            pids.push(runtime.pid);
    }
    return grouped;
};
const withPids = (identity, pids) => `${identity} pid ${pids.join(', ')}`;
/**
 * The live runtimes that are not the build running this check.
 *
 * The note below says never to compare versions here, and it is right about the
 * inference it refuses: equal versions do not make two runtimes the same install
 * -- #660 found four at once, three of them reporting `0.8.0` -- so a version can
 * never say which of several is the current one, and `identityOf` stays the
 * discriminator. The opposite direction carries no such doubt. A runtime whose
 * own manifest reads a different version than the CLI reading it is a different
 * build, and saying so is the only claim made here: nothing below calls a
 * matching version current.
 *
 * An absent version is not a mismatch. A runtime whose `package.json` could not
 * be read did not say what it is, and an unread file is not evidence of
 * staleness. The test is `typeof === 'string'` rather than `!== null` because
 * the two absences must behave alike: `test/` is outside `tsconfig`'s `include`,
 * so a fixture that omits the field yields `undefined`, and `undefined !== null`
 * would make the missing value read as a version that differs from every other.
 */
const differingFrom = (installed, runtimes) => runtimes.filter((runtime) => typeof runtime.reportedVersion === 'string' && runtime.reportedVersion !== installed);
const versionsWithPids = (runtimes) => runtimes.map((runtime) => `${runtime.reportedVersion} pid ${runtime.pid}`).join(', ');
const missingAssets = (runtime) => [
    ...(runtime.bundlePresent ? [] : ['dist/commitlore.mjs']),
    ...(runtime.specPresent ? [] : ['spec/SPEC.md']),
];
/**
 * A registration records an intended launch; only the process list identifies
 * which already-running server owns a client's current session. Identity is the
 * path, never the version: a copied or stale install can legitimately report the
 * same one, so a version cannot say which of several runtimes is current. It can
 * say that one of them is not this build, which is a different claim and the only
 * one `differingFrom` makes.
 */
export const checkMcpRuntimeIdentity = (ctx) => {
    const id = 'mcp-runtime-identity';
    const title = 'live MCP runtime identity';
    const category = 'delivery';
    const scan = ctx.liveMcpRuntimes();
    if (!scan.available) {
        return check(id, category, title, 'warn', `could not enumerate live CommitLore MCP runtimes: ${scan.detail}`, null, false, 
        // Machine state, not this repository's -- see the note above.
        false, { evidence: { discovery: 'unavailable', detail: scan.detail } });
    }
    const unusable = scan.runtimes.filter((runtime) => missingAssets(runtime).length > 0);
    if (unusable.length > 0) {
        const detail = unusable
            .map((runtime) => `${runtime.packageRoot} is missing ${missingAssets(runtime).join(' and ')}`)
            .join('; ');
        // `warn`, not `fail`. What this observes is the machine, not this
        // repository: a server left running by another session, from an install
        // that has since been deleted, is not something the checkout can fix and
        // must not decide its exit code. Making it fail also made this suite's
        // result depend on what happened to be running while it ran, which is the
        // defect class this check exists to surface.
        return check(id, category, title, 'warn', `${unusable.length} live CommitLore MCP runtime(s) are unusable: ${detail}`, null, false, 
        // Machine state, not this repository's -- see the note above.
        false, {
            evidence: {
                discovery: scan.detail,
                runtime_count: String(scan.runtimes.length),
                unusable_roots: unusable.map((runtime) => runtime.packageRoot).join(', '),
            },
        });
    }
    const installed = runtimeIdentity().version;
    const differing = differingFrom(installed, scan.runtimes);
    const identities = [...new Map(scan.runtimes.map((runtime) => [identityOf(runtime), runtime])).values()];
    if (identities.length > 1) {
        const grouped = pidsByIdentity(scan.runtimes);
        const allPids = scan.runtimes.map((runtime) => runtime.pid);
        return check(id, category, title, 'warn', `${identities.length} distinct live CommitLore runtimes are answering MCP — runtime mismatch: ` +
            identities
                .map((runtime) => withPids(identityOf(runtime), grouped.get(identityOf(runtime)) ?? []))
                .join('; ') +
            // #885: the row named versions and stopped, so an operator could not tell
            // whether it was cosmetic. These runtimes write. Each answers with the
            // build it started on, so records committed in one repository on one day
            // can come from more than one of them, and nothing on the commit says
            // which. Deliberately does not name one of them as the stale one:
            // r-liveruntime660 ruled that out, because a copied or stale install can
            // report the same version as a current one.
            '. Each keeps writing records with the build it started on, so this' +
            ' repository can receive records from more than one of them' +
            // Which of them is behind, not which is "the stale one" -- see
            // `differingFrom`. The row named five runtimes on the day this was
            // written and none of their versions, so an operator reading it could
            // not tell that four of them were answering from 1.3.x.
            // "processes", not "of them": the count above is distinct identities and
            // this one is live processes, and on the machine that prompted it both
            // happened to read 5 while meaning different things.
            (differing.length === 0
                ? ''
                : `. ${String(differing.length)} process(es) report a version other than the ${installed} running` +
                    ` this check: ${versionsWithPids(differing)}`), 'reconnect the commitlore MCP server in the hosts that own these pids — that respawns it through ' +
            'the wrapper the installer rewrote, and keeps the session (in Claude Code, /mcp). Restarting the ' +
            'session does the same thing more expensively' +
            ` (${allPids.join(', ')}) — a host resolves the launcher once at session start and holds` +
            ' that runtime until the session ends, so an upgrade does not reach a session already running', false, 
        // Machine state, not this repository's -- see the note above.
        false, {
            evidence: {
                discovery: scan.detail,
                runtime_count: String(scan.runtimes.length),
                distinct_identities: String(identities.length),
                package_roots: identities.map((runtime) => runtime.packageRoot).join(', '),
                pids: allPids.join(', '),
                installed_version: installed,
                differing_versions: differing.length === 0 ? 'none' : versionsWithPids(differing),
            },
        });
    }
    if (identities.length === 0) {
        return check(id, category, title, 'ok', 'no live CommitLore MCP runtime was found', null, false, undefined, {
            evidence: {
                discovery: scan.detail,
                runtime_count: '0',
                distinct_identities: '0',
                installed_version: installed,
            },
        });
    }
    /*
     * One runtime is not the same as a current one.
     *
     * This row grouped by path, so a lone runtime had nothing to disagree with and
     * came back `ok` whatever build it was serving. The branch above caught a stale
     * one only where two of them sat at different paths -- an accident of having
     * several. The ordinary case is one: you upgrade the CLI, the session you left
     * open keeps answering from the build it started on, and every record it writes
     * is written by that build's rules while doctor reports no finding.
     *
     * Measured on the machine this was written on: five live runtimes, four of them
     * on 1.3.x against an installed 1.5.0, and the only reason anything fired was
     * that there were five. `reportedVersion` had been on the scan since #660 and
     * no check read it.
     *
     * `runtime-identity` does compare versions, but against
     * `latestLifecycleIdentity` -- the last server to log a start in this
     * repository, which need not be alive. That day it reported "all observed
     * runtimes match CLI: v1.5.0" about a process that had already exited. One row
     * had liveness without a version and the other a version without liveness.
     */
    const only = identities[0];
    const behind = differing[0];
    if (behind !== undefined) {
        return check(id, category, title, 'warn', `the live CommitLore MCP runtime reports ${behind.reportedVersion} and the CLI running this check is ` +
            `${installed} — it answers, and writes records, as ${behind.reportedVersion} did`, 'reconnect the commitlore MCP server in the host that owns this pid — in Claude Code, /mcp, which is ' +
            'cheaper than restarting the session; a host resolves the launcher once at session start and holds ' +
            'that runtime until the session ends, so installing a newer CLI never reaches it ' +
            // Every pid, not the first: one identity can be several processes, which
            // is what #885 fixed in the branch above and is just as true here.
            `(pid ${differing.map((runtime) => runtime.pid).join(', ')})`, false, 
        // Machine state, not this repository's -- see the note at the top.
        false, {
            evidence: {
                discovery: scan.detail,
                runtime_count: String(scan.runtimes.length),
                distinct_identities: '1',
                live_version: behind.reportedVersion ?? 'unreported',
                installed_version: installed,
                pids: differing.map((runtime) => runtime.pid).join(', '),
            },
        });
    }
    return check(id, category, title, 'ok', `one live CommitLore MCP runtime is answering from ${identityOf(only)}` +
        // An `ok` that does not say what it read is the shape this row just had.
        // A matching version is not proof the build is current -- #660 again -- so
        // this says what was observed and claims nothing beyond it.
        // `typeof`, not `=== null`: an absent field and a null one are the same
        // absence, and the first draft told a runtime that reported nothing that
        // it was reporting the installed version.
        (typeof only.reportedVersion === 'string'
            ? `, reporting the ${installed} this check is running`
            : ', and it did not report a version, so this says nothing about which build it is'), null, false, undefined, {
        evidence: {
            discovery: scan.detail,
            runtime_count: String(scan.runtimes.length),
            distinct_identities: '1',
            live_version: only.reportedVersion ?? 'unreported',
            installed_version: installed,
        },
    });
};
//# sourceMappingURL=delivery-mcp-runtime-identity.js.map