/**
 * Lazy zstd wrappers so bench/cdeb can still be inspected on an unsupported
 * older Node.
 *
 * `zstdCompressSync` is a 22.15.0 API and is used only in this harness, never
 * in src/ or dist/. A named import of it fails the whole module on an older
 * 22, which would force the package floor up to dodge a path users do not
 * run. The published floor is now 22.23.2, so supported runtimes have zstd;
 * the namespace import plus a thrown Error keeps local older-node runs
 * loadable, and the tests skip when the function is missing.
 */
import * as zlib from "node:zlib";

export const ZSTD_REQUIRED_NODE = "22.15.0";

export const hasZstd = typeof zlib.zstdCompressSync === "function";

export const zstdUnavailableMessage =
  `zlib.zstdCompressSync needs Node ${ZSTD_REQUIRED_NODE} or newer; ` +
  "the research harness does not raise the package floor";

const missing = (): Error => new Error(zstdUnavailableMessage);

export const zstdCompressSync = (
  data: Parameters<typeof zlib.zstdCompressSync>[0],
  options?: Parameters<typeof zlib.zstdCompressSync>[1],
): Buffer => {
  if (typeof zlib.zstdCompressSync !== "function") throw missing();
  return zlib.zstdCompressSync(data, options);
};

export const zstdDecompressSync = (
  data: Parameters<typeof zlib.zstdDecompressSync>[0],
  options?: Parameters<typeof zlib.zstdDecompressSync>[1],
): Buffer => {
  if (typeof zlib.zstdDecompressSync !== "function") throw missing();
  return zlib.zstdDecompressSync(data, options);
};

export const zstdConstants = zlib.constants;
