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
  },
});
