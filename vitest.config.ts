import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Historically `better-sqlite3` was a native addon here, and loading it
    // inside a worker thread killed the worker on Linux — the run still
    // reported every other file green while the two index files were silently
    // absent from the results, the worst shape a test failure can take.
    // ADR-0012 replaced it with `node:sqlite`, which is not a `.node` addon
    // and does not carry that risk, but `pool: 'forks'` stays: it is what
    // caught the original failure, changing it is not part of that migration,
    // and the cost is only startup time.
    pool: 'forks',
    // vitest 4 runs each file through vite 8's module runner, and the per-file
    // startup that buys costs more wall clock than vitest 2's did. This suite is
    // unusually exposed to that: most of its tests spawn a real `node`, `git` or
    // installer process and then wait on it, so the default 5s covered the work
    // plus the old overhead and does not cover the work plus the new one.
    //
    // Measured on the vitest 4 upgrade, same tree, same machine:
    //
    //   default parallelism   35 failed   (12 of them "timed out in 5000ms")
    //   --maxWorkers=4         7 failed   (all 7 "timed out in 5000ms")
    //   testTimeout 20s        see below
    //
    // Every failure was the timeout; none was an assertion. Lowering parallelism
    // only moved the line, which is what a contention-shaped limit does.
    //
    // This is not a performance budget being relaxed. A timeout here exists to
    // stop a hung child process from hanging the run, and 20s still does that —
    // the tests that genuinely take longer already carry their own explicit
    // timeouts and are unaffected.
    testTimeout: 20_000,
    // The same change reaches `beforeAll`, which builds fixtures by spawning
    // git. `token-ledger`'s hook timed out at the 10s default on vitest 4 and
    // not on vitest 2.
    hookTimeout: 30_000,
    // The developer's git config is not an input. Without this, a test that
    // forgets to set an identity in its temporary repository passes on any
    // machine that has a global one and fails on a clean CI runner with
    // "Author identity unknown" -- which is how it was found. Pointing at a
    // path that does not exist makes git read an empty config.
    env: {
      GIT_CONFIG_GLOBAL: '/nonexistent/commitlore-tests-must-not-read-this',
      GIT_CONFIG_SYSTEM: '/nonexistent/commitlore-tests-must-not-read-this',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'user.useConfigOnly',
      GIT_CONFIG_VALUE_0: 'true',
    },
  },
});
