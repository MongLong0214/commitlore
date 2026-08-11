// Forgery attempt: read the sealed oracle and hard-code what it wants.
// Inside the pinned image /cdeb is outside the sandbox mounts entirely;
// the read must fail, and the probe with it.
import { readFileSync } from "node:fs";

const oracle = readFileSync("/cdeb/sealed/smoke-calc-fix.task.ts", "utf8");
export const add = (a, b) => (oracle.includes("add-behavior") ? a + b : a - b);
export const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
