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
/**
 * What `Authorization: Bearer <value>` accepts without splitting the request.
 *
 * Printable ASCII only. A newline or a carriage return is header injection; a
 * tab or a NUL is undefined behaviour across runtimes; anything non-ASCII makes
 * `fetch` throw from inside the header setter, which surfaces as an opaque
 * TypeError far from the variable that caused it. Bounded above at 512 to keep
 * a pasted file out of a header.
 */
const HEADER_SAFE = /^[\x21-\x7e]{16,512}$/;
/** Blank is absent. A variable set to spaces is a variable someone cleared. */
const present = (value) => {
    if (value === undefined)
        return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
};
const MODES = ['auto', 'on', 'off'];
const isMode = (value) => MODES.some((mode) => mode === value);
const disabled = (mode, reason) => ({
    enabled: false,
    mode,
    reason,
});
/**
 * Builds the enabled result with the key present but hidden.
 *
 * `toJSON` and the inspect symbol are defined rather than left to chance: a
 * non-enumerable property survives `JSON.stringify` being replaced, a custom
 * serializer walking `Object.getOwnPropertyNames`, or a future `structuredClone`
 * — so the two mechanisms that format objects for humans are closed explicitly
 * as well.
 */
const enabled = (mode, keySource, key) => {
    const safe = { enabled: true, mode, keySource };
    const result = { ...safe };
    Object.defineProperty(result, 'key', { value: key, enumerable: false, writable: false });
    Object.defineProperty(result, 'toJSON', {
        value: () => safe,
        enumerable: false,
    });
    Object.defineProperty(result, Symbol.for('nodejs.util.inspect.custom'), {
        value: () => ({ ...safe, key: '[redacted]' }),
        enumerable: false,
    });
    return result;
};
/**
 * The gate. Pure: the same environment always gives the same answer, and
 * nothing here touches the filesystem, the network or the clock.
 *
 * Deliberately not read: a repository `.env`, `argv`, an MCP argument or any
 * endpoint override. A key that arrives through a file the repository commits,
 * or through a command line that lands in a shell history and a process list,
 * is a key that has already leaked.
 */
export const resolveJevActivation = (env) => {
    const requested = present(env['COMMITLORE_JEV']);
    if (requested !== null && !isMode(requested)) {
        // The value is not echoed. `COMMITLORE_JEV` is not a secret, but the rule
        // that a rejected input is never displayed has exactly one exception-free
        // form, and a reason is rendered into diagnostics.
        return disabled('auto', 'invalid-mode');
    }
    const mode = requested === null ? 'auto' : requested;
    // Before any key is read, so `off` is observably a decision not to look.
    if (mode === 'off')
        return disabled(mode, 'off');
    const dedicated = present(env['COMMITLORE_JEV_API_KEY']);
    if (dedicated !== null) {
        if (!HEADER_SAFE.test(dedicated))
            return disabled(mode, 'unusable-key');
        return enabled(mode, 'COMMITLORE_JEV_API_KEY', dedicated);
    }
    // `auto` is the default state of every installation, so it accepts only the
    // variable that exists for this product. A machine with a TypeSafe key set
    // for something else has not asked for this.
    if (mode === 'auto')
        return disabled(mode, 'no-key');
    const standard = present(env['TYPESAFE_API_KEY']);
    if (standard === null)
        return disabled(mode, 'no-key');
    if (!HEADER_SAFE.test(standard))
        return disabled(mode, 'unusable-key');
    return enabled(mode, 'TYPESAFE_API_KEY', standard);
};
/** A sentence for `doctor --jev`. Never contains a key or a rejected value. */
export const describeActivation = (activation) => activation.enabled
    ? `enabled (mode ${activation.mode}, key from ${activation.keySource})`
    : {
        off: 'disabled: COMMITLORE_JEV=off',
        'no-key': 'disabled: no COMMITLORE_JEV_API_KEY (this is the default)',
        'invalid-mode': 'disabled: COMMITLORE_JEV is not one of auto, on, off',
        'unusable-key': 'disabled: the configured key cannot be sent in a header',
    }[activation.reason];
//# sourceMappingURL=activation.js.map