/**
 * CDEB-06 anti-tamper acceptance (PRD §12.3/§12.5, ticket: "a candidate
 * cannot forge a pass").
 *
 * Every attack here is a real fixture tree or real crafted archive bytes —
 * no mocked attackers. Where a control exists to stop an attack, the test
 * also demonstrates the attack WINS against the forbidden mechanism, so the
 * assertion has teeth: remove the control and the suite flips.
 *
 * Enforcement surfaces, stated per test because they differ:
 *   - structural controls (never trust candidate scripts/verdicts, hermetic
 *     env, hygiene gate) hold on every machine and are exercised fully here;
 *   - kernel controls (network=none, PID/memory caps) belong to the pinned
 *     OCI image; where this sandbox provides them (no network egress in the
 *     execution environment) the failure is genuine, and the test says which
 *     surface it ran on.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { extractTreeArchive, renderArchive, entriesFromDirectory, type ArchiveEntry } from "../bench/cdeb/evaluator/tree.ts";
import { ingestFinalTree } from "../bench/cdeb/evaluator/ingest.ts";
import { runProbe } from "../bench/cdeb/evaluator/probe.ts";
import { freezeFinalTree } from "../bench/cdeb/evaluator/freeze-tree.ts";
import { evaluateLocal } from "../bench/cdeb/evaluator/runner-local.ts";
import {
  buildTree,
  cleanupScratch,
  snapshotFixtures,
  evaluatePrepared,
  expectVerdict,
  fixtureFile,
  prepareRun,
  SEALED_DIR,
  TASK_ID,
  tempDir,
  TEST_IMAGE_DIGEST,
} from "./cdeb-evaluator-helpers.ts";

const fixtureSnapshot = snapshotFixtures();

afterAll(() => {
  cleanupScratch();
  expect(snapshotFixtures()).toEqual(fixtureSnapshot);
});

/* -------------------------------------------------------------------------- */
/* Raw ustar writer for MALFORMED archives. renderArchive refuses to          */
/* serialize attacks, which is exactly why crafted bytes need their own pen.  */
/* -------------------------------------------------------------------------- */

const rawUstar = (entries: { name: string; typeflag: string; content?: Buffer; linkname?: string }[]): Buffer => {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    Buffer.from(entry.name, "utf8").copy(header, 0);
    Buffer.from("0000644", "ascii").copy(header, 100);
    Buffer.from("0000000", "ascii").copy(header, 108);
    Buffer.from("0000000", "ascii").copy(header, 116);
    const size = entry.content?.length ?? 0;
    Buffer.from(size.toString(8).padStart(11, "0"), "ascii").copy(header, 124);
    Buffer.from("00000000000", "ascii").copy(header, 136);
    header.write(entry.typeflag, 156, "ascii");
    if (entry.linkname !== undefined) Buffer.from(entry.linkname, "utf8").copy(header, 157);
    header.write("ustar", 257, "ascii");
    header.write("00", 263, "ascii");
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, "0"), 148, "ascii");
    header.writeUInt8(0, 154);
    header.writeUInt8(0x20, 155);
    chunks.push(header);
    if (size > 0) {
      chunks.push(entry.content!);
      const pad = (512 - (size % 512)) % 512;
      if (pad > 0) chunks.push(Buffer.alloc(pad));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
};

/** The good tree's entries, as a base for splicing attack entries into. */
const goodEntries = (): ArchiveEntry[] => {
  const tree = buildTree("entries-base", { "src/calc.js": fixtureFile("patches", "good", "calc.js") });
  const files = ["package.json", "README.md", "src/calc.js", "test/calc.test.js"];
  return entriesFromDirectory(tree, files);
};

const archiveToFile = (label: string, bytes: Buffer): string => {
  const path = join(tempDir(label), "final-tree.tar");
  writeFileSync(path, bytes);
  return path;
};

/**
 * Pipeline-level run of a CRAFTED archive (no claimed OID — the attack bytes
 * are the whole input, exactly as the orchestrator would hand them over).
 */
const evaluateCrafted = (archivePath: string) =>
  evaluateLocal({
    tasksDir: SEALED_DIR,
    taskId: TASK_ID,
    archivePath,
    imageDigest: TEST_IMAGE_DIGEST,
    timeoutMs: 90_000,
  });

/* -------------------------------------------------------------------------- */
/* Forgery                                                                    */
/* -------------------------------------------------------------------------- */

describe("package/test-script tamper (§12.5: 결과 조작 실패)", () => {
  const forgeOverrides = {
    "src/calc.js": fixtureFile("attacks", "forge-scripts", "calc.js"),
    "package.json": fixtureFile("attacks", "forge-scripts", "package.json"),
    "forge-pass.js": fixtureFile("attacks", "forge-scripts", "forge-pass.js"),
    "forged-evaluator.json": fixtureFile("attacks", "forge-scripts", "forged-evaluator.json"),
    ".cdeb/oracles/verdict.json": fixtureFile("attacks", "forge-scripts", ".cdeb", "oracles", "verdict.json"),
  };

  it("the forbidden mechanism is fooled; the evaluator is not", () => {
    const tree = buildTree("forge-naive", forgeOverrides);

    // Teeth: an evaluator that trusts the candidate's `npm test` — the exact
    // mechanism §12.3 prohibits — exits 0 and calls this tree a pass.
    const naive = spawnSync("npm", ["test", "--silent"], { cwd: tree, encoding: "utf8", timeout: 60_000 });
    expect(naive.status).toBe(0);
    expect(naive.stdout).toContain("12/12 tests passed");

    // The real pipeline judges the same tree a functional failure.
    const run = prepareRun("forge", tree);
    const verdict = expectVerdict(evaluatePrepared(run));
    expect(verdict.functional_pass).toBe(false);
    expect(verdict.functional_checks.failed).toBeGreaterThan(0);
  });

  it("forged verdict files in the tree are inert bytes", () => {
    const run = prepareRun("forge-again", buildTree("forge-again", forgeOverrides));
    const first = evaluatePrepared(run);
    const verdict = expectVerdict(first);
    // The forged file claims functional_pass true; the verdict says false.
    expect(verdict.functional_pass).toBe(false);
    expect(verdict.evaluator_image_digest).not.toBe("sha256:" + "0".repeat(64));
    // And the forgery cannot even make the verdict shape diverge.
    const forged = JSON.parse(fixtureFile("attacks", "forge-scripts", "forged-evaluator.json")) as Record<string, unknown>;
    expect(verdict.functional_pass).not.toBe(forged.functional_pass);
  });

  it("the forged tree still evaluates deterministically to FAIL", () => {
    const run = prepareRun("forge-det", buildTree("forge-det", forgeOverrides));
    const first = evaluatePrepared(run);
    const second = evaluatePrepared(run);
    expect(first.rawStdout.equals(second.rawStdout)).toBe(true);
    expect(expectVerdict(second).functional_pass).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Hidden paths, secrets, network                                             */
/* -------------------------------------------------------------------------- */

describe("hidden evaluator path read attempt (§12.5)", () => {
  it("a probe that reads the sealed store fails the evaluation", () => {
    const run = prepareRun(
      "hidden-read",
      buildTree("hidden-read", { "src/calc.js": fixtureFile("attacks", "hidden-read-calc.js") }),
    );
    const verdict = expectVerdict(evaluatePrepared(run));
    expect(verdict.functional_pass).toBe(false);
    expect(verdict.decision_oracle_code).toBe("SAFE");
  });

  it("probe env/argv/cwd leak no sealed-store location or host secret names", () => {
    // Teeth: poison the outer environment first — if the probe inherited
    // anything, the secret value would appear in the printed bytes.
    process.env.CDEB_STUDY_SECRET = "hunter2";
    process.env.NODE_OPTIONS = "--max-old-space-size=4321";
    try {
    const tree = buildTree("leak", { "src/calc.js": fixtureFile("attacks", "leak-calc.js") });
    const frozen = freezeFinalTree(tree, tempDir("leak-freeze"));
    const ingested = ingestFinalTree(frozen.archive_zst, tempDir("leak-ingest"));
    const result = runProbe(
      { argv: ["-e", "await import('./src/calc.js')"], expect_exit: 0, timeout_ms: 8_000 },
      { treeRoot: ingested.root, scratchDir: tempDir("leak-scratch") },
    );
    expect(result.exit_code).toBe(0);
    const leaked = JSON.parse(result.stdout.trim()) as {
      env: string[]; nodeOptions: string | null; secret: string | null; argv: string[]; cwd: string;
    };
    expect(leaked.env).not.toContain("CDEB_STUDY_SECRET");
    expect(leaked.env).not.toContain("AWS_SECRET_ACCESS_KEY");
    // NODE_OPTIONS is pinned empty by the hermetic env — present and empty,
    // never inherited from whatever the host set.
    expect(leaked.nodeOptions).toBe("");
    expect(leaked.secret).toBeNull();
    for (const arg of leaked.argv) expect(arg).not.toContain("sealed");
    expect(leaked.cwd).toBe(ingested.root);
    } finally {
      delete process.env.CDEB_STUDY_SECRET;
      delete process.env.NODE_OPTIONS;
    }
  });
});

describe("host secret read attempt (§12.5)", () => {
  it("a secret in the outer environment never reaches the verdict", () => {
    const run = prepareRun(
      "secret",
      buildTree("secret", { "src/calc.js": fixtureFile("attacks", "secret-env-calc.js") }),
    );
    // With the secret visible to the TEST process: if the runner inherited
    // anything, add would start working and this tree would pass.
    const verdict = expectVerdict(evaluatePrepared(run, { env: { CDEB_STUDY_SECRET: "hunter2" } }));
    expect(verdict.functional_pass).toBe(false);
  });
});

describe("network access attempt (§12.5)", () => {
  it("network-gated behavior evaluates to FAIL", () => {
    // Study surface: `docker run --network none` (runner-oci.ts). Development
    // surface here: the execution sandbox denies egress, so the fetch fails
    // genuinely (ENOTFOUND). On a daemon-less dev machine WITH egress this
    // fixture would still gate the verdict on the fetch result — the OCI
    // control is what makes the guarantee absolute, and the row surface says
    // which one produced it.
    const run = prepareRun(
      "network",
      buildTree("network", { "src/calc.js": fixtureFile("attacks", "network-calc.js") }),
    );
    const verdict = expectVerdict(evaluatePrepared(run));
    expect(verdict.functional_pass).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Resource abuse                                                             */
/* -------------------------------------------------------------------------- */

describe("resource abuse (§12.5: 제한됨)", () => {
  it("a probe that spins is killed by the timeout and judged FAIL", () => {
    const run = prepareRun("hog", buildTree("hog", { "src/calc.js": fixtureFile("attacks", "hog-calc.js") }));
    const started = Date.now();
    const verdict = expectVerdict(evaluatePrepared(run, { timeoutMs: 90_000 }));
    const elapsed = Date.now() - started;
    expect(verdict.functional_pass).toBe(false);
    expect(verdict.functional_checks.failed).toBeGreaterThan(0);
    // The timeout (4s per probe in the sealed task) bounds the evaluation,
    // with margin for process startup — it is not the machine's patience.
    expect(elapsed).toBeLessThan(45_000);
  });
});

/* -------------------------------------------------------------------------- */
/* Archive hygiene gate                                                       */
/* -------------------------------------------------------------------------- */

describe("archive hygiene gate", () => {
  it("a symlink escaping the tree is refused, unit and pipeline", () => {
    const bytes = renderArchive([
      ...goodEntries(),
      { path: "leak", type: "symlink", content: Buffer.alloc(0), linkTarget: "../../../../../../../etc/passwd", executable: false },
    ]);
    const unit = extractTreeArchive(bytes, tempDir("sym-unit"));
    expect(unit.refusal?.code).toBe("symlink-escapes-tree");

    const path = archiveToFile("sym-pipe", bytes);
    const verdict = expectVerdict(evaluateCrafted(path));
    expect(verdict.functional_pass).toBe(false);
    expect(verdict.functional_checks.failed).toBeGreaterThan(0);
  });

  it("a path-traversal entry is refused", () => {
    const bytes = rawUstar([
      { name: "../outside.js", typeflag: "0", content: Buffer.from("payload") },
      { name: "src/calc.js", typeflag: "0", content: Buffer.from(fixtureFile("patches", "good", "calc.js")) },
    ]);
    const unit = extractTreeArchive(bytes, tempDir("trav-unit"));
    expect(unit.refusal?.code).toBe("path-escapes-tree");
  });

  it("a smuggled .git is refused before git ever runs in the tree", () => {
    const bytes = rawUstar([
      { name: ".git/config", typeflag: "0", content: Buffer.from("[core]\n\tfsmonitor = /evil/hook\n") },
      { name: "src/calc.js", typeflag: "0", content: Buffer.from(fixtureFile("patches", "good", "calc.js")) },
    ]);
    const unit = extractTreeArchive(bytes, tempDir("git-unit"));
    expect(unit.refusal?.code).toBe("dot-git-smuggled");

    const path = archiveToFile("git-pipe", bytes);
    const verdict = expectVerdict(evaluateCrafted(path));
    expect(verdict.functional_pass).toBe(false);
  });

  it("hardlinks and special files are refused", () => {
    const hard = rawUstar([{ name: "link", typeflag: "1", linkname: "src/calc.js" }]);
    expect(extractTreeArchive(hard, tempDir("hard-unit")).refusal?.code).toBe("hardlink-refused");
    const fifo = rawUstar([{ name: "fifo", typeflag: "6" }]);
    expect(extractTreeArchive(fifo, tempDir("fifo-unit")).refusal?.code).toBe("special-file-refused");
    const pax = rawUstar([{ name: "pax", typeflag: "x", content: Buffer.from("10 a=b\n") }]);
    expect(extractTreeArchive(pax, tempDir("pax-unit")).refusal?.code).toBe("pax-or-gnu-extension-refused");
  });

  it("bombs hit the caps", () => {
    const manyFiles = rawUstar(
      Array.from({ length: 20_001 }, (_, index) => ({
        name: `f${String(index).padStart(6, "0")}.txt`,
        typeflag: "0",
        content: Buffer.from("x"),
      })),
    );
    expect(extractTreeArchive(manyFiles, tempDir("bomb-files")).refusal?.code).toBe("too-many-files");

    const bigFile = renderArchive([
      { path: "big.bin", type: "file", content: Buffer.alloc(9 * 1024 * 1024, 1), linkTarget: "", executable: false },
    ]);
    expect(extractTreeArchive(bigFile, tempDir("bomb-size")).refusal?.code).toBe("file-too-large");
  });

  it("a claimed OID that does not match the recomputed one is refused", () => {
    const run = prepareRun("oid", buildTree("oid", { "src/calc.js": fixtureFile("patches", "good", "calc.js") }));
    const verdict = expectVerdict(evaluatePrepared(run, { claimedOid: "a".repeat(40) }));
    expect(verdict.functional_pass).toBe(false);
    expect(verdict.candidate_tree_oid).toBe(run.frozen.final_tree_oid);

    const ingested = ingestFinalTree(readFileSync(run.archivePath), tempDir("oid-unit"), { claimedOid: "a".repeat(40) });
    expect(ingested.refusal?.code).toBe("tree-oid-mismatch");
  });
});
