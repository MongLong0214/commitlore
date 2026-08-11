/**
 * CDEB-06: the hermetic environment every evaluator process and probe runs
 * under (PRD §12.2 "deterministic locale/timezone", "no host HOME, no host
 * secrets").
 *
 * The environment is an ALLOWLIST, built from scratch for each run:
 *
 *   - nothing from the host environment is inherited — a secret, a proxy, a
 *     NODE_OPTIONS, a TZ set on the study machine never reaches the verdict;
 *   - HOME and TMPDIR point inside the run's scratch, so `~/.ssh`,
 *     `~/.aws` and friend do not exist as far as candidate code can see;
 *   - TZ/LC_ALL/LANG are pinned so no locale or timezone can change what a
 *     probe prints;
 *   - the git config pointers stay at /dev/null so the staging in git-tree.ts
 *     and any git a probe happens to run read no host configuration.
 *
 * What this cannot close on a bare host: kernel-level filesystem and network
 * isolation. That is the OCI runner's job (runner-oci.ts: `--network none`,
 * read-only mounts, no host HOME). The local runner documents itself as the
 * qualification surface, not the study's containment.
 */

export interface HermeticEnvOptions {
  /** Scratch directory that becomes HOME and TMPDIR for the run. */
  readonly scratchDir: string;
  /** Directory containing the node executable the probes may use. */
  readonly nodeBinDir: string;
}

export const hermeticEnv = (options: HermeticEnvOptions): Record<string, string> => ({
  PATH: `${options.nodeBinDir}:/usr/bin:/bin`,
  HOME: options.scratchDir,
  TMPDIR: options.scratchDir,
  TZ: "UTC",
  LC_ALL: "C",
  LANG: "C",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  // Explicit empties beat absence: a probe checking `key in process.env`
  // sees the same shape on every machine.
  NODE_OPTIONS: "",
  NODE_EXTRA_CA_CERTS: "",
  http_proxy: "",
  https_proxy: "",
  HTTP_PROXY: "",
  HTTPS_PROXY: "",
  NO_PROXY: "",
});

/** Names the local runner strips and the OCI runner never mounts. */
export const HOST_SECRETS_NEVER_PASSED = [
  "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "GITHUB_TOKEN", "GH_TOKEN",
  "NPM_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DOCKER_HOST",
] as const;
