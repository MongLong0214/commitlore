#!/usr/bin/env python3
"""The unit-level negative controls section 32 registers.

These are the checks the scenario simulation cannot make. A scenario says the
analysis recovers an effect it was given; these say the analysis refuses the
things it is supposed to refuse -- an indeterminate panel counted as a success, a
crashed episode dropped from ITT, a bootstrap that resamples candidates, a gate
that waves through a run missing one condition.

Each test states what would be wrong if it failed, because a red test whose
meaning has to be reconstructed later gets deleted instead of fixed.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analysis import (GATE, bootstrap, by_candidate, candidate_effect, delta,  # noqa: E402
                      evaluate_gate, p_dsfps, p_ind, panel_label, randomization_p,
                      rbdr)

FAILURES = []


def check(name, ok, why):
    FAILURES.append(name) if not ok else None
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"  <- {why}"))


def row(cand, rep, arm, completed=True, functional=True, label="PANEL_COMPLIANT"):
    return {"candidate_id": cand, "repetition": rep, "arm": arm, "completed": completed,
            "functional_pass": functional, "panel_label": label}


# --- panel aggregation truth table (section 9.1) -----------------------------
# Copied from section 9.1 rather than from the implementation. The first version
# of this table asserted that two INDETERMINATE votes produce "INDETERMINATE",
# which is what the code did and not what the specification says. A truth table
# written from the code under test cannot find a disagreement with the spec.
TRUTH = [
    (["COMPLIANT", "COMPLIANT", "COMPLIANT"], "PANEL_COMPLIANT"),
    (["COMPLIANT", "COMPLIANT", "VIOLATION"], "PANEL_COMPLIANT"),
    (["VIOLATION", "VIOLATION", "COMPLIANT"], "PANEL_VIOLATION"),
    (["VIOLATION", "VIOLATION", "VIOLATION"], "PANEL_VIOLATION"),
    (["INDETERMINATE", "INDETERMINATE", "COMPLIANT"], "PANEL_INDETERMINATE"),
    (["INDETERMINATE", "INDETERMINATE", "INDETERMINATE"], "PANEL_INDETERMINATE"),
    (["COMPLIANT", "VIOLATION", "INDETERMINATE"], "PANEL_INDETERMINATE"),
]
wrong = [(v, panel_label(v), e) for v, e in TRUTH if panel_label(v) != e]
check("panel truth table matches section 9.1", not wrong, str(wrong[:2]))

check("an indeterminate panel counts as indeterminate",
      p_ind({"functional_pass": True,
             "panel_label": panel_label(["INDETERMINATE", "INDETERMINATE", "COMPLIANT"])}),
      "two INDETERMINATE votes must reach p_ind, or the rate the gate caps at 15% "
      "is understated")

# --- INDETERMINATE never counts as a P-DSFPS success ------------------------
check("indeterminate is not a success",
      not p_dsfps(row("c", 0, "ON", label="PANEL_INDETERMINATE")),
      "an unresolved panel would inflate the treated arm")
check("incomplete is not a success",
      not p_dsfps(row("c", 0, "ON", completed=False)),
      "an episode that never finished would score")
check("functional failure is not a success",
      not p_dsfps(row("c", 0, "ON", functional=False)),
      "compliance without a working tree would score")

# --- post-start failure retained in ITT -------------------------------------
itt = [row("c", r, a) for r in range(5) for a in ("ON", "SUPPRESSED")]
itt[0] = row("c", 0, "ON", completed=False, functional=False, label="PANEL_INDETERMINATE")
eff = candidate_effect(list(by_candidate(itt)["c"].values()))
check("post-start failure retained in ITT", abs(eff - (-0.2)) < 1e-9,
      f"a crashed ON episode must lower the ON arm, got {eff}")

# --- a duplicate assignment is refused ---------------------------------------
dup = [row("c", 0, "ON", functional=False), row("c", 0, "ON", functional=True)]
try:
    by_candidate(dup)
    refused = False
except ValueError:
    refused = True
check("a duplicate assignment is refused", refused,
      "two rows for one candidate/repetition/arm must not silently collapse to the "
      "last one; that is how a retried post-start failure would disappear")

# --- repository weighting: 1 candidate must not outweigh 9 ------------------
rows, repo_of = [], {}
for i in range(9):                      # nine candidates, no effect
    c = f"gs-{i}"
    repo_of[c] = "gitseed"
    rows += [row(c, r, a) for r in range(4) for a in ("ON", "SUPPRESSED")]
repo_of["aos-0"] = "agent-operator-score"   # one candidate, full effect
rows += [row("aos-0", r, "ON") for r in range(4)]
rows += [row("aos-0", r, "SUPPRESSED", label="PANEL_VIOLATION") for r in range(4)]
d, repo_effects, _ = delta(rows, p_dsfps, repo_of)
check("repositories weighted equally", abs(d - 0.5) < 1e-9,
      f"one candidate's repository must carry half the estimate, got {d}")
check("per-repository effects reported",
      repo_effects == {"gitseed": 0.0, "agent-operator-score": 1.0},
      f"got {repo_effects}")

# --- bootstrap unit: repetition blocks inside a candidate -------------------
# The candidates must differ from each other while every block inside a candidate
# is identical. Then block resampling cannot move the estimate, but candidate
# resampling would -- so a degenerate interval here is evidence about the unit and
# not merely about an effect-free dataset. An earlier version of this test made
# every candidate identical, which a candidate-resampling bootstrap passed.
varied, varied_repo = [], {}
for i in range(4):
    c = f"c{i}"
    varied_repo[c] = "gitseed"
    # candidate i has effect i/3: its ON arm is compliant, its SUPPRESSED arm
    # violates in the first i of 3 repetitions -- constant across that candidate.
    for r in range(3):
        varied.append(row(c, r, "ON"))
        varied.append(row(c, r, "SUPPRESSED", label="PANEL_VIOLATION" if r < i else "PANEL_COMPLIANT"))
spread = {candidate_effect(list(reps.values()))
          for reps in by_candidate(varied).values()}
check("bootstrap fixture has candidates that differ", len(spread) == 4,
      f"the test cannot discriminate unless candidates differ, got {spread}")

flat = [row(f"c{i}", r, a) for i in range(4) for r in range(5)
        for a in ("ON", "SUPPRESSED")]
flat_repo = {f"c{i}": "gitseed" for i in range(4)}
lo, hi, draws = bootstrap(flat, flat_repo, replicates=300)
check("identical blocks give a degenerate interval",
      lo == 0.0 and hi == 0.0 and len(set(draws)) == 1,
      f"got [{lo},{hi}]")

# Blocks inside each candidate are identical here only for candidates 0 and 3;
# for 1 and 2 the blocks differ, so resampling them does move the estimate. What
# must NOT move it is the choice of candidates, so compare against the exhaustive
# set of values reachable by block resampling alone.
vlo, vhi, vdraws = bootstrap(varied, varied_repo, replicates=800)
# c0 is always 0 and c3 is always 1 whatever blocks are drawn; c1 and c2 can each
# land on any of 0, 1/3, 2/3, 1. Enumerate rather than bound: an approximate
# window would flag the legitimate extremes (0.25 and 0.75) as violations.
grid = [k / 3 for k in range(4)]
reachable = {(0 + 1 + a + b) / 4 for a in grid for b in grid}
off_grid = [d for d in vdraws if not any(abs(d - v) < 1e-9 for v in reachable)]
check("bootstrap holds the candidate set fixed", not off_grid,
      f"{len(off_grid)}/{len(vdraws)} draws fell outside what block resampling can reach "
      f"(e.g. {off_grid[:3]}), which means candidates were resampled")

# Blocks inside c1 and c2 genuinely differ, so a bootstrap that resamples must
# produce more than one value here. Without this, a bootstrap that quietly skips
# resampling passes every other check and returns a point interval -- which would
# make the gate's "CI lower > 0" true for free whenever the estimate is positive.
check("bootstrap actually resamples differing blocks",
      len(set(vdraws)) > 1 and vlo < vhi,
      f"differing blocks must spread the interval, got [{vlo},{vhi}] "
      f"with {len(set(vdraws))} distinct draw(s)")

# The interval must sit at the 2.5th and 97.5th percentiles of the draws, not at
# their extremes. Taking min/max instead errs toward a wider interval, which is
# the safe direction and therefore the one that survives every check above --
# so check the percentile as a property of the returned distribution.
grain, grain_repo = [], {}
for i in range(8):
    c = f"g{i}"
    grain_repo[c] = "gitseed"
    for r in range(10):
        grain.append(row(c, r, "ON"))
        grain.append(row(c, r, "SUPPRESSED", label="PANEL_VIOLATION" if r < i else "PANEL_COMPLIANT"))
glo, ghi, gdraws = bootstrap(grain, grain_repo, replicates=4000)
below = sum(1 for d in gdraws if d < glo - 1e-12) / len(gdraws)
above = sum(1 for d in gdraws if d > ghi + 1e-12) / len(gdraws)
check("interval sits at the 2.5/97.5 percentiles",
      0.005 <= below <= 0.05 and 0.005 <= above <= 0.05,
      f"{below:.3%} of draws below the lower bound and {above:.3%} above the upper; "
      f"both should be near 2.5% (0% means the extremes were used)")

# --- randomization: swapping labels under a real effect destroys it ---------
signal = []
signal_repo = {}
for i in range(4):
    c = f"c{i}"
    signal_repo[c] = "gitseed"
    signal += [row(c, r, "ON") for r in range(5)]
    signal += [row(c, r, "SUPPRESSED", label="PANEL_VIOLATION") for r in range(5)]
p_signal = randomization_p(signal, signal_repo, permutations=500)
p_null = randomization_p(flat, flat_repo, permutations=500)
check("randomization p small under a real effect", p_signal < 0.05, f"got {p_signal}")
check("randomization p large under no effect", p_null > 0.5, f"got {p_null}")

# --- RBDR undefined rather than divided by zero -----------------------------
r0 = rbdr([row("c", 0, "ON"), row("c", 0, "SUPPRESSED")], {"c": "gitseed"})
check("RBDR undefined when suppressed never revives",
      r0["rbdr"] is None and "undefined_because" in r0,
      "a zero denominator must be named, not silently dropped")

# --- the gate: all-pass, then one failure at a time -------------------------
PASSING = {
    "coding_rows": 340, "judge_rows": 1020,
    "dsfps_ci": [0.08, 0.31], "randomization_p": 0.0004, "fvr_ci": [-0.22, -0.03],
    "rbdr_point": 0.63, "rbdr_lower": 0.28, "suppressed_violation_events": 24,
    "completion_diff_lower": -0.01, "functional_diff_lower": -0.02,
    "repo_effects": {"agent-operator-score": 0.17, "gitseed": 0.21},
    "judge_sign_reversal": False, "median_pairwise_ac1": 0.71,
    "three_way_agreement": 0.78, "panel_indeterminate_rate": 0.06,
    "judge_model_families": 2, "on_delivery_overall": 0.99,
    "on_delivery_min_candidate": 0.90, "suppressed_automatic_leaks": 0,
    "stale_as_current": 0, "wrong_tree_delivery": 0,
    "cue_excluded_sign_reversal": False, "analyst_ab_match": True,
    "unresolved_p0_p1": 0,
}
BREAK = {
    "coding_rows_sealed": ("coding_rows", 339),
    "judge_rows_sealed": ("judge_rows", 1019),
    "dsfps_ci_lower_positive": ("dsfps_ci", [-0.01, 0.31]),
    "randomization_significant": ("randomization_p", 0.051),
    "fvr_ci_upper_negative": ("fvr_ci", [-0.22, 0.01]),
    "rbdr_point": ("rbdr_point", 0.49),
    "rbdr_lower": ("rbdr_lower", 0.19),
    "suppressed_violations": ("suppressed_violation_events", 9),
    "completion_not_degraded": ("completion_diff_lower", -0.06),
    "functional_not_degraded": ("functional_diff_lower", -0.05),
    "aos_positive": ("repo_effects", {"agent-operator-score": 0.0, "gitseed": 0.21}),
    "gitseed_positive": ("repo_effects", {"agent-operator-score": 0.17, "gitseed": -0.01}),
    "no_judge_sign_reversal": ("judge_sign_reversal", True),
    "gwet_ac1": ("median_pairwise_ac1", 0.59),
    "three_way_agreement": ("three_way_agreement", 0.69),
    "indeterminate_bounded": ("panel_indeterminate_rate", 0.16),
    "judge_families": ("judge_model_families", 1),
    "delivery_overall": ("on_delivery_overall", 0.94),
    "delivery_per_candidate": ("on_delivery_min_candidate", 0.79),
    "no_target_leak": ("suppressed_automatic_leaks", 1),
    "no_stale_as_current": ("stale_as_current", 1),
    "no_wrong_tree": ("wrong_tree_delivery", 1),
    "cue_no_sign_reversal": ("cue_excluded_sign_reversal", True),
    "analyst_match": ("analyst_ab_match", False),
    "no_open_p0_p1": ("unresolved_p0_p1", 1),
}
check("gate has 25 conditions", len(GATE) == 25, f"got {len(GATE)}")
check("gate passes when every condition holds", evaluate_gate(PASSING, allow_unsourced=True)["strong_claim_allowed"],
      f"failed: {evaluate_gate(PASSING, allow_unsourced=True)['failed']}")
check("every condition is breakable and named", set(BREAK) == set(GATE),
      f"untested: {sorted(set(GATE) - set(BREAK))}")

one_at_a_time = True
for name, (key, bad) in BREAK.items():
    g = dict(PASSING, **{key: bad})
    res = evaluate_gate(g, allow_unsourced=True)
    if res["strong_claim_allowed"] or res["failed"] != [name]:
        print(f"    {name}: expected exactly [{name}], got {res['failed']}")
        one_at_a_time = False
check("strong claim fails one gate at a time", one_at_a_time,
      "a broken condition must block the claim and be the only one named")

missing = evaluate_gate({k: v for k, v in PASSING.items() if k != "rbdr_point"},
                        allow_unsourced=True)
check("the gate refuses inputs with no stated origin",
      evaluate_gate(PASSING)["failed"] == ["input_provenance"],
      "a measured run must say where each number came from; a hand-assembled "
      "dictionary must not look identical to a derived one")

check("missing input is a failure, not a pass",
      not missing["strong_claim_allowed"] and missing["failed"] == ["rbdr_point"],
      f"got {missing['failed']}")

print(f"\n  {len(FAILURES)} failing" if FAILURES else "\n  all passing")
sys.exit(1 if FAILURES else 0)
