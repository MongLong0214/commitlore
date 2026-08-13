/**
 * The capture hooks fail open (#543).
 *
 * `commitlore capture` now reports operational (3) and internal (4) failures
 * honestly. This wrapper is the separate decision that those codes must not
 * reach git. A hook that aborts a commit because capture broke is worse than
 * a missed record — the confusion the CLI used to produce by exiting 0.
 *
 * Do not assign `process.exitCode` here. The test in `test/hooks.test.ts`
 * reads this file and the two hook actions; changing this to refuse will fail
 * that test on purpose.
 */
export const captureHookFailOpen = (label, error) => {
    process.stderr.write(`commitlore: ${label}: ${error instanceof Error ? error.message : String(error)}\n`);
};
//# sourceMappingURL=capture-fail-open.js.map