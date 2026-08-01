#!/usr/bin/env node
/**
 * T-1016 (#212): Deterministic README demo recording.
 *
 * Generates an animated SVG showing the `commitlore demo` scenario using only
 * Node.js stdlib. The output is byte-exact across runs because:
 *   - All frame content comes from the static fixture (no runtime data)
 *   - Font metrics are hardcoded (monospace, fixed char width/height)
 *   - Viewport dimensions, padding, and timing are constants
 *   - No timestamps, random values, or environment-dependent data
 *
 * Usage:
 *   node scripts/record-demo.mjs           # generate the SVG asset
 *   node scripts/record-demo.mjs --check   # regenerate to temp, compare bytes
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const ASSET_PATH = join(REPO_ROOT, 'assets', 'readme', 'commitlore-demo.svg');

// ---------------------------------------------------------------------------
// Fixed terminal dimensions and font metrics
// ---------------------------------------------------------------------------

const COLS = 80;
const ROWS = 24;
const CHAR_W = 8.4;     // px per character (monospace)
const CHAR_H = 18;      // px per line height
const PAD_X = 16;       // horizontal padding
const PAD_Y = 12;       // vertical padding
const TITLE_H = 32;     // title bar height
const WIDTH = Math.ceil(COLS * CHAR_W + PAD_X * 2);
const HEIGHT = ROWS * CHAR_H + PAD_Y * 2 + TITLE_H;

// Frame timing (seconds)
const FRAME_PAUSE = 1.5;    // pause between frames
const TYPING_DELAY = 0.06;  // per-character typing delay (visual only)

// ---------------------------------------------------------------------------
// Static frame content — derived from T-1010 fixture, not generated at runtime
// ---------------------------------------------------------------------------

const FRAMES = [
  {
    label: 'prompt',
    lines: [
      '$ commitlore demo',
    ],
  },
  {
    label: 'scenario',
    lines: [
      '$ commitlore demo',
      '',
      '─── commitlore demo ───',
      '',
      'Scenario: two decisions recorded for src/services/cache.ts',
      '  1. "Use Redis for session cache" (later superseded)',
      '  2. "Switch to SQLite" (supersedes the first — now active)',
      '',
      'An agent proposes reverting to Redis. CommitLore answers:',
    ],
  },
  {
    label: 'result',
    lines: [
      '$ commitlore demo',
      '',
      '─── commitlore demo ───',
      '',
      'Scenario: two decisions recorded for src/services/cache.ts',
      '  1. "Use Redis for session cache" (later superseded)',
      '  2. "Switch to SQLite" (supersedes the first — now active)',
      '',
      'An agent proposes reverting to Redis. CommitLore answers:',
      '',
      '  Record-Id: r-demo02 [active]',
      '    Limit: single-writer constraint requires careful connection pooling',
      '    Ruled-out: Redis cluster | cost and complexity disproportionate to traffic',
      '',
      'Only the active decision (r-demo02) is shown.',
      'The superseded Redis decision is filtered out — the agent cannot revive it.',
    ],
  },
];

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

/** Escape XML special characters */
function esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render a single frame's text lines as SVG <text> elements */
function renderFrameText(lines, groupId) {
  const parts = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    const y = TITLE_H + PAD_Y + (i + 1) * CHAR_H;
    const x = PAD_X;

    // Color coding
    let fill = '#c5c8c6'; // default: light gray
    if (line.startsWith('$')) fill = '#81a2be'; // prompt: blue
    else if (line.startsWith('───')) fill = '#b5bd68'; // header: green
    else if (line.includes('[active]')) fill = '#b5bd68'; // active: green
    else if (line.startsWith('  Record-Id:')) fill = '#f0c674'; // record id: yellow
    else if (line.includes('Limit:') || line.includes('Ruled-out:')) fill = '#cc6666'; // constraints: red
    else if (line.includes('superseded') || line.includes('filtered out')) fill = '#b294bb'; // lifecycle: purple
    else if (line.startsWith('Scenario:') || line.startsWith('An agent')) fill = '#c5c8c6'; // narrative: default

    parts.push(`    <text x="${x}" y="${y}" fill="${fill}" id="${groupId}-line${i}">${esc(line)}</text>`);
  }
  return parts.join('\n');
}

function generateSvg() {
  // Calculate total animation duration
  const totalDuration = FRAMES.length * FRAME_PAUSE + (FRAMES.length - 1) * 0.5;
  const frameDuration = totalDuration / FRAMES.length;

  // Build frame groups with visibility animations
  const frameGroups = [];
  const animations = [];

  for (let i = 0; i < FRAMES.length; i++) {
    const frame = FRAMES[i];
    const groupId = `frame-${i}`;
    const textContent = renderFrameText(frame.lines, groupId);

    // Each frame is visible for frameDuration, starting at i * frameDuration
    const begin = (i * frameDuration).toFixed(2);
    const dur = frameDuration.toFixed(2);
    const visible = i === FRAMES.length - 1 ? 'visible' : 'hidden';

    frameGroups.push(`  <g id="${groupId}" visibility="${i === 0 ? 'visible' : 'hidden'}">
${textContent}
    <set attributeName="visibility" to="visible" begin="${begin}s" dur="${dur}s" fill="remove"/>
    <set attributeName="visibility" to="hidden" begin="${(parseFloat(begin) + parseFloat(dur)).toFixed(2)}s" fill="${i === FRAMES.length - 1 ? 'freeze' : 'remove'}"/>
  </g>`);
  }

  // The last frame stays visible (freeze)
  // Override: make last frame visible after its start and freeze
  frameGroups[FRAMES.length - 1] = `  <g id="frame-${FRAMES.length - 1}" visibility="hidden">
${renderFrameText(FRAMES[FRAMES.length - 1].lines, `frame-${FRAMES.length - 1}`)}
    <set attributeName="visibility" to="visible" begin="${((FRAMES.length - 1) * frameDuration).toFixed(2)}s" fill="freeze"/>
  </g>`;

  // `aria-label` on the root is not enough on its own: a reader who opens the
  // file directly, rather than through the README's `img` tag, gets nothing to
  // name it by. `<title>` is the element SVG defines for that, and `<desc>`
  // carries what the animation shows to anyone who cannot watch it run.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-labelledby="demo-title demo-desc">
  <!-- T-1016: deterministic animated SVG — do not edit by hand; regenerate with: node scripts/record-demo.mjs -->
  <title id="demo-title">commitlore demo: lifecycle filtering shows only active decisions</title>
  <desc id="demo-desc">A terminal recording. Two decisions are recorded for one path and the later supersedes the first. When an agent proposes reverting to the superseded approach, only the active record is returned.</desc>
  <rect width="100%" height="100%" rx="8" fill="#1d1f21"/>
  <!-- Title bar -->
  <rect width="100%" height="${TITLE_H}" rx="8" fill="#282a2e"/>
  <circle cx="20" cy="16" r="6" fill="#cc6666"/>
  <circle cx="38" cy="16" r="6" fill="#f0c674"/>
  <circle cx="56" cy="16" r="6" fill="#b5bd68"/>
  <text x="${WIDTH / 2}" y="20" text-anchor="middle" fill="#969896" font-family="monospace" font-size="12">commitlore demo</text>
  <style>
    text { font-family: 'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace; font-size: 13px; }
  </style>
${frameGroups.join('\n')}
</svg>
`;

  return svg;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const isCheck = args.includes('--check');

const generated = generateSvg();

if (isCheck) {
  // Compare with the committed asset
  let existing;
  try {
    existing = readFileSync(ASSET_PATH, 'utf8');
  } catch {
    process.stderr.write(`record-demo --check: asset not found at ${ASSET_PATH}\n`);
    process.stderr.write('Run `node scripts/record-demo.mjs` to generate it first.\n');
    process.exitCode = 1;
    process.exit(1);
  }

  if (existing === generated) {
    process.stdout.write('record-demo --check: asset is byte-identical to a fresh render. OK\n');
    process.exitCode = 0;
  } else {
    // Find first differing byte for diagnostics
    let diffPos = -1;
    const minLen = Math.min(existing.length, generated.length);
    for (let i = 0; i < minLen; i++) {
      if (existing[i] !== generated[i]) { diffPos = i; break; }
    }
    if (diffPos === -1) diffPos = minLen; // length difference

    process.stderr.write(`record-demo --check: MISMATCH\n`);
    process.stderr.write(`  committed: ${existing.length} bytes\n`);
    process.stderr.write(`  generated: ${generated.length} bytes\n`);
    process.stderr.write(`  first difference at byte ${diffPos}\n`);
    process.stderr.write(`  committed[${diffPos}]: ${JSON.stringify(existing.slice(diffPos, diffPos + 40))}\n`);
    process.stderr.write(`  generated[${diffPos}]: ${JSON.stringify(generated.slice(diffPos, diffPos + 40))}\n`);
    process.stderr.write('\nRegenerate with: node scripts/record-demo.mjs\n');
    process.exitCode = 1;
    process.exit(1);
  }
} else {
  writeFileSync(ASSET_PATH, generated, 'utf8');
  process.stdout.write(`record-demo: wrote ${generated.length} bytes to ${ASSET_PATH}\n`);
  process.exitCode = 0;
}
