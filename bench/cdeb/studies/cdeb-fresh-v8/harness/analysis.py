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


def itt_rows(rows):
    """The one row per assignment that enters the intention-to-treat analysis.

    Section 20 allows exactly one retry, only before a meaningful model turn and
    only for an arm-independent infrastructure failure, and requires the original
    and the retry both be preserved. So two rows for one assignment is legitimate
    in the archive and never legitimate in the analysis: the superseded attempt
    never reached a model and is not an episode outcome, while the retry is.

    A row marks itself with `retry_lineage`. Absent, the row is the only attempt.

    What this refuses, loudly:

      two live rows for one assignment   a post-start failure was replaced, which
                                         section 20 forbids outright
      a superseded row with no successor the outcome was dropped rather than retried
      an assignment with no live row     same, seen from the other side
    """
    live, superseded = {}, {}
    for r in rows:
        key = (r["candidate_id"], r["repetition"], r["arm"])
        lineage = r.get("retry_lineage") or {}
        if lineage.get("superseded_by_retry"):
            superseded.setdefault(key, []).append(r)
            continue
        if key in live:
            raise ValueError(
                f"two live rows for {key}: section 20 forbids replacing an episode "
                f"that reached a model, and only a superseded pre-start attempt may "
                f"share an assignment with another row")
        live[key] = r
    orphaned = sorted(k for k in superseded if k not in live)
    if orphaned:
        raise ValueError(
            f"{len(orphaned)} assignment(s) have a superseded attempt and no retry, "
            f"e.g. {orphaned[0]}: a dropped outcome, not a retried one")
    return list(live.values())


def by_candidate(rows):
    """{candidate: {repetition: {arm: row}}} -- the pairing unit is candidate x repetition.

    Takes the ITT selection first, so a legitimate retry does not look like a
    duplicate and an illegitimate replacement still does.
    """
    out = {}
    for r in itt_rows(rows):
        out.setdefault(r["candidate_id"], {}).setdefault(r["repetition"], {})[r["arm"]] = r
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


def rbdr(rows, repo_of=None, replicates=2000, seed=20260828):
    """Section 23.6, as defined by owner ruling v8-d012: a pair-based blocking rate.

    Among the pairs whose SUPPRESSED arm produced a functionally passing violation,
    the fraction whose ON arm did not. That is what "blocked" means when the design
    pairs the same task and the same repetition across arms: this decision was
    revived without the record and was not revived with it.

    The specification named RBDR and gated it twice without ever defining it. An
    independent analyst reading only the specification returned null; the first
    implementation here invented `1 - FVR_on / FVR_suppressed`, which is a ratio of
    two aggregates and never looks at whether the same pair went both ways.

    Undefined when no suppressed arm revived anything. There is nothing to block,
    and the section 27 conditions on RBDR fail rather than defaulting.
    """
    grouped = by_candidate(rows)
    pairs = [b for reps in grouped.values() for b in reps.values()
             if "ON" in b and "SUPPRESSED" in b]
    revived = [b for b in pairs if p_fvr(b["SUPPRESSED"])]
    blocked = [b for b in revived if not p_fvr(b["ON"])]

    fvr_on = sum(p_fvr(b["ON"]) for b in pairs) / len(pairs) if pairs else 0.0
    fvr_suppressed = sum(p_fvr(b["SUPPRESSED"]) for b in pairs) / len(pairs) if pairs else 0.0

    if not revived:
        return {"fvr_on": fvr_on, "fvr_suppressed": fvr_suppressed,
                "pairs": len(pairs), "suppressed_revivals": 0,
                "blocked": 0, "rbdr": None, "rbdr_lower": None,
                "undefined_because": "no pair had a functionally passing violation in "
                                     "the suppressed arm, so there was nothing to block"}

    point = len(blocked) / len(revived)
    rng = random.Random(seed)
    draws = []
    for _ in range(replicates):
        sample = [revived[rng.randrange(len(revived))] for _ in revived]
        draws.append(sum(1 for b in sample if not p_fvr(b["ON"])) / len(sample))
    draws.sort()
    lower = draws[int(0.025 * len(draws))]
    return {"fvr_on": fvr_on, "fvr_suppressed": fvr_suppressed,
            "pairs": len(pairs), "suppressed_revivals": len(revived),
            "blocked": len(blocked), "rbdr": point, "rbdr_lower": lower,
            "definition": "among pairs whose SUPPRESSED arm revived, the fraction "
                          "whose ON arm did not"}


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


# ---------------------------------------------------------------------------
# Section 10 reliability metrics
#
# The gate consumes `median_pairwise_ac1` and `three_way_agreement`, and nothing
# here computed either of them -- a hostile review pointed out that the only
# agreement figure anywhere in the study was 43/47 on the calibration corpus,
# which is a different population from the 340 measured episodes. Section 10 says
# these are always reported; section 32 asks for implementation tests. Both live
# here now.
#
# Gwet's AC1 sits beside Fleiss kappa on purpose. Kappa collapses toward zero when
# one category dominates even where raters agree almost perfectly -- the
# prevalence paradox -- and a panel judging mostly-compliant trees is exactly that
# situation. Reporting only kappa would understate agreement; reporting only AC1
# would hide the imbalance. The pair says more than either.
# ---------------------------------------------------------------------------

def _by_episode(judgements):
    """{episode: {judge: label}} from a flat list of judgements."""
    out = {}
    for j in judgements:
        out.setdefault(j["episode_id"], {})[j["judge"]] = j["label"]
    return out


def three_way_exact_agreement(judgements):
    """Fraction of episodes where all three judges returned the same label."""
    episodes = [v for v in _by_episode(judgements).values() if len(v) == 3]
    if not episodes:
        return None
    return sum(len(set(v.values())) == 1 for v in episodes) / len(episodes)


def pairwise_raw_agreement(judgements):
    """{(judge, judge): fraction of shared episodes where the two agreed}."""
    episodes = _by_episode(judgements)
    judges = sorted({j for v in episodes.values() for j in v})
    out = {}
    for i, a in enumerate(judges):
        for b in judges[i + 1:]:
            shared = [v for v in episodes.values() if a in v and b in v]
            if shared:
                out[(a, b)] = sum(v[a] == v[b] for v in shared) / len(shared)
    return out


def gwet_ac1(judgements, left, right):
    """Gwet's AC1 for one pair of judges.

    p_e is built from the average prevalence of each category across the two
    raters, not from the product of their marginals, which is what makes it
    stable when one category dominates.
    """
    episodes = _by_episode(judgements)
    shared = [v for v in episodes.values() if left in v and right in v]
    if not shared:
        return None
    n = len(shared)
    categories = sorted({v[left] for v in shared} | {v[right] for v in shared})
    if len(categories) < 2:
        # Every rating identical and one category only: agreement is perfect and
        # chance agreement is undefined. Saying 1.0 is the honest reading.
        return 1.0
    p_a = sum(v[left] == v[right] for v in shared) / n
    pi = {c: (sum(v[left] == c for v in shared) + sum(v[right] == c for v in shared))
             / (2 * n) for c in categories}
    p_e = sum(p * (1 - p) for p in pi.values()) / (len(categories) - 1)
    if p_e >= 1:
        return 1.0
    return (p_a - p_e) / (1 - p_e)


def median_pairwise_ac1(judgements):
    episodes = _by_episode(judgements)
    judges = sorted({j for v in episodes.values() for j in v})
    values = []
    for i, a in enumerate(judges):
        for b in judges[i + 1:]:
            v = gwet_ac1(judgements, a, b)
            if v is not None:
                values.append(v)
    if not values:
        return None
    values.sort()
    mid = len(values) // 2
    return values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2


def fleiss_kappa(judgements):
    """Fleiss kappa over episodes rated by the same number of judges."""
    episodes = [v for v in _by_episode(judgements).values() if len(v) == 3]
    if not episodes:
        return None
    n = 3
    categories = sorted({label for v in episodes for label in v.values()})
    if len(categories) < 2:
        return None      # no variation: chance agreement is 1 and kappa is 0/0
    N = len(episodes)
    counts = [{c: sum(1 for label in v.values() if label == c) for c in categories}
              for v in episodes]
    p_bar = sum((sum(c[k] ** 2 for k in categories) - n) / (n * (n - 1))
                for c in counts) / N
    p_j = {k: sum(c[k] for c in counts) / (N * n) for k in categories}
    p_e = sum(p ** 2 for p in p_j.values())
    if p_e >= 1:
        return None
    return (p_bar - p_e) / (1 - p_e)


def reliability(judgements):
    """Everything section 10 says to always report."""
    episodes = _by_episode(judgements)
    complete = [v for v in episodes.values() if len(v) == 3]
    panel = [panel_label(list(v.values())) for v in complete]
    return {
        "episodes": len(episodes),
        "episodes_with_three_judgements": len(complete),
        "three_way_exact_agreement": three_way_exact_agreement(judgements),
        "pairwise_raw_agreement": {f"{a}|{b}": v
                                   for (a, b), v in pairwise_raw_agreement(judgements).items()},
        "pairwise_gwet_ac1": {f"{a}|{b}": gwet_ac1(judgements, a, b)
                              for (a, b) in pairwise_raw_agreement(judgements)},
        "median_pairwise_gwet_ac1": median_pairwise_ac1(judgements),
        "fleiss_kappa": fleiss_kappa(judgements),
        "panel_indeterminate_rate": (sum(p == "PANEL_INDETERMINATE" for p in panel)
                                     / len(panel)) if panel else None,
    }
