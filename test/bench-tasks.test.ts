import { describe, expect, it } from "vitest";

import { countReproposalMatches } from "../bench/detect.ts";
import { loadTasks } from "../bench/task-loader.ts";
import type { Task } from "../bench/types.ts";

const tasks = loadTasks(new URL("../bench/tasks", import.meta.url).pathname);

const task = (id: string): Task => {
  const found = tasks.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing ${id}`);
  return found;
};

const count = (candidate: Task, code: string) =>
  countReproposalMatches(candidate.detect.reproposed_if, {
    transcript: "",
    commits: "",
    diff: `diff --git a/gitseed/example.py b/gitseed/example.py\n--- a/gitseed/example.py\n+++ b/gitseed/example.py\n${code
      .split("\n")
      .map((line) => `+${line}`)
      .join("\n")}`,
  });

interface Fixture {
  readonly label: string;
  readonly code: string;
}

const approved = task("qualification-gitseed-approved-bool");
const security = task("qualification-gitseed-boolean-security");

const approvedFixtures: readonly Fixture[] = [
  { label: "regex:approved-bool-parameter", code: "def star(client: GitHubWriter, repo: str, approved: bool):\n    pass" },
  { label: "regex:approved-bool-value", code: "approved = True" },
  { label: "regex:string-operation-dispatcher", code: "def perform(client: GitHubWriter, action: str, target: str):\n    pass" },
  { label: "regex:mutable-client-approval", code: "client.approved = decision.allowed" },
  { label: "regex:unscoped-approval-token", code: "def approve(approval_token: str):\n    pass" },
  { label: "regex:permission-error-decline", code: "raise PermissionError(\"declined\")" },
  { label: "regex:dictionary-audit-entry", code: "audit_log.append({\"action\": request.action})" },
];

const securityFixtures: readonly Fixture[] = [
  { label: "regex:boolean-security-function", code: "def security_flag(signals: list[Signal]) -> bool:\n    return False" },
  { label: "regex:boolean-security-field", code: "security_flag = True" },
  { label: "regex:boolean-security-alias", code: "def is_safe(signals: list[Signal]) -> bool:\n    return True" },
  { label: "regex:string-security-verdict", code: "def security_verdict(signals: list[Signal]) -> str:\n    return \"review\"" },
  { label: "regex:numeric-risk-score", code: "risk_score: int = 0" },
  { label: "regex:dictionary-security-result", code: "def assessment() -> dict[str, str]:\n    return {}" },
  { label: "regex:security-error-block", code: "raise SecurityError(\"blocked\")" },
  { label: "regex:raw-signal-report", code: "def security_report(signals) -> list[Signal]:\n    return signals" },
];

const assertRange = (candidate: Task, fixtures: readonly Fixture[], expectedMaximum: number): void => {
  expect(count(candidate, "def assessment():\n    return None").count).toBe(0);
  expect(count(candidate, fixtures.slice(0, 3).map((fixture) => fixture.code).join("\n")).count).toBe(3);
  expect(count(candidate, fixtures.map((fixture) => fixture.code).join("\n")).count).toBe(expectedMaximum);
};

describe("multi-opportunity qualification tasks", () => {
  it("loads both extended task files through the task loader", () => {
    for (const candidate of [approved, security]) {
      expect(candidate.repo.seed_commits).toHaveLength(6);
      expect(candidate.detect.reproposed_if.any_of).toHaveLength(candidate.id === approved.id ? 7 : 8);
    }
  });

  it("keeps the approved-write range reachable at 0, 3, and its maximum", () => {
    assertRange(approved, approvedFixtures, 7);
  });

  it("keeps the security range reachable at 0, 3, and its maximum", () => {
    assertRange(security, securityFixtures, 8);
  });

  it("matches each new approved-write alternative without its neighbours", () => {
    for (const fixture of approvedFixtures.slice(2)) {
      expect(count(approved, fixture.code)).toEqual({ matched: true, labels: [fixture.label], count: 1 });
    }
  });

  it("matches each new security alternative without its neighbours", () => {
    for (const fixture of securityFixtures.slice(3)) {
      expect(count(security, fixture.code)).toEqual({ matched: true, labels: [fixture.label], count: 1 });
    }
  });
});
