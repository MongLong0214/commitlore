/** How many routes deliver this MCP server to one host (#1079). */

import { pluginDeliveryProof } from '../../../hooks/claude-plugin.js';
import {
  hostConfigPath,
  hostRegistersCommitlore,
  MCP_REGISTRATION_FILE,
  registersCommitloreMcpServer,
} from '../../../core/mcp-registration.js';
import { check, type Category, type DoctorCheck, type DoctorContext } from '../model.js';

/**
 * Two installers register the same server and neither can see the other.
 *
 * #781 found this for the `PreToolUse` hook and fixed it there; the MCP server
 * has the same two installers and kept the defect. A host carrying both runs two
 * copies of the product — two processes, and two sets of the same tools in front
 * of the agent, which is context spent twice on one capability.
 *
 * The part that makes it worth a row rather than a note is that they are
 * separate *installations* and so drift apart. Measured on one machine: a
 * session whose plugin server was 1.3.17 while its user-scope registration
 * served 1.5.0. Inside that one session the hooks graded every edit by one
 * build's rules while the tools answered as another's, and no row said so —
 * `mcp-runtime-identity` saw two live processes and grouped them by path,
 * `runtime-identity` compared versions against a lifecycle entry that happened
 * to be the newer one, and `mcp-registration-runtime` reads project scope only.
 *
 * `init` no longer adds the second registration, but that fix reaches nobody who
 * already has both, which is what this row is for.
 *
 * `warn`, never `fail`, and it does not claim attention: what it observes is the
 * user's host configuration rather than this repository, and `init` treats a
 * check needing attention as a step that did not complete (#750).
 */
export const checkMcpDeliveryRoutes = (ctx: DoctorContext): DoctorCheck => {
  const id = 'mcp-delivery-routes';
  const title = 'MCP delivery routes';
  const category: Category = 'delivery';
  const cwd = ctx.opts.cwd ?? process.cwd();
  const home = ctx.env['HOME'] ?? '';

  const plugin = pluginDeliveryProof(cwd, home);
  const user = home === '' ? false : hostRegistersCommitlore(home);
  const project = registersCommitloreMcpServer(cwd);

  const routes = [
    ...(plugin.willFire ? ['the Claude Code plugin, from its own versioned cache'] : []),
    ...(user ? [`a user-scope registration in ${hostConfigPath(home)}`] : []),
    ...(project ? [`a project-scope registration in ${MCP_REGISTRATION_FILE}`] : []),
  ];

  const evidence = {
    plugin_will_fire: String(plugin.willFire),
    plugin_reason: plugin.reason,
    user_scope: String(user),
    project_scope: String(project),
    route_count: String(routes.length),
  };

  if (routes.length > 1) {
    return check(
      id,
      category,
      title,
      'warn',
      `${routes.length} routes deliver this MCP server to one host — ${routes.join('; ')}. ` +
        'Each starts its own process from its own installation, so the agent sees the same tools twice ' +
        'and the two can serve different builds: a plugin resolves its launcher once at session start, ' +
        'so reconnecting does not bring it forward',
      'keep one. The plugin carries hooks and skills as well, so disabling only its server keeps those: ' +
        'in Claude Code, /mcp disable plugin:commitlore:commitlore. To drop the host registration instead, ' +
        'claude mcp remove commitlore. A session already running keeps both until it restarts',
      false,
      // The user's host configuration, not this repository's -- see the note above.
      false,
      { evidence },
    );
  }

  return check(
    id,
    category,
    title,
    'ok',
    routes.length === 1
      ? `one route delivers this MCP server: ${routes[0]}`
      : 'no route delivers this MCP server to this host, so a host here starts no CommitLore server',
    null,
    false,
    undefined,
    { evidence },
  );
};
