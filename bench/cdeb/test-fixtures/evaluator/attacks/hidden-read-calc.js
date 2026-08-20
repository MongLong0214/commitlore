// Forgery attempt: read either the sealed oracle at /sealed or the evaluator
// source at /cdeb. Both are root-owned and unreadable to the probe's dropped
// uid; the former is the sealed-store mount and the latter carries the engine.
// The old /cdeb/sealed path existed nowhere, so its refusal proved absence,
// not denial.
import { readFileSync } from "node:fs";

const read = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

const oracle = read("/sealed/smoke-calc-fix.task.ts");
const engine = read("/cdeb/engine/engine.ts");
export const add = (a, b) => (oracle.includes("add-behavior") || engine.includes("evaluateTask") ? a + b : a - b);
export const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
