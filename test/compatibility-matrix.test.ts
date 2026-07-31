/**
 * T-1122 (#271): `docs/COMPATIBILITY.md` is the one place that says which hosts
 * CommitLore supports and what each install path checks before it writes. A
 * statement like that goes stale silently -- the code moves, the table does not,
 * and nothing fails -- so the document is only worth having if something checks
 * it.
 *
 * Every table is compared to the files that provide what it claims, and the
 * comparisons are written to fail on the two kinds of drift that are easy to
 * miss:
 *
 * - **Deletion.** A "the table is non-empty" guard is satisfied by one surviving
 *   row, so the whole host statement can evaporate and still pass. Each table's
 *   row keys are asserted as an exact set instead.
 * - **Superstring.** `toContain` on a short value passes on a narrowing: `./` is
 *   inside `../`, and `Edit|Write` is inside `Edit|Write|MultiEdit|NotebookEdit`
 *   -- so a matcher that silently stopped firing on two tools would pass. Cells
 *   are compared as the rendered form, or reconstructed and compared whole.
 *
 * Separate from `test/manifest.test.ts`, which asserts the manifests are
 * internally coherent in a clean clone. This file asserts a *document* against
 * them, and the two fail for different reasons: a broken manifest fails there, a
 * document that drifted from a working manifest fails here.
 *
 * Separate from `test/readme.test.ts`, which owns the READMEs' own claims. The
 * only overlap is the pointer line each README carries to this document, and
 * that is asserted below so the pointer and its target fail together.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const DOC_PATH = join(REPO_ROOT, 'docs/COMPATIBILITY.md');

const README_FILES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md'] as const;

/** The whole vocabulary. A fifth word is a claim nobody defined. */
const STATUS_WORDS = ['supported', 'unsupported', 'undecided'] as const;
type Status = (typeof STATUS_WORDS)[number];

const readFile = (path: string): string => readFileSync(path, 'utf8');
const readJson = (path: string): unknown => JSON.parse(readFile(path));
const unticked = (cell: string): string => cell.replace(/`/g, '');

interface McpManifest {
  mcpServers?: Record<string, { command?: unknown; args?: unknown }>;
}
interface HooksManifest {
  hooks?: { PreToolUse?: { matcher?: unknown; hooks?: { command?: unknown }[] }[] };
}
interface PluginManifest {
  name?: unknown;
  version?: unknown;
}
interface MarketplaceManifest {
  name?: unknown;
  plugins?: { name?: unknown; source?: unknown }[];
}

/**
 * A GitHub-flavoured table under a given heading, as rows of trimmed cells.
 *
 * An escaped `\|` is parked on a sentinel before the split and restored after: a
 * matcher like `Edit|Write|MultiEdit` has to be escaped to survive a markdown
 * table at all, and splitting first would cut the row on the matcher's own
 * pipes. The sentinel is printable on purpose -- a `\0` here made git classify
 * this file as binary, which cost it its own diff in the pull request that
 * introduced it.
 */
const ESCAPED_PIPE = '@@COMMITLORE_ESCAPED_PIPE@@';

const tableUnder = (doc: string, heading: string): string[][] => {
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return [];
  const rows: string[][] = [];
  let sawSeparator = false;
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('##')) break;
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed
      .replaceAll('\\|', ESCAPED_PIPE)
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|');
    // The separator is found rather than assumed to be the second line: an
    // unconditional `slice(1)` drops a real data row whenever a table's
    // alignment row is malformed, and drops it silently.
    if (cells.every((c) => /^\s*:?-+:?\s*$/.test(c))) {
      sawSeparator = true;
      rows.length = 0;
      continue;
    }
    if (!sawSeparator) continue;
    rows.push(cells.map((c) => c.trim().replaceAll(ESCAPED_PIPE, '|')));
  }
  return rows;
};

const doc = existsSync(DOC_PATH) ? readFile(DOC_PATH) : '';
const keysOf = (rows: string[][]): string[] => rows.map((r) => unticked(r[0]));

describe('T-1122 the compatibility statement exists and is the authoritative one', () => {
  it('docs/COMPATIBILITY.md is committed', () => {
    expect(existsSync(DOC_PATH), 'docs/COMPATIBILITY.md must exist').toBe(true);
  });

  it.each(README_FILES)('%s points at it exactly once', (file) => {
    const hits = readFile(join(REPO_ROOT, file)).split('docs/COMPATIBILITY.md').length - 1;
    expect(hits, `${file} must carry exactly one pointer`).toBe(2);
  });
});

describe('T-1122 the install paths table names paths that exist', () => {
  const rows = (): string[][] => tableUnder(doc, '## Install paths');

  it('names exactly the three paths, in the order a reader should try them', () => {
    expect(keysOf(rows())).toEqual(['Plugin', 'Shell script', 'PowerShell script']);
  });

  it('every script it names is committed', () => {
    for (const [path, command] of rows()) {
      for (const script of unticked(command).match(/install\.(sh|ps1)/g) ?? []) {
        expect(existsSync(join(REPO_ROOT, script)), `${path}: ${script} is missing`).toBe(true);
      }
    }
  });

  it('the plugin row derives its commands from the two manifests', () => {
    const row = rows().find(([p]) => /plugin/i.test(p));
    const market = readJson(join(REPO_ROOT, '.claude-plugin/marketplace.json')) as MarketplaceManifest;
    const entry = market.plugins?.[0];
    expect(unticked(row![1])).toContain(`/plugin install ${String(entry?.name)}@${String(market.name)}`);
  });

  it('no table outside ## Hosts carries a host status word', () => {
    // The forbidden claim is "Windows is supported", not "Windows is supported
    // in one particular table". Checking only ## Hosts left the document able to
    // make it anywhere else.
    for (const heading of ['## Install paths', '## Prerequisites', '## Plugin capabilities']) {
      for (const row of tableUnder(doc, heading)) {
        for (const cell of row) {
          expect(
            /\b(un)?supported\b/i.test(cell),
            `${heading} states a support status in "${cell}"; only ## Hosts may`,
          ).toBe(false);
        }
      }
    }
  });
});

describe('T-1122 every documented plugin capability is backed by its manifest (req 2)', () => {
  const rows = (): string[][] => tableUnder(doc, '## Plugin capabilities');
  /** The cell, not a hardcoded path: a drifted "Provided by" must read the wrong file. */
  const providedBy = (capability: RegExp): { path: string; value: string } => {
    const row = rows().find(([c]) => capability.test(c));
    expect(row, `no row matching ${capability}`).toBeDefined();
    return { path: join(REPO_ROOT, unticked(row![1]).replace(/\/$/, '')), value: row![2] };
  };

  it('names exactly the capabilities the ticket enumerates', () => {
    expect(keysOf(rows())).toEqual([
      'MCP server',
      'pre-edit context hook',
      'skills',
      'plugin identity',
      'marketplace',
    ]);
  });

  it('every row names a file that exists', () => {
    for (const [capability, provider] of rows()) {
      const path = unticked(provider).replace(/\/$/, '');
      expect(existsSync(join(REPO_ROOT, path)), `${capability}: ${path} does not exist`).toBe(true);
    }
  });

  it('the MCP server row matches .mcp.json', () => {
    const { path, value } = providedBy(/mcp/i);
    const server = (readJson(path) as McpManifest).mcpServers?.commitlore;
    expect(unticked(value)).toBe([server?.command, ...((server?.args as string[]) ?? [])].join(' '));
  });

  it('the pre-edit hook row matches hooks/hooks.json exactly, not as a prefix', () => {
    const { path, value } = providedBy(/hook/i);
    const entry = (readJson(path) as HooksManifest).hooks?.PreToolUse?.[0];
    // Rendered form: `Edit|Write` is a substring of the real matcher, so a
    // narrowed manifest passed a bare toContain while the hook quietly stopped
    // firing on MultiEdit and NotebookEdit.
    expect(value).toBe(`\`PreToolUse\` on \`${String(entry?.matcher)}\``);
  });

  it('the skills row names exactly the committed skills', () => {
    const { path, value } = providedBy(/skill/i);
    const onDisk = readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(value.split(',').map((s) => unticked(s).trim()).sort()).toEqual(onDisk);
  });

  it('the plugin identity row matches plugin.json at the package version', () => {
    const { path, value } = providedBy(/identity/i);
    const plugin = readJson(path) as PluginManifest;
    const pkg = readJson(join(REPO_ROOT, 'package.json')) as { version?: unknown };
    expect(plugin.version, 'plugin.json must carry the package version').toBe(pkg.version);
    expect(value).toContain(`\`${String(plugin.name)}\``);
  });

  it('the marketplace row matches marketplace.json', () => {
    const { path, value } = providedBy(/marketplace/i);
    const market = readJson(path) as MarketplaceManifest;
    const entry = market.plugins?.[0];
    expect(value).toContain(`\`${String(entry?.name)}\``);
    // The rendered form: `./` is a substring of `../`.
    expect(value).toContain(`source: "${String(entry?.source)}"`);
  });
});

describe('T-1122 the documented prerequisites are the ones the installers check (req 3)', () => {
  const rows = (): string[][] => tableUnder(doc, '## Prerequisites');
  const sh = (): string => readFile(join(REPO_ROOT, 'install.sh'));
  const ps1 = (): string => readFile(join(REPO_ROOT, 'install.ps1'));

  /**
   * A row this map does not recognise is a failure rather than a skip. An
   * earlier version returned `continue`, which let an injected
   * `Ruby | ... | yes | yes` row pass -- the document could claim an installer
   * checked anything at all. An assertion that silently skips what it cannot
   * verify is not an assertion.
   */
  const PROBES: Record<string, { sh: RegExp; ps1: RegExp }> = {
    node: { sh: /command -v node/, ps1: /Get-Command node/ },
    git: { sh: /git --version/, ps1: /git\b[^\n]*--version/ },
    shell: { sh: /.^/, ps1: /.^/ },
  };

  it('names exactly the prerequisites, with none dropped', () => {
    expect(keysOf(rows()).map((k) => k.replace(/\s*\(.*\)$/, ''))).toEqual([
      'Node.js ≥ 22',
      'Git',
      'A POSIX shell',
    ]);
  });

  it('the Node floor in the table is the floor both installers enforce', () => {
    const floor = sh().match(/NODE_MAJOR_MIN=(\d+)/)?.[1];
    expect(floor, 'install.sh must declare NODE_MAJOR_MIN').toBeDefined();
    expect(ps1(), 'install.ps1 must declare the same floor').toContain(`$NodeMajorMin = ${floor}`);
    const row = rows().find(([n]) => /node/i.test(n));
    expect(row![0], 'the table states a floor the installers do not enforce').toContain(floor!);
  });

  it('each yes is checked and each dash is not', () => {
    for (const [name, , checkedBySh, checkedByPs1] of rows()) {
      const key = Object.keys(PROBES).find((k) => new RegExp(k, 'i').test(name));
      expect(
        key,
        `the document lists "${name}" as a prerequisite and this test has no probe for it, so the claim is unverifiable`,
      ).toBeDefined();
      // Both directions: a stale `no` is as wrong as a missing check, and only
      // asserting `yes` caught under-delivery while ignoring over-caution.
      expect(PROBES[key!].sh.test(sh()), `install.sh vs "${name}"`).toBe(/yes/i.test(checkedBySh));
      expect(PROBES[key!].ps1.test(ps1()), `install.ps1 vs "${name}"`).toBe(
        /yes/i.test(checkedByPs1),
      );
    }
  });

  it('the document says the plugin path checks nothing', () => {
    expect(doc).toMatch(/plugin path/i);
    expect(doc, 'required and checked must be kept apart').toMatch(
      /enforces nothing|checks nothing|does not check/i,
    );
  });
});

describe('T-1122 the host table uses one vocabulary and claims nothing unreached', () => {
  const rows = (): string[][] => tableUnder(doc, '## Hosts');
  const definitions = (): string => {
    const from = doc.indexOf('### The three words');
    const to = doc.indexOf('\n## ', from === -1 ? 0 : from);
    return from === -1 ? '' : doc.slice(from, to === -1 ? undefined : to);
  };

  it('no host row is missing', () => {
    expect(keysOf(rows())).toEqual([
      'macOS',
      'Linux, glibc',
      'Linux, musl (Alpine 3.21)',
      'Linux, musl (other distributions)',
      'Windows',
    ]);
  });

  it('every status is one of the three words', () => {
    for (const [host, status] of rows()) {
      expect(STATUS_WORDS, `${host} has status "${status}"`).toContain(status as Status);
    }
  });

  it('all three words are defined, in their own block, and unsupported is not undecided', () => {
    const block = definitions();
    expect(block.length, 'the document must define the vocabulary in its own section').toBeGreaterThan(0);
    for (const word of STATUS_WORDS) {
      expect(block, `${word} is used but never defined`).toContain(`**${word}**`);
    }
    const meaning = (word: Status): string =>
      block.slice(block.indexOf(`**${word}**`)).split('\n- ')[0];
    expect(
      meaning('undecided'),
      'undecided must mean unmeasured rather than being a gentler unsupported',
    ).toMatch(/not been measured|unmeasured|nobody has run/i);
    expect(meaning('unsupported')).not.toBe(meaning('undecided'));
  });

  it('every host row cites what established its status', () => {
    for (const [host, , establishedBy] of rows()) {
      expect((establishedBy ?? '').length, `${host} cites no evidence`).toBeGreaterThan(0);
    }
  });

  it('a row is undecided only when its own evidence says nothing was run', () => {
    // A silent downgrade is not a false claim, so nothing above catches it --
    // but the document defines `undecided` as unmeasured, and a row citing an
    // execution contradicts its own status word. That is checkable.
    for (const [host, status, establishedBy] of rows()) {
      if (status !== 'undecided') continue;
      expect(
        /executed|runs on|the `[\w-]+` job/i.test(establishedBy),
        `${host} is undecided but cites an execution: "${establishedBy}"`,
      ).toBe(false);
    }
  });

  it('the Windows row cites the containment work its status depends on', () => {
    // This asserted `status !== 'supported'` while T-1124 was unproven, which
    // pinned a transient fact as an invariant and made the cell flip that ticket
    // is authorised to perform unlandable. What is actually invariant is that
    // the row's status rests on #71's containment being established there, so
    // the citation is what gets checked -- in either direction.
    const row = rows().find(([h]) => /windows/i.test(h));
    expect(row, 'no Windows row').toBeDefined();
    expect(row![2], 'the Windows row must cite the containment issue').toMatch(/#71|#95/);
    expect(row![2], 'and the ticket that established or blocked it').toMatch(/T-1124|#283|#321/);
  });

  it('no supported row names a host no install path reaches', () => {
    // Derived from the install-path table rather than matched against a keyword
    // allowlist. A list of accepted words is not a reachability check: it let
    // `FreeBSD | supported | it feels right` through.
    const reached = tableUnder(doc, '## Install paths')
      .map(([, , who]) => who.toLowerCase())
      .join(' ');
    for (const [host, status] of rows()) {
      if (status !== 'supported') continue;
      const platform = unticked(host).split(/[,(]/)[0].trim().toLowerCase();
      expect(
        reached.includes(platform),
        `${host} is marked supported but no install path in the table above names ${platform}`,
      ).toBe(true);
    }
  });
});
