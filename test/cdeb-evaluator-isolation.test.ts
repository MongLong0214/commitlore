/**
 * CDEB-06 acceptance: no network, no secrets, no host access (PRD §26,
 * §12.2/§12.5).
 *
 * Two surfaces, tested for what each actually proves:
 *
 *   - the LOCAL runner (runner-local.ts) builds the verdict process's
 *     environment from an allowlist, so host secrets, proxy variables, TZ
 *     and NODE_OPTIONS cannot reach a probe. The tests here plant those
 *     values in the host process and assert they never reach the verdict —
 *     removing the allowlist (e.g. spreading `process.env`) flips them.
 *   - kernel-level containment (network, filesystem, resources) belongs to
 *     the pinned OCI image. It is asserted as the EXACT `docker run` argv
 *     contract of runner-oci.ts — every §12.2 control is visible as a flag —
 *     plus the fail-closed refusal to run without a daemon. This machine
 *     runs no container; nothing here simulates one.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { afterAll, expect, it } from 'vitest';

import { describeZstd as describe } from './cdeb-zstd.ts';

import { HOST_SECRETS_NEVER_PASSED, hermeticEnv } from '../bench/cdeb/evaluator/env.ts';
import { ingestFinalTree } from '../bench/cdeb/evaluator/ingest.ts';
import { runProbe } from '../bench/cdeb/evaluator/probe.ts';
import {
  buildEvaluatorRunArgs,
  dockerDaemonAvailable,
  EvaluatorRuntimeUnavailable,
  EVALUATOR_RESOURCE_LIMITS,
  runEvaluatorOci,
} from '../bench/cdeb/evaluator/runner-oci.ts';
import {
  SEALED_DIR,
  TASK_ID,
  TEST_IMAGE_DIGEST,
  buildTree,
  cleanupScratch,
  evaluatePrepared,
  expectVerdict,
  fixtureFile,
  prepareRun,
  tempDir,
} from './cdeb-evaluator-helpers.ts';

afterAll(() => {
  cleanupScratch();
});

describe('CDEB-06 isolation: network and secrets cannot reach the verdict', () => {
  it('a tree that phones home is judged FAIL', () => {
    // The fixture only works when a fetch to `cdeb-exfil.invalid` succeeds.
    // RFC 2606 reserves `.invalid` for names that cannot resolve, so the
    // fixture fails identically on a networked host and under the image's
    // `--network none` — and if some resolver ever lies about that, this
    // test fails, which is the point: the verdict must not depend on reach.
    const tree = buildTree('network', { 'src/calc.js': fixtureFile('attacks/network-calc.js') });
    const verdict = expectVerdict(evaluatePrepared(prepareRun('network', tree)));
    expect(verdict.functional_pass).toBe(false);
    expect(verdict.functional_checks.failed).toBeGreaterThan(0);
  });

  it('a host secret planted for the run never reaches a probe', () => {
    // The fixture implements `add` correctly ONLY when CDEB_STUDY_SECRET is
    // visible in the probe environment. The value is planted in this
    // process's environment for the duration of the evaluation; the
    // hermetic allowlist must keep it out. Spreading `process.env` into the
    // probe environment would make the probe see the secret, fix `add`, and
    // flip this verdict to PASS.
    const tree = buildTree('secret-env', { 'src/calc.js': fixtureFile('attacks/secret-env-calc.js') });
    const run = prepareRun('secret-env', tree);
    const verdict = expectVerdict(
      evaluatePrepared(run, { env: { CDEB_STUDY_SECRET: 'planted-secret-must-not-reach-probe' } }),
    );
    expect(verdict.functional_pass).toBe(false);
    expect(verdict.functional_checks.failed).toBeGreaterThan(0);
  });

  it('the hermetic environment is a frozen allowlist carrying no secrets', () => {
    const env = hermeticEnv({ scratchDir: '/scratch', nodeBinDir: '/node/bin' });
    expect(Object.keys(env).sort()).toEqual(
      [
        'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_TERMINAL_PROMPT',
        'HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'LANG', 'LC_ALL',
        'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'NO_PROXY', 'PATH',
        'TMPDIR', 'TZ', 'http_proxy', 'https_proxy',
      ].sort(),
    );
    for (const secret of HOST_SECRETS_NEVER_PASSED) {
      expect(env).not.toHaveProperty(secret);
    }
    expect(env.HOME).toBe('/scratch');
    expect(env.TMPDIR).toBe('/scratch');
    expect(env.TZ).toBe('UTC');
    expect(env.LC_ALL).toBe('C');
    expect(env.PATH).toBe('/node/bin:/usr/bin:/bin');
    expect(env.NODE_OPTIONS).toBe('');
  });

  it('a leak probe sees the allowlist, not the host', () => {
    // The fixture prints everything its process can see (env keys, argv,
    // cwd). Asserting on those bytes is the proof that the probe inherits
    // the allowlist and nothing host-shaped: no secret names, no real HOME,
    // no sealed-store path.
    const tree = buildTree('leak', { 'leak-calc.js': fixtureFile('attacks/leak-calc.js') });
    const run = prepareRun('leak', tree);
    const probeScratch = tempDir('leak-probe');
    const ingested = ingestFinalTree(readFileSync(run.archivePath), tempDir('leak-ingest'), {
      claimedOid: run.frozen.final_tree_oid,
    });
    expect(ingested.refusal).toBeNull();
    const probe = runProbe(
      { argv: ['leak-calc.js'], expect_exit: 0 },
      { treeRoot: ingested.root, scratchDir: probeScratch },
    );
    expect(probe.exit_code).toBe(0);
    const leaked = JSON.parse(probe.stdout.trim()) as {
      env: string[];
      argv: string[];
      cwd: string;
    };
    // Every key the evaluator passes must arrive; nothing host-shaped may
    // join them. On macOS the platform itself injects one variable into
    // every new process (__CF_USER_TEXT_ENCODING); it carries no secret and
    // no path, and does not exist on the Linux image the study runs in.
    const allowlist = new Set(Object.keys(hermeticEnv({ scratchDir: probeScratch, nodeBinDir: '' })));
    const platformInjected = process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : [];
    for (const key of allowlist) expect(leaked.env).toContain(key);
    for (const key of leaked.env) {
      expect(allowlist.has(key) || platformInjected.includes(key), `unexpected env key ${key}`).toBe(true);
    }
    for (const secret of HOST_SECRETS_NEVER_PASSED) {
      expect(leaked.env).not.toContain(secret);
    }
    expect(leaked.cwd).toBe(ingested.root);
    expect(probe.stdout).not.toContain(homedir());
    expect(probe.stdout).not.toContain(SEALED_DIR);
  });

  it('a tree that reads the sealed store path is judged FAIL', () => {
    // The fixture readFileSyncs /cdeb/sealed/<task>.task.ts and hard-codes
    // what it finds. Locally the path does not exist; inside the pinned
    // image it exists but is unreadable by the probe's dropped uid/gid
    // (probe.ts, PROBE_UID). Either way the probe fails, and so does the
    // tree. A readable sealed path here would be a host misconfiguration
    // the next assertion names.
    const tree = buildTree('hidden-read', { 'src/calc.js': fixtureFile('attacks/hidden-read-calc.js') });
    const verdict = expectVerdict(evaluatePrepared(prepareRun('hidden-read', tree)));
    expect(verdict.functional_pass).toBe(false);
    expect(verdict.functional_checks.failed).toBeGreaterThan(0);
    expect(existsSync('/cdeb/sealed/smoke-calc-fix.task.ts')).toBe(false);
  });
});

describe('CDEB-06 isolation: the OCI containment contract', () => {
  it('the pinned-image argv carries every §12.2 control, exactly', () => {
    const args = buildEvaluatorRunArgs({
      imageRef: 'registry.example/cdeb-evaluator@sha256:deadbeef',
      archivePath: '/host/run/final-tree.tar.zst',
      tasksDir: '/host/sealed',
      taskId: TASK_ID,
      claimedOid: 'a'.repeat(40),
      imageDigest: TEST_IMAGE_DIGEST,
    });
    expect(args).toEqual([
      'run', '--rm', '--interactive',
      '--network', 'none',
      '--read-only',
      '--tmpfs', `/tmp:rw,noexec,nosuid,size=${String(EVALUATOR_RESOURCE_LIMITS.tmpfs_size_mb)}m`,
      '--cpus', String(EVALUATOR_RESOURCE_LIMITS.cpu_limit),
      '--memory', `${String(EVALUATOR_RESOURCE_LIMITS.memory_mb)}m`,
      '--memory-swap', `${String(EVALUATOR_RESOURCE_LIMITS.memory_mb)}m`,
      '--pids-limit', String(EVALUATOR_RESOURCE_LIMITS.pids_limit),
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--env', 'TZ=UTC',
      '--env', 'LC_ALL=C',
      '--env', 'HOME=/tmp',
      '--mount', 'type=bind,source=/host/run/final-tree.tar.zst,target=/input/tree.tar.zst,readonly',
      '--mount', 'type=bind,source=/host/sealed,target=/sealed,readonly',
      'registry.example/cdeb-evaluator@sha256:deadbeef',
      // No `/cdeb/evaluate` here: the image's ENTRYPOINT is that script, so
      // everything after the image reference is its argv. This array used to
      // carry it, which is why the runner passing the entrypoint to itself went
      // unnoticed -- the expectation was written from the code rather than from
      // a container that had started.
      '--tasks', '/sealed',
      '--task', TASK_ID,
      '--tree', '/input/tree.tar.zst',
      '--claimed-oid', 'a'.repeat(40),
      '--image-digest', TEST_IMAGE_DIGEST,
    ]);
    // The semantic content of the exact list, stated greppably: no network,
    // immutable rootfs, both inputs mounted read-only, and nothing else
    // mounted — no host HOME, no docker socket, no writable volume.
    const joined = args.join(' ');
    expect(joined).toContain('--network none');
    expect(joined).toContain('--read-only');
    expect(joined.match(/readonly/g) ?? []).toHaveLength(2);
    expect(args).not.toContain('--volume');
    expect(args).not.toContain('-v');
    expect(joined).not.toContain('/var/run/docker.sock');
    expect(joined).not.toContain(homedir());
  });

  it.skipIf(dockerDaemonAvailable())(
    'without a reachable daemon the OCI runner refuses instead of downgrading',
    () => {
      expect(() =>
        runEvaluatorOci({
          imageRef: 'registry.example/cdeb-evaluator@sha256:deadbeef',
          archivePath: '/nonexistent/tree.tar.zst',
          tasksDir: '/nonexistent/sealed',
          taskId: TASK_ID,
        }),
      ).toThrow(EvaluatorRuntimeUnavailable);
    },
  );
});
