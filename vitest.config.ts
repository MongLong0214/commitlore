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
