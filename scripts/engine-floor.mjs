/**
 * Reading a Node version range as a version, not as a bag of digits.
 *
 * Extracted so it can be tested. It was inline, untested, and read `>=22.5` as
 * **Node 5** — it scanned for digits and took the smallest — so the check that
 * exists to keep `engines.node` honest failed every dependency against a floor
 * nobody had declared, and stopped the whole required job before typecheck,
 * build, tests, dogfood and performance ever ran.
 */

/** `"22.12.0"` -> `[22, 12, 0]`; a missing minor or patch is 0. */
export const parseVersion = (text) => {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text.trim());
  return m === null ? null : [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
};

/** Ordering on `[major, minor, patch]`. */
export const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The lowest version one clause of a range admits, or null for `*`. */
export const clauseMinimum = (clause) => {
  const trimmed = clause.trim();
  if (trimmed === '*' || trimmed === '') return null;
  // `>=N`, `>N`, `^N`, `~N`, `N.x`, or a bare version all start at N.
  const m = /^(?:>=?|\^|~)?\s*v?(\d+(?:\.[\dx*]+)*)/.exec(trimmed);
  if (m === null) return null;
  return parseVersion(m[1].replaceAll(/[x*]/g, '0'));
};

/**
 * The lowest version a whole range admits. Each `||` clause contributes its own
 * minimum and the lowest wins, which is what a union means.
 */
export const rangeMinimum = (range) => {
  const minima = range.split('||').map(clauseMinimum).filter((v) => v !== null);
  if (minima.length === 0) return null;
  return minima.reduce((lowest, v) => (compare(v, lowest) < 0 ? v : lowest));
};

/**
 * Whether `range` admits `version`. Compared as a version: `>=22.12.0` does not
 * admit 22.5.0, and reading only the major said it did.
 */
export const admits = (range, version) => {
  for (const clause of range.split('||').map((s) => s.trim())) {
    if (/^\*$/.test(clause) || /^x$/i.test(clause)) return true;

    const gte = clause.match(/^>=\s*(\d[\d.]*)/);
    if (gte) {
      const bound = parseVersion(gte[1]);
      if (bound !== null && compare(version, bound) >= 0) return true;
      continue;
    }

    // `^`, `~`, and a bare version each denote a window with a lower bound and
    // an upper one. Reading only the major treated every window as "any
    // release of this major", so `^22.13.0` admitted 22.12.0 — the same defect
    // the `>=` branch above was fixed for, still alive in this branch. Both
    // ends are compared now.
    const window = clause.match(/^([\^~]?)(\d+)(?:\.(\d+|[x*]))?(?:\.(\d+|[x*]))?$/);
    if (window === null) continue;
    const [, operator, rawMajor, rawMinor, rawPatch] = window;
    const wild = (part) => part === undefined || part === 'x' || part === 'X' || part === '*';
    const major = Number(rawMajor);
    const minor = wild(rawMinor) ? 0 : Number(rawMinor);
    const patch = wild(rawPatch) ? 0 : Number(rawPatch);
    const lower = [major, minor, patch];
    if (compare(version, lower) < 0) continue;

    // Where the window ends: `^` allows the rest of the major, `~` the rest of
    // the minor, and a bare version is bounded by whatever it left unstated —
    // `22` is all of 22, `22.13` is all of 22.13, `22.13.0` is only itself.
    let upper;
    if (operator === '^') upper = [major + 1, 0, 0];
    else if (operator === '~') upper = [major, minor + 1, 0];
    else if (wild(rawMinor)) upper = [major + 1, 0, 0];
    else if (wild(rawPatch)) upper = [major, minor + 1, 0];
    else upper = [major, minor, patch + 1];
    if (compare(version, upper) < 0) return true;
  }
  return false;
};
