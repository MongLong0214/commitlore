/**
 * Whether the optional Jev producer runs at all — #1046, ADR #1045 D2.
 *
 * This is the only gate between a default installation and everything else in
 * `src/jev/`. It is pure, it reads environment variables and nothing else, and
 * it is the first thing the commit-msg dispatcher calls: without a key, or with
 * `COMMITLORE_JEV=off`, the answer arrives before any optional module is
 * imported for execution, any transcript is read, any file is written or any
 * socket is opened.
 *
 * ## Why the key is not an ordinary property
 *
 * A credential that reaches a log, a pending record or a `--json` payload is
 * permanent in a way the original environment variable is not. The enabled
 * result therefore hides its key from the three mechanisms that leak by
 * accident rather than by intent: `JSON.stringify`, object spread, and
 * `console.log`/`util.inspect`. `activation.key` still reads normally, so the
 * client is unaffected; what changes is that a caller has to *ask* for it.
 *
 * ## Why an unusable dedicated key does not fall through
 *
 * `COMMITLORE_JEV_API_KEY` names this product's account. If it is present and
 * unusable, reaching past it to `TYPESAFE_API_KEY` would silently bill and
 * expose source text to a *different* account than the one the operator
 * configured — a wrong answer that looks like a working one. Absent is
 * different from unusable, and only absent falls through.
 */
/** Requested by `COMMITLORE_JEV`. Absent and blank both mean `auto`. */
export type JevMode = 'auto' | 'on' | 'off';
/** Where an accepted key came from. Reported; never the value. */
export type JevKeySource = 'COMMITLORE_JEV_API_KEY' | 'TYPESAFE_API_KEY';
/**
 * A closed set, because a reason is rendered into diagnostics and a free-form
 * string is how a rejected value ends up being displayed.
 */
export type JevDisabledReason = 
/** `COMMITLORE_JEV=off`. Checked before any key is read. */
'off'
/** No usable key for the requested mode. The default state. */
 | 'no-key'
/** `COMMITLORE_JEV` held something that is not a mode. */
 | 'invalid-mode'
/** A key was present and cannot be put in a header. Its value is never shown. */
 | 'unusable-key';
export interface JevDisabled {
    readonly enabled: false;
    readonly mode: JevMode;
    readonly reason: JevDisabledReason;
}
export interface JevEnabled {
    readonly enabled: true;
    readonly mode: JevMode;
    readonly keySource: JevKeySource;
    /** Non-enumerable: absent from spreads, `JSON.stringify` and `util.inspect`. */
    readonly key: string;
}
export type JevActivation = JevDisabled | JevEnabled;
/**
 * The gate. Pure: the same environment always gives the same answer, and
 * nothing here touches the filesystem, the network or the clock.
 *
 * Deliberately not read: a repository `.env`, `argv`, an MCP argument or any
 * endpoint override. A key that arrives through a file the repository commits,
 * or through a command line that lands in a shell history and a process list,
 * is a key that has already leaked.
 */
export declare const resolveJevActivation: (env: Readonly<Record<string, string | undefined>>) => JevActivation;
/** A sentence for `doctor --jev`. Never contains a key or a rejected value. */
export declare const describeActivation: (activation: JevActivation) => string;
