#!/usr/bin/env python3
"""Run the analysis on data whose answer is already known.

Required by section 17 execution readiness and by PR-A, not by section 13.

Every scenario here is generated with an effect I chose, so the test is whether
the analysis recovers it. Two of them are negative controls in the strict sense --
the exact null and the known-negative -- and an analysis that reports a positive
effect on those is broken in a way no amount of agreement on real data would
reveal.

The generator is the same for all scenarios; only the per-arm success
probabilities change. That matters: if each scenario had its own generator, a
scenario passing would say something about its generator rather than about the
analysis.
"""
import json
import random
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analysis import analyse, evaluate_gate, panel_label, p_dsfps, p_fvr  # noqa: E402

# Everything in the section 27 gate that this simulation does not produce --
# reliability, delivery, provenance, analyst agreement. Held at passing values on
# purpose, so that whatever the gate reports below is decided by the statistics
# alone and not by a field the simulation never computed.
NON_STATISTICAL_PASSING = {
    "coding_rows": 340, "judge_rows": 1020, "suppressed_violation_events": 24,
    "judge_sign_reversal": False, "median_pairwise_ac1": 0.71,
    "three_way_agreement": 0.78, "judge_model_families": 2,
    "on_delivery_overall": 0.99, "on_delivery_min_candidate": 0.90,
    "suppressed_automatic_leaks": 0, "stale_as_current": 0,
    "wrong_tree_delivery": 0, "cue_excluded_sign_reversal": False,
    "analyst_ab_match": True, "unresolved_p0_p1": 0,
}


def gate_inputs(r):
    """Feed the analysis output into the gate; RBDR stays None when undefined."""
    rb = r["rbdr"]
    return dict(NON_STATISTICAL_PASSING,
                dsfps_ci=r["ci95"], randomization_p=r["randomization_p"],
                fvr_ci=[-0.22, -0.03],
                rbdr_point=rb["rbdr"],
                rbdr_lower=None if rb["rbdr"] is None else max(0.0, rb["rbdr"] - 0.2),
                completion_diff_lower=r["completion_on"] - r["completion_suppressed"] - 0.02,
                functional_diff_lower=-0.02,
                repo_effects=r["repository_effects"],
                panel_indeterminate_rate=r["p_ind_rate"])

AOS = [f"aos-{i:02d}" for i in range(8)]
GITSEED = [f"gs-{i:02d}" for i in range(9)]
REPO_OF = {**{c: "agent-operator-score" for c in AOS}, **{c: "gitseed" for c in GITSEED}}
REPEATS = 10


def make(p_on, p_off, seed, completion=(1.0, 1.0), indeterminate=0.0,
         violation_split=0.5):
    """340 rows. p_on / p_off are the chance a run is panel-compliant and functional."""
    rng = random.Random(seed)
    rows = []
    for cand in AOS + GITSEED:
        for rep in range(REPEATS):
            for arm, p, comp in (("ON", p_on, completion[0]),
                                 ("SUPPRESSED", p_off, completion[1])):
                completed = rng.random() < comp
                if not completed:
                    label, functional = "PANEL_INDETERMINATE", False
                elif rng.random() < indeterminate:
                    label, functional = "PANEL_INDETERMINATE", True
                elif rng.random() < p:
                    label, functional = "PANEL_COMPLIANT", True
                else:
                    # the rest split between a violation and a functional failure
                    if rng.random() < violation_split:
                        label, functional = "PANEL_VIOLATION", True
                    else:
                        label, functional = "PANEL_COMPLIANT", False
                rows.append({"candidate_id": cand, "repetition": rep, "arm": arm,
                             "completed": completed, "functional_pass": functional,
                             "panel_label": label})
    return rows


SCENARIOS = {
    "known_positive":      dict(p_on=0.70, p_off=0.40, seed=1),
    "exact_null":          dict(p_on=0.55, p_off=0.55, seed=2),
    "known_negative":      dict(p_on=0.35, p_off=0.60, seed=3),
    "completion_degraded": dict(p_on=0.60, p_off=0.55, seed=4, completion=(0.75, 0.98)),
    "high_indeterminate":  dict(p_on=0.60, p_off=0.40, seed=5, indeterminate=0.40),
    "suppressed_fvr_zero": dict(p_on=0.60, p_off=0.60, seed=6, violation_split=0.0),
}

EXPECT = {
    "known_positive":      lambda r: r["delta"] > 0.15 and r["ci95"][0] > 0,
    "exact_null":          lambda r: abs(r["delta"]) < 0.10 and r["ci95"][0] <= 0 <= r["ci95"][1],
    "known_negative":      lambda r: r["delta"] < -0.15 and r["ci95"][1] < 0,
    "completion_degraded": lambda r: r["completion_on"] < r["completion_suppressed"] - 0.10,
    "high_indeterminate":  lambda r: r["p_ind_rate"] > 0.20,
    "suppressed_fvr_zero": lambda r: r["rbdr"]["rbdr"] is None,
}


def main():
    out = {}
    for name, kw in SCENARIOS.items():
        rows = make(**kw)
        r = analyse(rows, REPO_OF, replicates=2000, permutations=2000)
        ok = EXPECT[name](r)
        g = evaluate_gate(gate_inputs(r), allow_unsourced=True)
        out[name] = {"generated_with": {k: v for k, v in kw.items() if k != "seed"},
                     "strong_claim_allowed": g["strong_claim_allowed"],
                     "gate_failed_on": g["failed"],
                     "delta": round(r["delta"], 4),
                     "ci95": [round(r["ci95"][0], 4), round(r["ci95"][1], 4)],
                     "randomization_p": round(r["randomization_p"], 5),
                     "p_ind_rate": round(r["p_ind_rate"], 4),
                     "completion_on": round(r["completion_on"], 4),
                     "completion_suppressed": round(r["completion_suppressed"], 4),
                     "rbdr": r["rbdr"],
                     "repository_effects": {k: round(v, 4) for k, v in r["repository_effects"].items()},
                     "expectation_met": bool(ok)}
        claim = "CLAIM" if g["strong_claim_allowed"] else f"blocked:{','.join(g['failed'])[:38]}"
        print(f"  {name:20} delta={r['delta']:+.3f} ci=[{r['ci95'][0]:+.3f},{r['ci95'][1]:+.3f}] "
              f"p={r['randomization_p']:.4f} {'ok' if ok else 'FAILED'}  {claim}", flush=True)
    passed = sum(1 for v in out.values() if v["expectation_met"])
    print(f"  {passed}/{len(out)} 시나리오 통과")
    dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "simulation.json")
    json.dump(out, open(dest, "w"), indent=2)
    print(f"  wrote {dest}")


if __name__ == "__main__":
    main()
