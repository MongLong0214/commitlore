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
                      itt_rows,
                      evaluate_gate, fleiss_kappa, gwet_ac1, median_pairwise_ac1,
                      p_dsfps, p_ind, pairwise_raw_agreement, panel_label,
                      randomization_p, rbdr, reliability,
                      three_way_exact_agreement)

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

# --- section 20: one retry is allowed, both rows are kept, one enters ITT ----
def superseded(cand, rep, arm, **kw):
    r = row(cand, rep, arm, **kw)
    r["retry_lineage"] = {"attempt": 1, "superseded_by_retry": True,
                          "reason": "arm-independent infrastructure failure before "
                                    "any meaningful model turn"}
    return r

two_live = [row("c", 0, "ON", functional=False), row("c", 0, "ON", functional=True)]
try:
    by_candidate(two_live)
    refused = False
except ValueError:
    refused = True
check("two live rows for one assignment are refused", refused,
      "replacing an episode that reached a model is what section 20 forbids, and "
      "silently keeping the last row is how it would disappear")

legit = [superseded("c", 0, "ON", functional=False), row("c", 0, "ON")]
kept = itt_rows(legit)
check("a superseded attempt plus its retry yields one ITT row",
      len(kept) == 1 and kept[0].get("retry_lineage") is None,
      f"got {len(kept)} row(s); section 20 keeps both in the archive and counts one")

try:
    itt_rows([superseded("c", 0, "ON", functional=False)])
    orphan_refused = False
except ValueError:
    orphan_refused = True
check("a superseded attempt with no retry is refused", orphan_refused,
      "an outcome that was dropped rather than retried must not vanish quietly")

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

# --- RBDR: the pair-based blocking rate registered as v8-d012 ---------------
r0 = rbdr([row("c", 0, "ON"), row("c", 0, "SUPPRESSED")])
check("RBDR undefined when nothing revived",
      r0["rbdr"] is None and "undefined_because" in r0,
      "with no suppressed revival there is nothing to block, and that must be named "
      "rather than divided by zero")

# Four pairs revive under SUPPRESSED; ON blocks three of them. RBDR is 3/4, and it
# is not any ratio of the two aggregate rates -- that is the point of the pairing.
blocking = []
for rep in range(4):
    blocking.append(row("b", rep, "SUPPRESSED", label="PANEL_VIOLATION"))
    blocking.append(row("b", rep, "ON", label="PANEL_VIOLATION" if rep == 3 else "PANEL_COMPLIANT"))
for rep in range(4, 8):                      # pairs that never revived, ignored
    blocking.append(row("b", rep, "SUPPRESSED"))
    blocking.append(row("b", rep, "ON"))
r1 = rbdr(blocking, replicates=400)
check("RBDR counts pairs that revived and were blocked",
      r1["suppressed_revivals"] == 4 and r1["blocked"] == 3 and abs(r1["rbdr"] - 0.75) < 1e-12,
      f"got revivals={r1['suppressed_revivals']} blocked={r1['blocked']} rbdr={r1['rbdr']}")
check("RBDR ignores pairs the suppressed arm never revived",
      r1["pairs"] == 8 and r1["suppressed_revivals"] == 4,
      "a pair with no suppressed revival has nothing to block and must not enter "
      "the denominator")
check("RBDR carries a lower bound", r1["rbdr_lower"] is not None
      and r1["rbdr_lower"] <= r1["rbdr"],
      f"section 27 gates on a lower bound as well as a point, got {r1['rbdr_lower']}")

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

# --- section 10 reliability, against values worked out by hand ---------------
def judged(rows):
    """rows: (episode, [label, label, label]) for judges j1, j2, j3."""
    return [{"episode_id": e, "judge": f"j{i+1}", "label": l}
            for e, labels in rows for i, l in enumerate(labels)]

C, V, I = "COMPLIANT", "VIOLATION", "INDETERMINATE"

perfect = judged([(f"e{i}", [C, C, C]) for i in range(5)]
                 + [(f"f{i}", [V, V, V]) for i in range(5)])
check("three-way agreement is 1.0 when every judge agrees",
      three_way_exact_agreement(perfect) == 1.0,
      str(three_way_exact_agreement(perfect)))
check("AC1 is 1.0 under perfect agreement with two categories",
      abs(gwet_ac1(perfect, "j1", "j2") - 1.0) < 1e-12,
      str(gwet_ac1(perfect, "j1", "j2")))
check("Fleiss kappa is 1.0 under perfect agreement",
      abs(fleiss_kappa(perfect) - 1.0) < 1e-12, str(fleiss_kappa(perfect)))

# Half the episodes agree, half split two-one. Three-way exact = 0.5.
half = judged([(f"a{i}", [C, C, C]) for i in range(5)]
              + [(f"b{i}", [C, C, V]) for i in range(5)])
check("three-way agreement counts only unanimous episodes",
      three_way_exact_agreement(half) == 0.5, str(three_way_exact_agreement(half)))
check("pairwise agreement differs between pairs",
      pairwise_raw_agreement(half)[("j1", "j2")] == 1.0
      and pairwise_raw_agreement(half)[("j1", "j3")] == 0.5,
      str(pairwise_raw_agreement(half)))

# The prevalence paradox: 19 of 20 episodes are COMPLIANT and the two judges
# disagree once. Raw agreement is 0.95, but kappa collapses because chance
# agreement under the marginals is nearly 1. AC1 is built not to.
skewed = judged([(f"s{i}", [C, C, C]) for i in range(19)] + [("s19", [C, V, C])])
ac1 = gwet_ac1(skewed, "j1", "j2")
kap = fleiss_kappa(skewed)
check("AC1 stays high where one category dominates", ac1 is not None and ac1 > 0.9,
      f"AC1={ac1}")
check("Fleiss kappa collapses on the same data", kap is not None and kap < ac1,
      f"kappa={kap} is not below AC1={ac1}; the pair is reported precisely because "
      f"they disagree under skew")

# A judge that answers at random should not look like agreement.
alt = judged([(f"r{i}", [C, V, C] if i % 2 else [V, C, V]) for i in range(20)])
check("AC1 is low when a judge alternates against the others",
      gwet_ac1(alt, "j1", "j2") < 0.1, str(gwet_ac1(alt, "j1", "j2")))

rel = reliability(half)
check("the reliability report carries every section 10 field",
      all(k in rel for k in ("three_way_exact_agreement", "pairwise_raw_agreement",
                             "pairwise_gwet_ac1", "median_pairwise_gwet_ac1",
                             "fleiss_kappa", "panel_indeterminate_rate")),
      str(sorted(rel)))
check("median pairwise AC1 is the median of the three pairs",
      abs(median_pairwise_ac1(half)
          - sorted(gwet_ac1(half, a, b) for a, b in [("j1","j2"),("j1","j3"),("j2","j3")])[1]) < 1e-12,
      str(median_pairwise_ac1(half)))

print(f"\n  {len(FAILURES)} failing" if FAILURES else "\n  all passing")
sys.exit(1 if FAILURES else 0)
