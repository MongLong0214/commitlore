/**
 * #682: `hermes install` must recognise the config it wrote.
 *
 * Installing v1.0.0 over v0.8.2 failed with
 * `mcp_servers.commitlore already exists but does not point at this CommitLore
 * install` — while the entry pointed at exactly the right wrapper. The entry was
 * matched as five exact lines, and the config on disk wrote its `args` in flow
 * style, so a formatting difference read as a different installation.
 *
 * Two defects came out of that one comparison, and both are pinned here: the
 * upgrade was refused, and the refusal named `command` when `command` was
 * correct. The second is the worse of the two — a reader who follows that
 * message inspects the right value and finds nothing wrong.
 */

import { describe, expect, it } from 'vitest';

import { addHermesConfig } from '../src/core/hermes-config.js';

const WRAPPER = '/Users/example/.local/bin/commitlore';
const DATA_ROOT = '/Users/example/.local/share/commitlore';
const SKILLS = `${DATA_ROOT}/v1.0.0/hermes/skills`;

const apply = (contents: string) =>
  addHermesConfig(contents, { wrapperPath: WRAPPER, skillsDir: SKILLS, dataRoot: DATA_ROOT });

/** The shape found on the machine that hit this: flow-style args, stale skills. */
const CONFIG_FROM_A_PREVIOUS_INSTALL = [
  'mcp_servers:',
  '  commitlore:',
  `    command: ${WRAPPER}`,
  '    args: [mcp]',
  '    enabled: true',
  'skills:',
  '  external_dirs:',
  `    - ${DATA_ROOT}/v0.8.2/hermes/skills`,
  '',
].join('\n');

describe('#682 upgrading a Hermes config this installer previously wrote', () => {
  it('accepts flow-style args as the same entry', () => {
    const result = apply(CONFIG_FROM_A_PREVIOUS_INSTALL);

    expect(result.blocked, `blocked: ${result.blocked.join(' | ')}`).toEqual([]);
    expect(result.unchanged, 'the MCP entry already points here').toContain('mcp');
  });

  it('moves the version-pinned skills directory forward', () => {
    const result = apply(CONFIG_FROM_A_PREVIOUS_INSTALL);

    expect(result.added, 'the stale external_dirs entry is the thing that needed updating').toContain('skills');
    expect(result.contents).toContain(SKILLS);
    expect(result.contents, 'and the old one does not survive beside it').not.toContain('v0.8.2/hermes/skills');
  });

  // The message is the half that cost the most: it sent a reader to a correct
  // value. A refusal has to name the field that actually mismatched.
  it('names the command when the command is what differs', () => {
    const elsewhere = CONFIG_FROM_A_PREVIOUS_INSTALL.replace(
      `    command: ${WRAPPER}`,
      '    command: /opt/other/commitlore',
    );

    const result = apply(elsewhere);
    const [reason = ''] = result.blocked;

    expect(reason, 'the offending key is named').toContain('mcp_servers.commitlore.command');
    expect(reason, 'with the value that is there').toContain('/opt/other/commitlore');
    expect(reason, 'and the value expected').toContain(WRAPPER);
  });

  it('names args when args are what differ, and changes nothing', () => {
    const otherArgs = CONFIG_FROM_A_PREVIOUS_INSTALL.replace('    args: [mcp]', '    args: [mcp, --verbose]');

    const result = apply(otherArgs);
    const [reason = ''] = result.blocked;

    expect(reason, 'the offending key is named').toContain('mcp_servers.commitlore.args');
    expect(result.contents, 'a blocked entry is left exactly as it was').toContain('args: [mcp, --verbose]');
  });

  // A user who removed a key they did not want has not stopped using this
  // install, and an installer that treats absence as foreignness can never
  // upgrade anything a human has touched.
  it('does not require enabled: true to recognise its own entry', () => {
    const withoutEnabled = CONFIG_FROM_A_PREVIOUS_INSTALL.replace('    enabled: true\n', '');

    const result = apply(withoutEnabled);

    expect(result.blocked, `blocked: ${result.blocked.join(' | ')}`).toEqual([]);
    expect(result.unchanged).toContain('mcp');
  });

  it('still recognises the block form it writes itself', () => {
    const blockForm = CONFIG_FROM_A_PREVIOUS_INSTALL.replace('    args: [mcp]', '    args:\n      - mcp');

    const result = apply(blockForm);

    expect(result.blocked, `blocked: ${result.blocked.join(' | ')}`).toEqual([]);
    expect(result.unchanged).toContain('mcp');
  });
});
