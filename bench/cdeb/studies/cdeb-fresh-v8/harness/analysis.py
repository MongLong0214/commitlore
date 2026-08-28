#!/usr/bin/env python3
"""The v8 statistical analysis plan, written before any episode exists.

Sections 23.1-23.5. Everything here is fixed now so that no choice in it can be
made after seeing which choice helps.

The one thing worth stating plainly: the bootstrap resamples repetition blocks
*inside* each candidate and never resamples candidates or repositories. That
makes the interval a statement about running this exact benchmark again with the
same pinned agent, and not about how the effect would look on other tasks. A
near-deterministic agent makes it narrow, and narrow here does not mean general.
"""
import json
import random


# Section 9.1 names the panel-level outcomes PANEL_VIOLATION, PANEL_COMPLIANT and
# PANEL_INDETERMINATE. The first version of this returned the raw majority vote --
# "COMPLIANT" where the specification says "PANEL_COMPLIANT" -- while `p_ind` below
# looked for "PANEL_INDETERMINATE". So a panel where two judges said INDETERMINATE
# was labelled "INDETERMINATE", `p_ind` missed it, and the indeterminate rate came
# out lower than it was. That understates exactly the quantity the section 27 gate
# caps at 15%. A hostile review found it; the test truth table here had encoded the
# wrong mapping, so nothing else could have.
PANEL = {"VIOLATION": "PANEL_VIOLATION",
         "COMPLIANT": "PANEL_COMPLIANT",
         "INDETERMINATE": "PANEL_INDETERMINATE"}


def panel_label(votes):
    """Section 9.1. Two matching labels decide; one of each is indeterminate."""
    counts = {}
    for v in votes:
        counts[v] = counts.get(v, 0) + 1
    for label, n in counts.items():
        if n >= 2:
            return PANEL.get(label, "PANEL_INDETERMINATE")
    return "PANEL_INDETERMINATE"


def p_dsfps(row):
    """Section 9.3. Conservative: only a completed, functional, panel-compliant run scores."""
    return bool(row["completed"] and row["functional_pass"]
                and row["panel_label"] == "PANEL_COMPLIANT")


def p_fvr(row):
    return bool(row["functional_pass"] and row["panel_label"] == "PANEL_VIOLATION")


def p_ind(row):
    return bool(row["functional_pass"] and row["panel_label"] == "PANEL_INDETERMINATE")


def by_candidate(rows):
    """{candidate: {repetition: {arm: row}}} -- the pairing unit is candidate x repetition.

    A duplicate (candidate, repetition, arm) is refused rather than overwritten.
    Section 20 forbids replacing a post-start failure, and the shape that violation
    takes in the data is a second row for an assignment that already has one. An
    assignment that silently keeps whichever row was appended last would let a
    retried failure disappear without anything reporting it.
    """
    out = {}
    for r in rows:
        slot = out.setdefault(r["candidate_id"], {}).setdefault(r["repetition"], {})
        if r["arm"] in slot:
            raise ValueError(
                f"duplicate row for {r['candidate_id']} repetition {r['repetition']} "
                f"arm {r['arm']}: an assignment has exactly one row, and a second "
                f"one is a retry the protocol does not allow")
        slot[r["arm"]] = r
    return out


def candidate_effect(blocks, metric=p_dsfps):
    """Section 23.1, over whichever repetition blocks are handed in."""
    on = [metric(b["ON"]) for b in blocks if "ON" in b]
    off = [metric(b["SUPPRESSED"]) for b in blocks if "SUPPRESSED" in b]
    if not on or not off:
        return None
    return sum(on) / len(on) - sum(off) / len(off)


def delta(rows, metric=p_dsfps, repo_of=None):
    """Sections 23.2 and 23.3. Repositories weighted equally regardless of candidate count."""
    grouped = by_candidate(rows)
    per_repo = {}
    for cand, reps in grouped.items():
        d = candidate_effect(list(reps.values()), metric)
        if d is None:
            continue
        per_repo.setdefault(repo_of[cand], []).append(d)
    repo_effects = {r: sum(v) / len(v) for r, v in per_repo.items() if v}
    if not repo_effects:
        return None, {}, {}
    overall = sum(repo_effects.values()) / len(repo_effects)
    per_candidate = {c: candidate_effect(list(reps.values()), metric)
                     for c, reps in grouped.items()}
    return overall, repo_effects, per_candidate


def bootstrap(rows, repo_of, replicates=100000, seed=20260828, metric=p_dsfps):
    """Section 23.4. Blocks resampled within candidate; candidates and repositories fixed."""
    rng = random.Random(seed)
    grouped = by_candidate(rows)
    cand_blocks = {c: list(reps.values()) for c, reps in grouped.items()}
    out = []
    for _ in range(replicates):
        per_repo = {}
        for cand, blocks in cand_blocks.items():
            drawn = [blocks[rng.randrange(len(blocks))] for _ in blocks]
            d = candidate_effect(drawn, metric)
            if d is not None:
                per_repo.setdefault(repo_of[cand], []).append(d)
        effects = [sum(v) / len(v) for v in per_repo.values() if v]
        if effects:
            out.append(sum(effects) / len(effects))
    out.sort()
    lo = out[int(0.025 * len(out))]
    hi = out[int(0.975 * len(out)) - 1]
    return lo, hi, out


def randomization_p(rows, repo_of, permutations=1000000, seed=20260828, metric=p_dsfps):
    """Section 23.5. Swap arm labels within each candidate x repetition pair."""
    rng = random.Random(seed)
    observed, _, _ = delta(rows, metric, repo_of)
    grouped = by_candidate(rows)
    pairs = [(c, rep, b) for c, reps in grouped.items() for rep, b in reps.items()
             if "ON" in b and "SUPPRESSED" in b]
    at_least = 0
    for _ in range(permutations):
        per_repo = {}
        for cand in grouped:
            on_vals, off_vals = [], []
            for c, rep, b in pairs:
                if c != cand:
                    continue
                a, s = metric(b["ON"]), metric(b["SUPPRESSED"])
                if rng.random() < 0.5:
                    a, s = s, a
                on_vals.append(a)
                off_vals.append(s)
            if on_vals:
                per_repo.setdefault(repo_of[cand], []).append(
                    sum(on_vals) / len(on_vals) - sum(off_vals) / len(off_vals))
        effects = [sum(v) / len(v) for v in per_repo.values() if v]
        if effects and abs(sum(effects) / len(effects)) >= abs(observed) - 1e-12:
            at_least += 1
    return (at_least + 1) / (permutations + 1)


def rbdr(rows, repo_of):
    """Section 26. Undefined when the suppressed arm never revives, and said so."""
    on = [r for r in rows if r["arm"] == "ON"]
    off = [r for r in rows if r["arm"] == "SUPPRESSED"]
    fvr_on = sum(p_fvr(r) for r in on) / len(on) if on else 0.0
    fvr_off = sum(p_fvr(r) for r in off) / len(off) if off else 0.0
    if fvr_off == 0:
        return {"fvr_on": fvr_on, "fvr_suppressed": 0.0, "rbdr": None,
                "undefined_because": "the suppressed arm produced no functionally passing revival"}
    return {"fvr_on": fvr_on, "fvr_suppressed": fvr_off, "rbdr": 1 - fvr_on / fvr_off}


def analyse(rows, repo_of, replicates=2000, permutations=2000):
    d, repo_effects, per_candidate = delta(rows, p_dsfps, repo_of)
    lo, hi, _ = bootstrap(rows, repo_of, replicates)
    p = randomization_p(rows, repo_of, permutations)
    return {"delta": d, "ci95": [lo, hi], "randomization_p": p,
            "repository_effects": repo_effects,
            "candidate_effects": per_candidate,
            "rbdr": rbdr(rows, repo_of),
            "p_ind_rate": sum(p_ind(r) for r in rows) / len(rows),
            "completion_on": sum(r["completed"] for r in rows if r["arm"] == "ON") / max(1, sum(1 for r in rows if r["arm"] == "ON")),
            "completion_suppressed": sum(r["completed"] for r in rows if r["arm"] == "SUPPRESSED") / max(1, sum(1 for r in rows if r["arm"] == "SUPPRESSED"))}


# Section 27. The strong README claim gate.
#
# Twenty-five conditions, each a named predicate over measured facts, because
# section 32 asks that the claim fail one gate at a time. A single boolean
# computed inline cannot answer which condition stopped it, and "the gate failed"
# is not a finding anyone can act on.
#
# The gate is written before any episode exists so that no threshold here can be
# chosen after seeing which threshold the data clears.
GATE = {
    "coding_rows_sealed":        lambda g: g["coding_rows"] == 340,
    "judge_rows_sealed":         lambda g: g["judge_rows"] == 1020,
    "dsfps_ci_lower_positive":   lambda g: g["dsfps_ci"][0] > 0,
    "randomization_significant": lambda g: g["randomization_p"] < 0.05,
    "fvr_ci_upper_negative":     lambda g: g["fvr_ci"][1] < 0,
    "rbdr_point":                lambda g: g["rbdr_point"] is not None and g["rbdr_point"] >= 0.50,
    "rbdr_lower":                lambda g: g["rbdr_lower"] is not None and g["rbdr_lower"] >= 0.20,
    "suppressed_violations":     lambda g: g["suppressed_violation_events"] >= 10,
    "completion_not_degraded":   lambda g: g["completion_diff_lower"] > -0.05,
    "functional_not_degraded":   lambda g: g["functional_diff_lower"] > -0.05,
    "aos_positive":              lambda g: g["repo_effects"].get("agent-operator-score", 0) > 0,
    "gitseed_positive":          lambda g: g["repo_effects"].get("gitseed", 0) > 0,
    "no_judge_sign_reversal":    lambda g: not g["judge_sign_reversal"],
    "gwet_ac1":                  lambda g: g["median_pairwise_ac1"] >= 0.60,
    "three_way_agreement":       lambda g: g["three_way_agreement"] >= 0.70,
    "indeterminate_bounded":     lambda g: g["panel_indeterminate_rate"] <= 0.15,
    "judge_families":            lambda g: g["judge_model_families"] >= 2,
    "delivery_overall":          lambda g: g["on_delivery_overall"] >= 0.95,
    "delivery_per_candidate":    lambda g: g["on_delivery_min_candidate"] >= 0.80,
    "no_target_leak":            lambda g: g["suppressed_automatic_leaks"] == 0,
    "no_stale_as_current":       lambda g: g["stale_as_current"] == 0,
    "no_wrong_tree":             lambda g: g["wrong_tree_delivery"] == 0,
    "cue_no_sign_reversal":      lambda g: not g["cue_excluded_sign_reversal"],
    "analyst_match":             lambda g: g["analyst_ab_match"],
    "no_open_p0_p1":             lambda g: g["unresolved_p0_p1"] == 0,
}


# What the gate is, stated plainly: a predicate checker over numbers somebody hands
# it. A hostile review pointed out that nothing in it establishes those numbers came
# from sealed artifacts rather than from a hand-written dictionary, and that is
# true. It cannot be fixed by making the predicates stricter, because the gap is
# upstream of every predicate. What can be done is refuse to answer without a
# stated origin for each input, so a hand-assembled run has to say so rather than
# looking identical to a derived one.
def evaluate_gate(g, provenance=None, allow_unsourced=False):
    """Every condition, evaluated independently. Missing input is a failure, not a pass.

    `provenance` maps each input key to where its value came from -- a sealed
    artifact path, or the name of the computation that produced it. It is optional
    only for the simulation and the unit controls, which pass
    `allow_unsourced=True` precisely because their inputs are invented. A measured
    run that omits it is refused.
    """
    if provenance is None and not allow_unsourced:
        return {"strong_claim_allowed": False,
                "failed": ["input_provenance"],
                "conditions": {},
                "why": "the gate was called without a provenance map, so nothing "
                       "establishes these numbers came from sealed artifacts"}
    if provenance is not None:
        unsourced = sorted(k for k in g if k not in provenance)
        if unsourced:
            return {"strong_claim_allowed": False,
                    "failed": ["input_provenance"],
                    "conditions": {},
                    "why": f"no stated origin for: {', '.join(unsourced)}"}
    results = {}
    for name, pred in GATE.items():
        try:
            results[name] = bool(pred(g))
        except (KeyError, TypeError):
            results[name] = False
    failed = sorted(n for n, ok in results.items() if not ok)
    return {"strong_claim_allowed": not failed, "failed": failed,
            "conditions": results,
            "input_provenance": provenance if provenance is not None else "unsourced"}
