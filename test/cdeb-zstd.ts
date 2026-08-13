/**
 * Skip seam for bench/cdeb tests that need zlib.zstdCompressSync (Node 22.15.0).
 * The package floor is 22.23.2, which includes zstd. This seam still makes
 * local runs on unsupported older Nodes report a skip rather than a load error.
 */
import { describe as vitestDescribe } from "vitest";

import { hasZstd, zstdUnavailableMessage } from "../bench/cdeb/runtime/zstd.ts";

export { hasZstd, zstdUnavailableMessage };

export const describeZstd = (name: string, fn: () => void): void => {
  if (hasZstd) vitestDescribe(name, fn);
  else vitestDescribe.skip(`${name} — ${zstdUnavailableMessage}`, fn);
};
