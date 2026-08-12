/**
 * The instant a benchmark evaluates lifecycle against.
 *
 * `buildInjection` takes the instant as an argument and reads no clock, so the
 * product can resolve wall time at its edges while a benchmark pins something
 * reproducible. Pinning matters here: `bench/tasks-ablation` carries `Expires:`
 * dates, and a run whose lifecycle drifted with the calendar would not be
 * comparable to the one recorded beside it.
 *
 * HEAD's commit instant is the value the injector used to default to, so a
 * fixture evaluates exactly as it did before the instant moved to the caller.
 */
import { execFileSync } from "node:child_process";

export const repositoryInstant = (cwd: string): Date => {
  try {
    const raw = execFileSync("git", ["log", "-1", "--format=%cI"], {
      cwd,
      encoding: "utf8",
    }).trim();
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  } catch {
    // A fixture with no commits has no records either, so the instant this
    // stands in for never decides anything.
  }
  return new Date(0);
};
