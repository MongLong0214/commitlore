/**
 * Capture policy — the single definition of the policy defaults and the policy
 * identity hash (T-1110, acceptance row B-7 / matrix row P1-5, ADR-0021 §7).
 *
 * This file exists because the definition used to exist three times. At
 * `da1c733` `computePolicyIdentityHash` and its defaults object were declared
 * independently in `capture-prepare.ts`, `capture-stage.ts` and
 * `prepare-commit-msg.ts` — under two different constant names — and agreed only
 * because the three object literals happened to list the same three keys in the
 * same order. Key order is what `JSON.stringify` serialises, and nothing tested
 * that the three agreed.
 *
 * That matters more than duplication usually does. The hook compares the hash it
 * computes against the one `prepare` wrote into the pending file. If the two
 * sites disagree, the hook reports a policy change that never happened, and the
 * user sees a capture declined for a reason that is not true.
 *
 * ADR-0021 fixed the migration before the file existed: with no policy file the
 * identity is `sha256(canonical-defaults-json)`; with one it is
 * `sha256(file-contents)`. The pending format needs no version bump either way,
 * which is why `PendingRecord.version` stays `1`.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { execGit } from './git.js';

// ---------------------------------------------------------------------------
// The policy itself
// ---------------------------------------------------------------------------

/**
 * `mode` is a closed set. Adding a member is a decision, not a config change.
 *
 * `suggest` says a capture produces a candidate rather than committing one on
 * its own, and that much holds: nothing here writes a record without a host
 * driving prepare → verify → stage. What it does **not** say is that a human
 * saw the candidate. The pending transaction's phases are
 * `prepared → verified → staged → applied → consumed` (ADR-0021 §2) — there is
 * no `approved` phase, no rejection state and no approval token — so no code
 * path here can tell a record a user kept from one that was never shown.
 * `stageCaptureRecord` checks the phase, the record count, HEAD, the staged
 * diff, the staged tree and this policy's identity. It cannot check for consent,
 * because consent is not something the transaction can hold.
 *
 * The prompt therefore lives in the host: `skills/commitlore-commits/SKILL.md`
 * asks before it calls stage. A host that stages without asking violates no
 * check in this repository and is within contract. Read `suggest` as a
 * convention this project documents and its own skill follows, not an enforced
 * one — ADR-0028 records why the line sits there and what moving it would cost.
 */
/**
 * What capture does with a candidate record (ADR-0030).
 *
 * - `auto` — stage it without asking. The default. Every record staged this way
 *   is marked `Provenance: drafted` and can never grade above `claim`, because
 *   nobody read it (see `capture-stage.ts`).
 * - `suggest` — draft it and leave staging to the host, which may ask first.
 *   What this repository shipped before ADR-0030, kept for a host that wants
 *   the prompt. `stage` still cannot tell whether anyone was asked, so a record
 *   staged in this mode carries whatever provenance it was drafted with.
 * - `off` — capture nothing. `prepare` refuses, so no transcript is hashed and
 *   no candidate exists.
 */
export type CaptureMode = 'auto' | 'suggest' | 'off';

export const CAPTURE_MODES: readonly CaptureMode[] = ['auto', 'suggest', 'off'];

export interface CapturePolicy {
  mode: CaptureMode;
  /**
   * Consent to capture without asking (ADR-0030, #511). Off unless a
   * repository sets it, and honoured only in `auto` mode: `suggest` exists to
   * ask, `off` captures nothing, and a consent neither mode can honour is a
   * configuration error rather than a silent no-op. The declaration a capture
   * makes against it is checked in `capture-prepare.ts`; the grading cap that
   * keeps an unread record from directing lives in `grade.ts`.
   */
  unattended: boolean;
  max_records_per_commit: number;
  require_verified_evidence: boolean;
}

/**
 * Key order is load-bearing: it is the input to `JSON.stringify` and therefore
 * to the identity hash. Reordering these three lines changes the digest every
 * pending file in flight was written with. See `test/capture-policy.test.ts`,
 * which pins the value.
 */
export const POLICY_DEFAULTS: CapturePolicy = {
  mode: 'auto',
  // Off by default and deliberately so: a repository that never set this must
  // capture exactly as it did before the setting existed (#511). Turning it on
  // is a separate decision with its own evidence — shipping the switch is not
  // flipping it.
  unattended: false,
  max_records_per_commit: 1,
  require_verified_evidence: true,
};

/** The only keys a policy file may set. An unknown key is rejected, not merged. */
export const POLICY_KEYS = [
  'mode',
  'unattended',
  'max_records_per_commit',
  'require_verified_evidence',
] as const;

/**
 * The policy a repository commits, and the overlay one machine keeps.
 *
 * PRD-F13 requirement 11 allows either a single location or a stated
 * precedence. This was a single location until #709 — an ambiguous precedence
 * is worse than a missing feature — and is now the second option, stated:
 *
 *     .commitlore-policy.local.json   per key, wins
 *     .commitlore-policy.json         repository default
 *     POLICY_DEFAULTS                 built in
 *
 * What changed the answer is that refusing the overlay never prevented a
 * contributor from differing. It converted the difference into a permanently
 * modified tracked file — the report in #709 is a release script refusing to
 * tag a worktree dirtied exactly that way. Every tool that keeps a shared
 * config in the tree gives the operator a layer that wins for the same reason:
 * the committed file says what the project wants, and the operator's machine is
 * not the project's to command.
 *
 * Per key, not per file: an overlay that sets only `unattended` leaves `mode`
 * and `max_records_per_commit` as the repository set them, so it says "this
 * machine differs about that" and nothing more.
 */
export const POLICY_FILE_NAME = '.commitlore-policy.json';

/**
 * The overlay. Untracked by convention — nothing here writes a `.gitignore`
 * entry for it, because a tool that hides a file on a repository's behalf has
 * decided for the repository what it may not see.
 */
export const POLICY_LOCAL_FILE_NAME = '.commitlore-policy.local.json';

/** A key a policy file may set. */
export type PolicyKey = (typeof POLICY_KEYS)[number];

// ---------------------------------------------------------------------------
// Canonical bytes
// ---------------------------------------------------------------------------

/**
 * The canonical bytes for a policy file: `POLICY_KEYS` order, two-space
 * indent, trailing newline. Every write goes through this, so the writers that
 * exist — `auto on/off` and `init` — cannot drift apart on shape, and a file
 * this function produces is never rejected by `validate` below.
 *
 * It is also the identity input for an effective policy (see
 * `computeEffectivePolicyIdentityHash`), which is why it sits above the hashes
 * rather than beside the writers it serves.
 */
const serializePolicyFile = (policy: CapturePolicy): string => {
  const ordered: Record<string, unknown> = {};
  for (const key of POLICY_KEYS) ordered[key] = policy[key];
  return `${JSON.stringify(ordered, null, 2)}\n`;
};

/**
 * The canonical bytes for an overlay: the same order and shape, but only the
 * keys it sets. Writing the whole policy here would pin every key on this
 * machine, so a later change to the committed file would stop applying — the
 * opposite of what per-key precedence promises.
 */
const serializePolicyOverlay = (set: Partial<CapturePolicy>): string => {
  const ordered: Record<string, unknown> = {};
  for (const key of POLICY_KEYS) if (key in set) ordered[key] = set[key];
  return `${JSON.stringify(ordered, null, 2)}\n`;
};

// ---------------------------------------------------------------------------
// Identity hash
// ---------------------------------------------------------------------------

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

/**
 * The identity of a policy that came from the defaults.
 *
 * `JSON.stringify` over an object literal whose keys are declared in
 * `POLICY_DEFAULTS`' order — the exact expression the three former call sites
 * used, preserved so that consolidation is a no-op on the digest.
 *
 * `unattended` is deliberately absent (#511). The setting can only be turned
 * on by a policy file, and a file's identity is its own bytes — so every
 * identity the setting can change is hashed already. Putting a fixed-false
 * default into this digest too would refuse every capture in flight across the
 * upgrade in every repository that never opted in: a policy change that never
 * happened, the exact false positive this hash exists to avoid. If the default
 * ever becomes `true`, this input must move with it.
 */
export const computePolicyIdentityHash = (policy: CapturePolicy = POLICY_DEFAULTS): string =>
  sha256(
    JSON.stringify({
      mode: policy.mode,
      max_records_per_commit: policy.max_records_per_commit,
      require_verified_evidence: policy.require_verified_evidence,
    }),
  );

/**
 * The identity of a policy that came from a file: the bytes as written.
 *
 * Hashing the contents rather than the parsed object is ADR-0021's choice, and
 * it is the stronger one — a reformat that changes nothing semantically still
 * changes the identity, so the hook reports "the policy file changed", which is
 * true.
 */
export const computePolicyFileIdentityHash = (contents: string): string => sha256(contents);

/**
 * The identity of a policy two files decided between them (#709).
 *
 * Neither file's bytes describe what ran, so the digest is taken over the
 * effective policy in canonical form. A pending transaction stamps this hash;
 * without it a record prepared under an overlay would carry provenance naming
 * a policy that did not produce it — a record misreporting the conditions of
 * its own capture, which is worse than the gap #709 closes.
 *
 * `unattended` is an input here, unlike `computePolicyIdentityHash` above. The
 * exclusion there rests on a file's identity being its own bytes, so every
 * identity the setting can change is hashed already. An overlay breaks that
 * premise: it can turn the setting on from a file whose bytes are not the
 * digest input, so the value has to travel in the digest itself.
 *
 * Computed only when an overlay is present, which is what keeps the digest of
 * every repository without one byte-identical to what it was before this
 * existed. Adding an overlay does change the digest — including an empty one
 * over a file whose bytes are not canonical — and that is correct: a capture in
 * flight across the change is rejected with "policy identity changed since
 * prepare", because it was.
 */
export const computeEffectivePolicyIdentityHash = (policy: CapturePolicy): string =>
  sha256(serializePolicyFile(policy));

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface PolicyResolution {
  /** False when a policy file exists but could not be used. */
  ok: boolean;
  /** The policy that applies: the committed file with the overlay laid over it. */
  policy: CapturePolicy;
  identityHash: string;
  /**
   * Which layer had the last word. `local` whenever the overlay was read, even
   * when it changed nothing — its presence is what explains the identity hash.
   */
  source: 'defaults' | 'repository' | 'local';
  /** Absolute path of the committed file that was read, or null when none was. */
  path: string | null;
  /** Absolute path of the overlay that was read, or null when none was. */
  localPath: string | null;
  /**
   * What applied before the overlay — the committed file's policy, or the
   * defaults when there is no committed file. Equal to `policy` when no overlay
   * was read, so a caller can compare the two without asking which case it is.
   */
  beneath: CapturePolicy;
  /**
   * Keys where the overlay disagrees with what is beneath it, in `POLICY_KEYS`
   * order. Empty when there is no overlay or it restates what it overlays —
   * this is the disagreement `doctor` reports, not merely what the overlay set.
   */
  overridden: readonly PolicyKey[];
  /**
   * A named, actionable reason when `ok` is false. Never null in that case: a
   * silent fallback to the defaults would make the identity hash describe a
   * policy the user did not ask for without telling them.
   */
  error: string | null;
}

const defaultsResolution = (
  error: string | null,
  path: string | null,
  localPath: string | null = null,
): PolicyResolution => ({
  ok: error === null,
  policy: POLICY_DEFAULTS,
  identityHash: computePolicyIdentityHash(POLICY_DEFAULTS),
  source: 'defaults',
  path,
  localPath,
  beneath: POLICY_DEFAULTS,
  overridden: [],
  error,
});

/** Repository root, or null outside a repository. */
const repoRoot = (cwd: string): string | null => {
  const res = execGit(['rev-parse', '--show-toplevel'], { cwd });
  if (res.code !== 0) return null;
  const root = res.stdout.trim();
  return root.length > 0 ? root : null;
};

/**
 * Validate a parsed policy file.
 *
 * The file is untrusted input. It may set only the declared keys, with values of
 * the declared shape, and nothing it contains reaches a path, a command, or Git.
 * An unknown key is an error rather than an ignored field, because ignoring it
 * would let a user believe a setting applied.
 */
const parseKeys = (
  raw: unknown,
  name: string,
): { set: Partial<CapturePolicy> } | { error: string } => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: `${name} must contain a JSON object` };
  }
  const obj = raw as Record<string, unknown>;

  const unknown = Object.keys(obj).filter(
    (k) => !(POLICY_KEYS as readonly string[]).includes(k),
  );
  if (unknown.length > 0) {
    return {
      error:
        `${name} sets ${unknown.length === 1 ? 'an unknown key' : 'unknown keys'}: ` +
        `${unknown.join(', ')}. Allowed keys are ${POLICY_KEYS.join(', ')}.`,
    };
  }

  const set: Partial<CapturePolicy> = {};

  if ('mode' in obj) {
    if (typeof obj.mode !== 'string' || !CAPTURE_MODES.includes(obj.mode as CaptureMode)) {
      return {
        error: `${name}: mode must be one of ${CAPTURE_MODES.map((mode) => `"${mode}"`).join(', ')} (got ${JSON.stringify(obj.mode)})`,
      };
    }
    set.mode = obj.mode as CaptureMode;
  }

  if ('max_records_per_commit' in obj) {
    const v = obj.max_records_per_commit;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 32) {
      return {
        error:
          `${name}: max_records_per_commit must be an integer between 1 and 32 ` +
          `(got ${JSON.stringify(v)})`,
      };
    }
    set.max_records_per_commit = v;
  }

  if ('unattended' in obj) {
    const v = obj.unattended;
    if (typeof v !== 'boolean') {
      return {
        error: `${name}: unattended must be a boolean (got ${JSON.stringify(v)})`,
      };
    }
    set.unattended = v;
  }

  if ('require_verified_evidence' in obj) {
    const v = obj.require_verified_evidence;
    if (typeof v !== 'boolean') {
      return {
        error: `${name}: require_verified_evidence must be a boolean (got ${JSON.stringify(v)})`,
      };
    }
    set.require_verified_evidence = v;
  }

  return { set };
};

/**
 * ADR-0030's guarantee is a property of `auto` mode (#511): a record staged
 * without asking is stamped `drafted` there and only there. A consent the mode
 * cannot honour is rejected rather than ignored, so a user never believes a
 * setting applied.
 *
 * Checked against the policy that applies, which since #709 may be two files'
 * doing — so the message names where each of the two values came from rather
 * than blaming whichever file is being read.
 */
const coherent = (policy: CapturePolicy, originOf: (key: PolicyKey) => string): string | null => {
  if (!policy.unattended || policy.mode === 'auto') return null;
  const consent = originOf('unattended');
  const mode = originOf('mode');
  return consent === mode
    ? `${consent}: "unattended": true requires mode "auto" (mode is "${policy.mode}")`
    : `"unattended": true in ${consent} requires mode "auto", but mode is "${policy.mode}" from ${mode}`;
};

/**
 * One file's contents, validated as a complete policy. The shape every writer
 * here produces and the only shape `setUnattendedCapture` merges into.
 */
const validate = (raw: unknown): { policy: CapturePolicy } | { error: string } => {
  const parsed = parseKeys(raw, POLICY_FILE_NAME);
  if ('error' in parsed) return { error: parsed.error };
  const policy: CapturePolicy = { ...POLICY_DEFAULTS, ...parsed.set };
  const error = coherent(policy, () => POLICY_FILE_NAME);
  return error === null ? { policy } : { error };
};

/**
 * Read one layer: its bytes and the keys it sets, or a named reason it cannot
 * be used. Both files go through this, so neither can be validated more
 * leniently than the other — the overlay is untracked, not more trusted.
 */
const readLayer = (
  path: string,
  name: string,
): { set: Partial<CapturePolicy>; contents: string } | { error: string } => {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (err) {
    return { error: `${name} could not be read: ${(err as Error).message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    return { error: `${name} is not valid JSON: ${(err as Error).message}` };
  }

  const checked = parseKeys(parsed, name);
  return 'error' in checked ? checked : { set: checked.set, contents };
};

/**
 * The file to name in a message about the policy that applied.
 *
 * The committed file unless the overlay decided the value — which keeps every
 * message a repository without an overlay produces byte-identical to what it
 * was, and names a file the reader can actually open when there is one. With no
 * file at all it still names the committed one, because that is where a reader
 * who wants to change the answer should write.
 */
export const policySourceLabel = (resolution: PolicyResolution): string =>
  resolution.source === 'local'
    ? `${POLICY_LOCAL_FILE_NAME} over ${resolution.path === null ? 'the defaults' : POLICY_FILE_NAME}`
    : POLICY_FILE_NAME;

/**
 * Resolve the policy for `cwd`.
 *
 * Never throws. Every failure path returns the defaults **and** a named reason,
 * so a caller that ignores `error` still behaves as it did before the policy
 * file existed, and a caller that reports it tells the truth about which policy
 * ran.
 */
export const resolvePolicy = (cwd: string): PolicyResolution => {
  const root = repoRoot(cwd);
  if (root === null) return defaultsResolution(null, null);

  const path = join(root, POLICY_FILE_NAME);
  const localPath = join(root, POLICY_LOCAL_FILE_NAME);
  const committedExists = existsSync(path);
  const localExists = existsSync(localPath);

  if (!committedExists && !localExists) return defaultsResolution(null, null);

  // The committed layer. A file that cannot be used stops resolution here
  // rather than being overlaid: laying an overlay onto a policy nobody could
  // read produces an effective policy that no file states, and the identity
  // hash would then describe it as though one did.
  let beneath: CapturePolicy = POLICY_DEFAULTS;
  let committedBytes: string | null = null;
  if (committedExists) {
    const layer = readLayer(path, POLICY_FILE_NAME);
    if ('error' in layer) return defaultsResolution(layer.error, path);
    const merged: CapturePolicy = { ...POLICY_DEFAULTS, ...layer.set };
    const incoherent = coherent(merged, () => POLICY_FILE_NAME);
    if (incoherent !== null) return defaultsResolution(incoherent, path);
    beneath = merged;
    committedBytes = layer.contents;
  }

  if (!localExists) {
    return {
      ok: true,
      policy: beneath,
      identityHash:
        committedBytes === null
          ? computePolicyIdentityHash(beneath)
          : computePolicyFileIdentityHash(committedBytes),
      source: 'repository',
      path,
      localPath: null,
      beneath,
      overridden: [],
      error: null,
    };
  }

  const overlay = readLayer(localPath, POLICY_LOCAL_FILE_NAME);
  if ('error' in overlay) {
    return defaultsResolution(overlay.error, committedExists ? path : null, localPath);
  }

  const policy: CapturePolicy = { ...beneath, ...overlay.set };
  const origin = (key: PolicyKey): string =>
    key in overlay.set
      ? POLICY_LOCAL_FILE_NAME
      : committedExists
        ? POLICY_FILE_NAME
        : 'the built-in defaults';
  const incoherent = coherent(policy, origin);
  if (incoherent !== null) {
    return defaultsResolution(incoherent, committedExists ? path : null, localPath);
  }

  return {
    ok: true,
    policy,
    identityHash: computeEffectivePolicyIdentityHash(policy),
    source: 'local',
    path: committedExists ? path : null,
    localPath,
    beneath,
    overridden: POLICY_KEYS.filter((key) => policy[key] !== beneath[key]),
    error: null,
  };
};

// ---------------------------------------------------------------------------
// Writing the policy — the same file `resolvePolicy` reads, nowhere else
// ---------------------------------------------------------------------------

/**
 * Absolute path of the repository's policy file, or null outside a repository.
 * The file itself may or may not exist; this is where it lives either way, so
 * a status report can say where the setting is kept even before it is set.
 */
export const capturePolicyPath = (cwd: string): string | null => {
  const root = repoRoot(cwd);
  return root === null ? null : join(root, POLICY_FILE_NAME);
};

/**
 * Absolute path of this machine's overlay, or null outside a repository. As
 * above, the file may or may not exist; this is where it would live.
 */
export const capturePolicyLocalPath = (cwd: string): string | null => {
  const root = repoRoot(cwd);
  return root === null ? null : join(root, POLICY_LOCAL_FILE_NAME);
};

export interface PolicyWriteSuccess {
  ok: true;
  /** Absolute path of the policy file that was written, or would have been. */
  path: string;
  /** Which file that is: the committed policy, or this machine's overlay. */
  scope: 'repository' | 'local';
  /** False when the requested state was already in effect and nothing was written. */
  changed: boolean;
  /** The policy that applies after the call. */
  policy: CapturePolicy;
  /** The policy that applied before the call — the defaults when no file existed. */
  previous: CapturePolicy;
}

export interface PolicyWriteFailure {
  ok: false;
  /** Absolute path of the policy file, or null outside a repository. */
  path: string | null;
  /** Which file that is; `repository` outside a repository, where neither exists. */
  scope: 'repository' | 'local';
  /** A named, actionable reason — the same words `resolvePolicy` would use. */
  error: string;
}

export type PolicyWriteResult = PolicyWriteSuccess | PolicyWriteFailure;

/**
 * Turn unattended capture on or off in the committed file (#511).
 *
 * Never throws. Coherence is enforced here rather than trusted to the caller:
 * enabling sets `mode: "auto"` beside `unattended: true`, because a consent
 * the mode cannot honour is a configuration error the resolver rejects
 * (ADR-0030, #511) — this function cannot produce a file it would reject.
 * Disabling preserves whatever mode the repository chose.
 *
 * An existing file is merged, never replaced: every other key the repository
 * set survives. A file the resolver rejects is refused rather than rewritten,
 * because rewriting it would destroy whatever the user meant to put there
 * before they can see it named. When no file exists, disabling writes nothing
 * — the defaults already apply, and creating a file would move the repository
 * from the default digest to a file digest while nothing about capture
 * changed, which #511 pins against.
 */
const setInCommittedFile = (cwd: string, enabled: boolean): PolicyWriteResult => {
  const path = capturePolicyPath(cwd);
  if (path === null) {
    return { ok: false, path: null, scope: 'repository', error: 'no git repository found here — run this inside a repository' };
  }

  if (existsSync(path)) {
    let current: string;
    try {
      current = readFileSync(path, 'utf8');
    } catch (err) {
      return { ok: false, path, scope: 'repository', error: `${POLICY_FILE_NAME} could not be read: ${(err as Error).message}` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(current);
    } catch (err) {
      return { ok: false, path, scope: 'repository', error: `${POLICY_FILE_NAME} is not valid JSON: ${(err as Error).message}` };
    }

    const checked = validate(parsed);
    if ('error' in checked) {
      return {
        ok: false,
        path,
        scope: 'repository',
        error: `${checked.error} Fix or remove the file and re-run; it has been left untouched.`,
      };
    }

    const previous = checked.policy;
    const policy: CapturePolicy = enabled
      ? { ...previous, mode: 'auto', unattended: true }
      : { ...previous, unattended: false };

    // Compare the effective setting, not the file's bytes. A file that already
    // means what was asked — a hand-written `{ "mode": "suggest" }` is already
    // "off" — must not be rewritten, because a rewrite changes the policy
    // identity hash while nothing about capture changed: the hook would report
    // a policy change that never happened, the exact false positive the
    // identity design exists to avoid (#511).
    if (previous.mode === policy.mode && previous.unattended === policy.unattended) {
      return { ok: true, path, scope: 'repository', changed: false, policy, previous };
    }

    try {
      writeFileSync(path, serializePolicyFile(policy));
    } catch (err) {
      return { ok: false, path, scope: 'repository', error: `${POLICY_FILE_NAME} could not be written: ${(err as Error).message}` };
    }
    return { ok: true, path, scope: 'repository', changed: true, policy, previous };
  }

  if (!enabled) {
    return { ok: true, path, scope: 'repository', changed: false, policy: POLICY_DEFAULTS, previous: POLICY_DEFAULTS };
  }

  const policy: CapturePolicy = { ...POLICY_DEFAULTS, mode: 'auto', unattended: true };
  try {
    writeFileSync(path, serializePolicyFile(policy));
  } catch (err) {
    return { ok: false, path, scope: 'repository', error: `${POLICY_FILE_NAME} could not be written: ${(err as Error).message}` };
  }
  return { ok: true, path, scope: 'repository', changed: true, policy, previous: POLICY_DEFAULTS };
};

/**
 * Turn unattended capture on or off in this machine's overlay (#709).
 *
 * The tracked file is never opened for writing here — that is the whole point:
 * a contributor who differs from the committed policy leaves the worktree
 * clean, instead of carrying a permanently modified tracked file past every
 * release script that refuses a dirty tree.
 *
 * Only the keys the setting needs are written, merged into whatever the overlay
 * already held. Enabling writes `mode: "auto"` beside `unattended: true` for
 * the same reason the committed writer does — a consent the mode cannot honour
 * is rejected by the resolver, so neither writer may produce a file it would
 * reject, and pinning `mode` locally is implied by the consent rather than an
 * extra opinion. Disabling writes only `unattended: false`, leaving the mode
 * the repository chose to keep applying.
 *
 * The comparison before writing is on the effective setting, not on bytes: an
 * overlay that already means what was asked is left alone, because rewriting it
 * would move the policy identity while nothing about capture changed.
 */
const setInOverlay = (cwd: string, localPath: string, enabled: boolean): PolicyWriteResult => {
  const resolution = resolvePolicy(cwd);
  if (!resolution.ok) {
    return {
      ok: false,
      path: localPath,
      scope: 'local',
      error: `${resolution.error ?? 'the policy is rejected'} Fix or remove the file and re-run; it has been left untouched.`,
    };
  }

  let held: Partial<CapturePolicy> = {};
  if (existsSync(localPath)) {
    const layer = readLayer(localPath, POLICY_LOCAL_FILE_NAME);
    // Unreachable while `resolution.ok` — the resolver read the same file
    // through the same function — but a resolver that stops reading it one day
    // must not turn this into a silent overwrite of whatever is there.
    if ('error' in layer) {
      return { ok: false, path: localPath, scope: 'local', error: layer.error };
    }
    held = layer.set;
  }

  const set: Partial<CapturePolicy> = enabled
    ? { ...held, mode: 'auto', unattended: true }
    : { ...held, unattended: false };

  const previous = resolution.policy;
  const policy: CapturePolicy = { ...resolution.beneath, ...set };

  if (previous.mode === policy.mode && previous.unattended === policy.unattended) {
    return { ok: true, path: localPath, scope: 'local', changed: false, policy, previous };
  }

  try {
    writeFileSync(localPath, serializePolicyOverlay(set));
  } catch (err) {
    return {
      ok: false,
      path: localPath,
      scope: 'local',
      error: `${POLICY_LOCAL_FILE_NAME} could not be written: ${(err as Error).message}`,
    };
  }
  return { ok: true, path: localPath, scope: 'local', changed: true, policy, previous };
};

/**
 * Turn unattended capture on or off, in whichever file this machine keeps its
 * answer in.
 *
 * The overlay when it already exists, or when `local` asks for it; the
 * committed file otherwise. Existence is the signal because creating the
 * overlay is a decision — an operator who has one is saying they differ from
 * the repository, and a `commitlore auto off` that silently created one would
 * make the tracked file stop being the answer without anyone choosing that.
 */
export const setUnattendedCapture = (
  cwd: string,
  enabled: boolean,
  opts: { local?: boolean } = {},
): PolicyWriteResult => {
  const root = repoRoot(cwd);
  if (root === null) {
    return { ok: false, path: null, scope: 'repository', error: 'no git repository found here — run this inside a repository' };
  }
  const localPath = join(root, POLICY_LOCAL_FILE_NAME);
  return opts.local === true || existsSync(localPath)
    ? setInOverlay(cwd, localPath, enabled)
    : setInCommittedFile(cwd, enabled);
};
