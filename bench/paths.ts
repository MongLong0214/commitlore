import path from "node:path";

/**
 * Task files are data. A `files:` key of `../../.ssh/authorized_keys` must not
 * escape the throwaway workspace, so every path from YAML is resolved and
 * checked against its root before anything is written.
 */
export const resolveInside = (root: string, relative: string): string => {
  if (relative.trim() === "") throw new Error("empty path in task definition");
  if (path.isAbsolute(relative)) throw new Error(`absolute path not allowed: ${relative}`);
  if (relative.includes(String.fromCharCode(0))) throw new Error(`NUL byte in path: ${JSON.stringify(relative)}`);
  const rootResolved = path.resolve(root);
  const target = path.resolve(rootResolved, relative);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : `${rootResolved}${path.sep}`;
  if (target !== rootResolved && !target.startsWith(prefix)) {
    throw new Error(`path escapes workspace: ${relative}`);
  }
  return target;
};
