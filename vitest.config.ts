import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // `better-sqlite3` is a native addon, and loading it inside a worker thread
    // kills the worker on Linux. The run still reported every other file green
    // while the two index files were silently absent from the results, which is
    // the worst shape a test failure can take. Forked processes are the
    // supported way to use native addons under vitest; the cost is startup time.
    pool: 'forks',
    // The developer's git config is not an input. Without this, a test that
    // forgets to set an identity in its temporary repository passes on any
    // machine that has a global one and fails on a clean CI runner with
    // "Author identity unknown" -- which is how it was found. Pointing at a
    // path that does not exist makes git read an empty config.
    env: {
      GIT_CONFIG_GLOBAL: '/nonexistent/commitlore-tests-must-not-read-this',
      GIT_CONFIG_SYSTEM: '/nonexistent/commitlore-tests-must-not-read-this',
    },
  },
});
