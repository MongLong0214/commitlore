/**
 * A requested integration that failed must not report success.
 *
 * #698 added the Codex plugin step to the enumeration so every platform gets it.
 * It appended the outcome to `detail` and left `healthy` alone, so a run where
 * the MCP registration succeeded and the plugin install failed produced:
 *
 *   detail : "Codex registration added and live-verified; plugin step failed"
 *   healthy: true
 *   ok     : true
 *   exit   : 0
 *
 * The sentence said failed and the field said healthy, and the field is what
 * the installer's exit code is computed from. That is the defect this file
 * pins — the same shape as every other one found today, introduced while
 * fixing one of them.
 */

import { describe, expect, it } from 'vitest';

import { codexResultWithPlugin } from '../src/commands/installer-hosts.js';

const healthyMcp = {
  host: 'codex',
  requested: true as const,
  outcome: 'installed' as const,
  healthy: true,
  detail: 'Codex registration added and live-verified',
};

describe('a failed Codex plugin step is not a healthy host', () => {
  it('reports unhealthy when the plugin step fails', () => {
    const result = codexResultWithPlugin(healthyMcp, { ok: false, detail: 'plugin step failed' });

    expect(result.healthy, 'a requested integration that failed is not healthy').toBe(false);
    expect(result.detail, 'and the reason travels with it').toContain('plugin step failed');
  });

  it('keeps the MCP result visible when only the plugin failed', () => {
    const result = codexResultWithPlugin(healthyMcp, { ok: false, detail: 'plugin step failed' });

    // Which half worked matters: the registration is usable, the plugin is not,
    // and a reader who cannot tell them apart repairs the wrong one.
    expect(result.detail).toContain('Codex registration added and live-verified');
  });

  it('stays healthy when both halves succeed', () => {
    const result = codexResultWithPlugin(healthyMcp, { ok: true, detail: 'plugin installed' });

    expect(result.healthy).toBe(true);
    expect(result.detail).toContain('plugin installed');
  });

  // An unhealthy MCP result is already a failure; the plugin outcome must not
  // resurrect it.
  it('never turns an unhealthy registration healthy', () => {
    const failed = { ...healthyMcp, outcome: 'failed' as const, healthy: false, detail: 'registration unhealthy' };

    expect(codexResultWithPlugin(failed, { ok: true, detail: 'plugin installed' }).healthy).toBe(false);
  });
});
