#!/usr/bin/env node
/**
 * The three measurements #962, #963 and #964 are each waiting on.
 *
 * Each of those issues proposes a design and says, in its own acceptance, that
 * the measurement comes first and that "not worth it, with a number" is a
 * finished item. This takes them.
 *
 *   #962  what does a second request in one long-lived MCP process repeat?
 *   #963  `validate --range`: is the cost the graph walk or the collision work?
 *   #964  what does the index store, and what does one more commit rewrite?
 *
 * The rules are `scripts/measure.mjs`'s, for the reason its header gives: four
 * numbers this project quoted and acted on were wrong, all of them taken
 * without recording what they were taken against.
 *
 *   - the index state is named, never inherited;
 *   - counts wherever a count answers it, because load cannot move a count;
 *   - the provenance is printed beside the result, so a bare number lifted out
 *     of here is visibly unsourced.
 *
 * Usage:
 *   node scripts/measure-scale.mjs --index complete
 *   node scripts/measure-scale.mjs --index cold --repo /path/to/repo
 *   node scripts/measure-scale.mjs --index complete --only 963
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');

const usage = (message) => {
  process.stderr.write(`${message}\n\nSee the header of scripts/measure-scale.mjs.\n`);
  process.exit(2);
};

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};

const repo = resolve(flag('--repo', process.cwd()));
const indexState = flag('--index', undefined);
if (indexState !== 'cold' && indexState !== 'complete') {
  usage('--index must be "cold" or "complete" — the index state changes the answer more than most changes do');
}
const only = flag('--only', null);
const wants = (id) => only === null || only === id;

const cli = join(PACKAGE_ROOT, 'dist', 'commitlore.mjs');
if (!existsSync(cli)) usage(`no built CLI at ${cli} — run npm run build first`);

const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
  cwd: repo,
  encoding: 'utf8',
}).trim();

/** A git that records its own argv, so what is counted is what actually ran. */
const shimDir = mkdtempSync(join(tmpdir(), 'commitlore-scale-'));
const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
writeFileSync(
  join(shimDir, 'git'),
  `#!/bin/sh\necho "$*" >> "\${CL_MEASURE_LOG:-/dev/null}"\nexec ${realGit} "$@"\n`,
);
execFileSync('chmod', ['+x', join(shimDir, 'git')]);

const resetIndex = () => {
  rmSync(join(gitDir, 'commitlore'), { recursive: true, force: true });
  mkdirSync(join(gitDir, 'commitlore'), { recursive: true });
  if (indexState === 'complete') {
    const built = spawnSync(process.execPath, [cli, 'index', '--rebuild'], {
      cwd: repo,
      encoding: 'utf8',
    });
    if (built.status !== 0) usage(`could not build the index: ${built.stderr}`);
  }
};

const shapesOf = (log) => {
  const calls = readFileSync(log, 'utf8').split('\n').filter((line) => line !== '');
  const byShape = new Map();
  for (const line of calls) {
    const word = line.split(' ').find((p) => p !== '' && !p.startsWith('-') && !p.includes('=')) ?? '?';
    byShape.set(word, (byShape.get(word) ?? 0) + 1);
  }
  return { total: calls.length, byShape };
};

const out = (text) => process.stdout.write(text);
const row = (label, value) => out(`    ${label.padEnd(34)}${String(value).padStart(8)}\n`);

// --- provenance, first and always ------------------------------------------

const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
  cwd: repo,
  encoding: 'utf8',
}).trim();
const load = loadavg()[0] ?? 0;

out('\nmeasure-scale\n');
out(`    repo ${repo}\n`);
out(`    head ${head.slice(0, 12)}   ${commits} commits\n`);
out(`    index ${indexState}   node ${process.version}\n`);
out(`    load1 ${load.toFixed(2)} on ${String(cpus().length)} cpus`);
out(load > 4 ? '   *** BUSY: counts are exact, read nothing into any duration ***\n' : '\n');


/**
 * Reads rows from the index with a throwaway child, so this harness never holds
 * the database open while the thing it measures writes to it.
 */
const readJson = (dbPath, sql) => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `const {DatabaseSync}=require('node:sqlite');` +
        `const d=new DatabaseSync(${JSON.stringify(dbPath)},{readOnly:true});` +
        `process.stdout.write(JSON.stringify(d.prepare(${JSON.stringify(sql)}).all()));`,
    ],
    { encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  try {
    return JSON.parse(result.stdout);
  } catch {
    return [];
  }
};

/**
 * One incremental update with the handle held open, reporting the WAL frames it
 * wrote before anything checkpoints them away.
 */
const WAL_PROBE = `
import { statSync } from 'node:fs';
import { join } from 'node:path';
const { openIndex, closeIndex, updateIndex } = await import(${JSON.stringify(join(PACKAGE_ROOT, 'dist', 'core', 'index-db.js'))});
const dir = process.env.COMMITLORE_PROBE_DIR;
const gitDir = (await import('node:child_process')).execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: dir, encoding: 'utf8' }).trim();
const wal = join(gitDir, 'commitlore', 'index.db-wal');
const size = () => { try { return statSync(wal).size; } catch { return 0; } };
const handle = openIndex({ cwd: dir });
try {
  handle.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const before = size();
  const stats = updateIndex(handle, {});
  const after = size();
  const pageSize = Object.values(handle.db.prepare('PRAGMA page_size').get())[0];
  const frame = 24 + Number(pageSize);
  const toFrames = (bytes) => (bytes <= 32 ? 0 : Math.round((bytes - 32) / frame));
  process.stdout.write(JSON.stringify({ frames: toFrames(after) - toFrames(before), trailersIndexed: stats.trailersIndexed }) + '\\n');
} finally {
  closeIndex(handle);
}
`;

// --- #962: what a second request in one MCP process repeats -----------------

const mcpRepeats = async () => {
  resetIndex();
  const log = join(shimDir, 'mcp.log');
  writeFileSync(log, '');
  const server = spawn(process.execPath, [cli, 'mcp'], {
    cwd: repo,
    env: { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ''}`, CL_MEASURE_LOG: log },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buffer = '';
  const pending = new Map();
  server.stdout.on('data', (chunk) => {
    buffer += String(chunk);
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line === '') continue;
      try {
        const message = JSON.parse(line);
        const resolveOne = pending.get(message.id);
        if (resolveOne !== undefined) {
          pending.delete(message.id);
          resolveOne(message);
        }
      } catch {
        /* not a JSON-RPC line */
      }
    }
  });

  let id = 1;
  const call = (method, params) =>
    new Promise((resolveOne, reject) => {
      const mine = id++;
      pending.set(mine, resolveOne);
      server.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: mine, method, ...(params === undefined ? {} : { params }) })}\n`,
      );
      setTimeout(() => {
        if (pending.delete(mine)) reject(new Error(`${method} timed out`));
      }, 120_000);
    });

  const since = () => {
    const { total, byShape } = shapesOf(log);
    writeFileSync(log, '');
    return { total, byShape };
  };

  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'measure-scale', version: '0' },
  });
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const startup = since().total;

  const rows = [];
  for (const [label, name, args] of [
    ['query A (cold process)', 'commitlore_query', { kind: 'context', path: 'README.md' }],
    ['query A again', 'commitlore_query', { kind: 'context', path: 'README.md' }],
    ['query B, another path', 'commitlore_query', { kind: 'context', path: 'src' }],
    ['query B again', 'commitlore_query', { kind: 'context', path: 'src' }],
    ['stale', 'commitlore_stale', {}],
    ['stale again', 'commitlore_stale', {}],
  ]) {
    await call('tools/call', { name, arguments: args }).catch(() => undefined);
    rows.push([label, since()]);
  }

  server.stdin.end();
  server.kill('SIGTERM');

  out('\n#962  a second request in one long-lived MCP process, in git processes\n');
  row('server startup', startup);
  for (const [label, measured] of rows) row(label, measured.total);
  out(
    '\n    A repeat that costs the same as the first is work a session identity could\n' +
      '    key a cache on; a repeat that costs nothing already has one.\n',
  );
  // Which processes repeat decides *what* a cache would key, which is the part
  // of the decision a total cannot answer: snapshot validation is cheap to
  // revalidate and expensive to get wrong, and a corpus read is the reverse.
  const repeated = rows.find(([label]) => label === 'query A again')?.[1];
  const repeatedStale = rows.find(([label]) => label === 'stale again')?.[1];
  for (const [what, measured] of [['a repeated query', repeated], ['a repeated stale', repeatedStale]]) {
    if (measured === undefined) continue;
    out(`    ${what} repeats:\n`);
    for (const [shape, n] of [...measured.byShape].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      row(`  ${shape}`, n);
    }
  }
};

// --- #963: validate --range, graph work versus collision work ----------------

/**
 * Commit count and reference density varied independently.
 *
 * #951 established that commit count is not the cold-path driver, by varying
 * the two separately. The same separation is what decides this: if the cost
 * tracks the number of commits it is the per-commit graph walk, and if it
 * tracks the number of references it is the collision work.
 */
const rangeShapes = () => {
  out('\n#963  validate --range: does the cost follow commits, or references?\n');

  const withRefs = (n) => {
    const commitsIn = execFileSync('git', ['rev-list', `-${String(n)}`, 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((s) => s !== '');
    const base = commitsIn[commitsIn.length - 1];
    const range = `${base}..HEAD`;

    // How many of these commits actually declare a record: the density the
    // collision work scales with, counted rather than assumed.
    const declared = execFileSync(
      'git',
      ['log', '--format=%B', `${base}..HEAD`],
      { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 },
    )
      .split('\n')
      .filter((line) => line.startsWith('Record-Id:')).length;

    resetIndex();
    const log = join(shimDir, 'range.log');
    writeFileSync(log, '');
    spawnSync(process.execPath, [cli, 'validate', '--range', range, '--json'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ''}`, CL_MEASURE_LOG: log },
      maxBuffer: 1 << 28,
    });
    const { total, byShape } = shapesOf(log);
    return { commits: commitsIn.length - 1, declared, total, byShape };
  };

  const samples = [10, 20, 40, 80].map(withRefs);
  out('    commits  records  processes   per-commit   per-record\n');
  for (const sample of samples) {
    out(
      `    ${String(sample.commits).padStart(7)}  ${String(sample.declared).padStart(7)}  ` +
        `${String(sample.total).padStart(9)}  ` +
        `${(sample.total / Math.max(sample.commits, 1)).toFixed(1).padStart(10)}  ` +
        `${(sample.total / Math.max(sample.declared, 1)).toFixed(1).padStart(11)}\n`,
    );
  }
  const widest = samples[samples.length - 1];
  out('    shapes at the widest range:\n');
  for (const [shape, n] of [...widest.byShape].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    row(`  ${shape}`, n);
  }
  out(
    '    A flat per-commit column with a moving per-record one says the walk is the\n' +
      '    cost, which is what "parent-specific" would attack. The reverse says it is not.\n',
  );
};

// --- #964: storage size and write amplification -----------------------------

/**
 * File size answers "how big", and `PRAGMA page_count` answers "how much did
 * one commit rewrite" — which is the half that decides whether storing more is
 * affordable. A file that grows by 4 KB may have rewritten 400.
 */
const storage = () => {
  out('\n#964  what the index stores, and what one more commit costs\n');
  resetIndex();
  const dbPath = join(gitDir, 'commitlore', 'index.db');
  if (!existsSync(dbPath)) {
    out('    no index.db (the run asked for a cold index) — rerun with --index complete\n');
    return;
  }

  const pragma = (name) => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(dbPath)},{readOnly:true});` +
          `process.stdout.write(String(Object.values(d.prepare('PRAGMA ${name}').get())[0]));`,
      ],
      { encoding: 'utf8' },
    );
    return Number(result.stdout);
  };
  const count = (table) => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify(dbPath)},{readOnly:true});` +
          `process.stdout.write(String(d.prepare('SELECT count(*) n FROM ${table}').get().n));`,
      ],
      { encoding: 'utf8' },
    );
    return Number(result.stdout);
  };

  const bytes = statSync(dbPath).size;
  const trailers = count('trailers');
  const paths = count('commit_paths');
  row('index.db bytes', bytes);
  row('trailer rows', trailers);
  row('commit_path rows', paths);
  row('page_count x page_size', pragma('page_count') * pragma('page_size'));
  row('freelist pages', pragma('freelist_count'));

  // Per table, not the whole file divided by a row count.
  //
  // `bytes / trailer rows` averages in every index, the FTS mirror, the
  // freelist and page overhead, and says nothing about the marginal size of a
  // row in a table that does not exist yet. This project quoted 1,100 bytes a
  // row from that division and used it to call a schema change cheap; the
  // `trailers` table's own rows are 297.
  out('\n    per table, from dbstat:\n');
  const perTable = readJson(dbPath, `
    SELECT name, sum(pgsize) AS bytes, count(*) AS pages FROM dbstat
     WHERE name NOT LIKE 'sqlite_%' GROUP BY name ORDER BY bytes DESC LIMIT 8`);
  for (const entry of perTable) {
    out(
      `      ${String(entry.name).padEnd(26)}${String(entry.bytes).padStart(10)} bytes` +
        `${String(entry.pages).padStart(6)} pages\n`,
    );
  }
  if (trailers > 0) {
    const own = perTable.find((entry) => entry.name === 'trailers');
    if (own !== undefined) row('bytes per trailers row', Math.round(Number(own.bytes) / trailers));
  }

  // Pages WRITTEN, not pages added.
  //
  // The file-size and `page_count` deltas below are growth. An update that
  // rewrites a page in place, or takes one off the freelist, moves neither --
  // which is how this harness previously reported "steady-state write
  // amplification is zero" for an index that writes tens of kilobytes per
  // commit. WAL frames count what actually reached the disk: the file is a
  // 32-byte header plus one frame of `page_size + 24` per page written.
  //
  // Counted with the handle still open. Closing checkpoints the WAL and erases
  // exactly what is being measured, which is why the first attempt read zero
  // every time.
  const probes = 6;
  const walPath = `${dbPath}-wal`;
  const frames = () => {
    try {
      const size = statSync(walPath).size;
      return size <= 32 ? 0 : Math.round((size - 32) / (24 + pragma('page_size')));
    } catch {
      return 0;
    }
  };

  const deltas = [];
  let made = 0;
  try {
    for (let at = 0; at < probes; at += 1) {
      const marker = join(repo, `.commitlore-amplify-probe-${String(at)}`);
      writeFileSync(marker, `probe ${String(at)}\n`);
      execFileSync('git', ['add', '--', marker], { cwd: repo });
      const recorded = at % 2 === 1;
      execFileSync(
        'git',
        [
          '-c', 'user.name=Measure',
          '-c', 'user.email=measure@example.invalid',
          '-c', 'commit.gpgsign=false',
          'commit', '-q', '--no-verify', '-m',
          recorded
            ? `amplify probe ${String(at)}\n\nRecord-Id: r-amplifyprobe${String(at)}${String(at)}\nBlast: local\n`
            : `amplify probe ${String(at)}\n\nno record here\n`,
        ],
        { cwd: repo },
      );
      made += 1;

      const beforeBytes = statSync(dbPath).size;
      const beforePages = pragma('page_count');
      // The update runs in a child that holds the handle open across it and
      // reports the frames before closing: a close checkpoints the WAL and
      // erases exactly what this counts.
      const probe = spawnSync(process.execPath, ['--input-type=module', '--eval', WAL_PROBE], {
        encoding: 'utf8',
        maxBuffer: 1 << 26,
        env: { ...process.env, COMMITLORE_PROBE_DIR: repo },
      });
      let wrote = '?';
      let rows = '?';
      try {
        const parsed = JSON.parse((probe.stdout.trim().split('\n').pop() ?? '{}'));
        wrote = String(parsed.frames);
        rows = String(parsed.trailersIndexed);
      } catch {
        /* the byte deltas still stand on their own */
      }
      deltas.push({
        at,
        recorded,
        rows,
        fileDelta: statSync(dbPath).size - beforeBytes,
        pageDelta: pragma('page_count') - beforePages,
        frames: wrote,
      });
    }
  } finally {
    if (made > 0) {
      execFileSync('git', ['reset', '-q', '--mixed', `HEAD~${String(made)}`], { cwd: repo });
    }
    for (let at = 0; at < probes; at += 1) {
      rmSync(join(repo, `.commitlore-amplify-probe-${String(at)}`), { force: true });
    }
  }

  out('\n    further commits, indexed one at a time (frames = pages written):\n');
  out('      #   record   rows   file delta   page delta   frames   bytes written\n');
  for (const d of deltas) {
    out(
      `      ${String(d.at)}   ${(d.recorded ? 'yes' : 'no').padEnd(6)}   ` +
        `${d.rows.padStart(4)}   ${String(d.fileDelta).padStart(10)}   ` +
        `${String(d.pageDelta).padStart(10)}   ${d.frames.padStart(6)}   ` +
        `${String((Number(d.frames) || 0) * pragma('page_size')).padStart(12)}\n`,
    );
  }
  out(
    '\n    Read the frames column, not the file delta: a file that did not grow is not\n' +
      '    a file nobody wrote to. And read the steady state, not the first row. "Lossless" would cost one row per\n' +
      '    processed commit whether it carries a record or not; the per-row figure above\n' +
      '    is what to multiply by the commit count to price it.\n',
  );
};

// --- #951 item 1: commit count against record count, varied independently ----

/**
 * The measurement #951's first item is waiting on, in the form it asks for.
 *
 * "with commit count and record count varied independently" is the whole
 * instruction. The #963 table above varies commit count against this
 * repository's own history, where record density rides along with it -- so it
 * cannot separate the two, and reading it as if it could is how a number
 * becomes a property of the wrong thing.
 *
 * These are generated repositories, each its own fixture: one row holds the
 * commit count and moves the density, the other holds the density and moves
 * the commit count. A cost that tracks the first is per-record; one that tracks
 * the second is per-commit.
 */
const perRecordOrPerCommit = () => {
  out('\n#951 item 1  is validation per-commit work or per-record work?\n');
  // These fixtures are generated fresh and carry no index, so these rows are the
  // cold path whatever `--index` said -- which is the path `validate --range`
  // takes anyway. Said here rather than left for a reader to assume, because
  // `--index` is printed in the header above and would otherwise look like it
  // applied.
  out('    (generated fixtures, each with no index of its own: cold path)\n');

  const fixture = (commits, ratio) => {
    const dir = mkdtempSync(join(tmpdir(), 'commitlore-scale-fix-'));
    execFileSync(
      process.execPath,
      [
        join(PACKAGE_ROOT, 'scripts', 'make-synthetic-repo.mjs'),
        '--out', dir,
        '--commits', String(commits),
        '--trailer-ratio', String(ratio),
        '--prose-ratio', '0.05',
        '--seed', '951',
        '--quiet',
      ],
      { encoding: 'utf8' },
    );
    return dir;
  };

  const sample = (commits, ratio) => {
    const dir = fixture(commits, ratio);
    try {
      const all = execFileSync('git', ['rev-list', 'HEAD'], { cwd: dir, encoding: 'utf8' })
        .split('\n')
        .filter((s) => s !== '');
      const base = all[all.length - 1];
      const records = execFileSync('git', ['log', '--format=%B', 'HEAD'], {
        cwd: dir,
        encoding: 'utf8',
        maxBuffer: 1 << 28,
      })
        .split('\n')
        .filter((line) => line.startsWith('Record-Id:')).length;

      const log = join(shimDir, 'item1.log');
      writeFileSync(log, '');
      spawnSync(process.execPath, [cli, 'validate', '--range', `${base}..HEAD`, '--json'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${shimDir}:${process.env.PATH ?? ''}`, CL_MEASURE_LOG: log },
        maxBuffer: 1 << 28,
      });
      const { total } = shapesOf(log);
      return { commits: all.length - 1, records, total };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const show = (title, rows) => {
    out(`    ${title}\n`);
    out('      commits  records  processes   per-commit   per-record\n');
    for (const r of rows) {
      out(
        `      ${String(r.commits).padStart(7)}  ${String(r.records).padStart(7)}  ` +
          `${String(r.total).padStart(9)}  ` +
          `${(r.total / Math.max(r.commits, 1)).toFixed(2).padStart(10)}  ` +
          `${(r.total / Math.max(r.records, 1)).toFixed(2).padStart(11)}\n`,
      );
    }
  };

  show(
    'commits held at 200, record density varied:',
    [0.1, 0.3, 0.6, 0.9].map((ratio) => sample(200, ratio)),
  );
  show(
    'record density held at 0.3, commit count varied:',
    [100, 200, 400].map((commits) => sample(commits, 0.3)),
  );
  out(
    '    A per-commit column that stays flat while density moves says the work is\n' +
      '    per commit; a per-record column that stays flat while commits move says the\n' +
      '    opposite. Whichever is flat is the one the cost is really indexed by.\n',
  );
};

try {
  if (wants('962')) await mcpRepeats();
  if (wants('963')) rangeShapes();
  if (wants('964')) storage();
  if (wants('951')) perRecordOrPerCommit();
} finally {
  rmSync(shimDir, { recursive: true, force: true });
}
out('\n');
