/**
 * Skip seam for bench/cdeb tests that need zlib.zstdCompressSync (Node 22.15.0).
 * The package floor is 22.13.0; these tests must not raise it.
 */
import { describe as vitestDescribe } from "vitest";

import { hasZstd, zstdUnavailableMessage } from "../bench/cdeb/runtime/zstd.ts";

export { hasZstd, zstdUnavailableMessage };

export const describeZstd = (name: string, fn: () => void): void => {
  if (hasZstd) vitestDescribe(name, fn);
  else vitestDescribe.skip(`${name} — ${zstdUnavailableMessage}`, fn);
};
