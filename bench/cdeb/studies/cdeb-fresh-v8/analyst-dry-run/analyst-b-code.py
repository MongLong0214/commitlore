#!/usr/bin/env python3
"""Independent implementation of the frozen analysis plan in SAP.md."""

from __future__ import annotations

import json
import math
import random
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median


ROOT = Path(__file__).parent
SEED = 20260828
N_RESAMPLES = 2000
LABELS = ("COMPLIANT", "INDETERMINATE", "VIOLATION")


def read_json(path: Path) -> dict:
    with path.open() as handle:
        return json.load(handle)


def percentile(values: list[float], p: float) -> float:
    """Linear-interpolated percentile, p expressed on [0, 1]."""
    ordered = sorted(values)
    position = (len(ordered) - 1) * p
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (position - lower) * (ordered[upper] - ordered[lower])


def panel_label(labels: list[str]) -> str:
    counts = Counter(labels)
    if counts["VIOLATION"] >= 2:
        return "PANEL_VIOLATION"
    if counts["COMPLIANT"] >= 2:
        return "PANEL_COMPLIANT"
    # This includes >=2 indeterminate and the one-of-each case.
    return "PANEL_INDETERMINATE"


def ac1_for_pair(a: list[str], b: list[str]) -> float:
    """Nominal, unweighted Gwet AC1 for one pair of judges."""
    n = len(a)
    observed = sum(left == right for left, right in zip(a, b)) / n
    proportions = {
        label: (a.count(label) + b.count(label)) / (2 * n)
        for label in LABELS
    }
    expected = sum(p * (1 - p) for p in proportions.values()) / (len(LABELS) - 1)
    return (observed - expected) / (1 - expected)


def fleiss_kappa(ratings: list[list[str]]) -> float:
    """Fleiss' kappa for three nominal ratings on every episode."""
    n_items = len(ratings)
    n_raters = len(ratings[0])
    category_totals = Counter(label for item in ratings for label in item)
    p_categories = [category_totals[label] / (n_items * n_raters) for label in LABELS]
    p_bar = sum(
        sum(Counter(item)[label] ** 2 for label in LABELS) - n_raters
        for item in ratings
    ) / (n_items * n_raters * (n_raters - 1))
    p_expected = sum(p * p for p in p_categories)
    return (p_bar - p_expected) / (1 - p_expected)


def main() -> None:
    rows = [read_json(path) for path in (ROOT / "sealed/rows").glob("*/row.json")]
    rows.sort(key=lambda row: row["episode_index"])
    if len(rows) != 340:
        raise ValueError(f"expected 340 rows, found {len(rows)}")

    judgements: dict[str, dict[str, str]] = defaultdict(dict)
    for path in sorted((ROOT / "sealed/judgements").glob("*/out.judge-*.json")):
        judgement = read_json(path)
        judge = path.stem.removeprefix("out.")
        packet_id = judgement["packet_id"]
        if judge in judgements[packet_id]:
            raise ValueError(f"duplicate {judge} judgement for {packet_id}")
        judgements[packet_id][judge] = judgement["label"]

    if set(judgements) != {row["packet_id"] for row in rows}:
        raise ValueError("row packet IDs and judgement packet IDs do not match")
    judge_ids = ("judge-1", "judge-2", "judge-3")
    if any(set(labels) != set(judge_ids) for labels in judgements.values()):
        raise ValueError("every packet must have exactly one judgement from each judge")

    for row in rows:
        labels = [judgements[row["packet_id"]][judge] for judge in judge_ids]
        if any(label not in LABELS for label in labels):
            raise ValueError(f"unexpected label on {row['packet_id']}")
        row["labels"] = labels
        row["panel_label"] = panel_label(labels)
        row["dsfps"] = int(
            row["completion"]["completed"]
            and row["functional_pass"]
            and row["panel_label"] == "PANEL_COMPLIANT"
        )
        row["fvr"] = int(row["functional_pass"] and row["panel_label"] == "PANEL_VIOLATION")

    pair_groups: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for row in rows:
        pair_groups[(row["candidate_id"], row["repetition"])].append(row)
    pairs = []
    for key in sorted(pair_groups):
        pair = pair_groups[key]
        if len(pair) != 2 or {row["arm"] for row in pair} != {"ON", "SUPPRESSED"}:
            raise ValueError(f"bad arm pair for {key}")
        if len({row["repository_id"] for row in pair}) != 1:
            raise ValueError(f"repository mismatch in pair {key}")
        by_arm = {row["arm"]: row for row in pair}
        pairs.append((by_arm["ON"], by_arm["SUPPRESSED"]))
    if len(pairs) != 170:
        raise ValueError(f"expected 170 paired blocks, found {len(pairs)}")

    candidate_repositories: dict[str, str] = {}
    for row in rows:
        previous = candidate_repositories.setdefault(row["candidate_id"], row["repository_id"])
        if previous != row["repository_id"]:
            raise ValueError("candidate appears in multiple repositories")

    def effect_from_pairs(source_pairs: list[tuple[dict, dict]]) -> tuple[float, dict[str, float]]:
        by_candidate: dict[str, list[float]] = defaultdict(list)
        for on, suppressed in source_pairs:
            by_candidate[on["candidate_id"]].append(on["dsfps"] - suppressed["dsfps"])
        candidate_effect = {candidate: sum(values) / len(values) for candidate, values in by_candidate.items()}
        repository_effect: dict[str, list[float]] = defaultdict(list)
        for candidate, value in candidate_effect.items():
            repository_effect[candidate_repositories[candidate]].append(value)
        repository_effects = {repo: sum(values) / len(values) for repo, values in repository_effect.items()}
        if set(repository_effects) != {"agent-operator-score", "gitseed"}:
            raise ValueError("unexpected repository set")
        primary = (repository_effects["agent-operator-score"] + repository_effects["gitseed"]) / 2
        return primary, repository_effects

    delta, repository_effects = effect_from_pairs(pairs)

    # The SAP fixes candidates and repositories and resamples paired repeats inside each candidate.
    pairs_by_candidate: dict[str, list[tuple[dict, dict]]] = defaultdict(list)
    for pair in pairs:
        pairs_by_candidate[pair[0]["candidate_id"]].append(pair)
    for candidate in pairs_by_candidate:
        pairs_by_candidate[candidate].sort(key=lambda pair: pair[0]["repetition"])
    if any(len(value) != 10 for value in pairs_by_candidate.values()):
        raise ValueError("every candidate must have ten repeat pairs")
    rng = random.Random(SEED)
    bootstrap = []
    for _ in range(N_RESAMPLES):
        resampled = []
        for candidate in sorted(pairs_by_candidate):
            blocks = pairs_by_candidate[candidate]
            resampled.extend(blocks[rng.randrange(len(blocks))] for _ in blocks)
        bootstrap.append(effect_from_pairs(resampled)[0])
    dsfps_ci = [percentile(bootstrap, 0.025), percentile(bootstrap, 0.975)]

    # Each of the 170 paired blocks has an independently exchangeable arm assignment.
    rng = random.Random(SEED)
    observed_abs = abs(delta)
    extreme = 0
    for _ in range(N_RESAMPLES):
        permuted = [(suppressed, on) if rng.randrange(2) else (on, suppressed) for on, suppressed in pairs]
        if abs(effect_from_pairs(permuted)[0]) >= observed_abs:
            extreme += 1
    # Add-one correction makes the Monte Carlo p-value valid even if no draw is extreme.
    randomization_p = (extreme + 1) / (N_RESAMPLES + 1)

    counts = Counter(row["panel_label"] for row in rows)
    by_arm = {arm: [row for row in rows if row["arm"] == arm] for arm in ("ON", "SUPPRESSED")}
    rate = lambda field, arm: sum(row[field] for row in by_arm[arm]) / len(by_arm[arm])
    completion_rate = lambda arm: sum(row["completion"]["completed"] for row in by_arm[arm]) / len(by_arm[arm])

    ratings = [row["labels"] for row in rows]
    exact_agreement = sum(len(set(item)) == 1 for item in ratings) / len(ratings)
    ac1s = [
        ac1_for_pair([item[i] for item in ratings], [item[j] for item in ratings])
        for i, j in ((0, 1), (0, 2), (1, 2))
    ]

    result = {
        "panel_label_counts": dict(sorted(counts.items())),
        "dsfps_delta": delta,
        "dsfps_ci": dsfps_ci,
        "randomization_p": randomization_p,
        "repository_effects": dict(sorted(repository_effects.items())),
        "fvr_on": rate("fvr", "ON"),
        "fvr_suppressed": rate("fvr", "SUPPRESSED"),
        "rbdr": None,
        "three_way_exact_agreement": exact_agreement,
        "median_pairwise_gwet_ac1": median(ac1s),
        "fleiss_kappa": fleiss_kappa(ratings),
        "panel_indeterminate_rate": counts["PANEL_INDETERMINATE"] / len(rows),
        "completion_on": completion_rate("ON"),
        "completion_suppressed": completion_rate("SUPPRESSED"),
        "notes": (
            "RBDR is null because SAP.md names it but gives no definition. "
            "Bootstrap and permutation use 2,000 replicates each with Python's MT19937 seeded 20260828; "
            "the CI uses linear-interpolated percentile endpoints and the two-sided Monte Carlo p-value uses a +1 correction."
        ),
    }
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
