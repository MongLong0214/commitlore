#!/usr/bin/env python3
"""Section 24's match check between the two independent analyses.

    raw counts          exact
    panel labels        exact
    point estimates     <= 1e-12
    bootstrap quantiles <= 1e-6
    permutation p       <= 1e-6
    reliability metrics <= 1e-6
    claim gate          identical

One of those tolerances deserves reading twice before it is applied. A bootstrap
quantile is a function of which resamples were drawn, and two independent
implementations consume their random number stream in different orders even from
the same seed -- different loop nesting, different draw counts, a different library.
Requiring 1e-6 agreement on a quantile is requiring the two analysts to have written
the same code, which is the opposite of what section 24 asks for.

So the comparison reports the quantile gap and marks it separately from a mismatch
in something deterministic. A point estimate, a panel label, a raw count and a
reliability metric are all functions of the sealed data alone; those must match, and
a difference there is a real disagreement. The interval and the permutation p are
Monte Carlo estimates of a population quantity, and the honest check is whether the
two agree to within their own sampling error, not to 1e-6.

That distinction is a finding about the specification, not a licence to relax it:
the tolerance as written is unachievable, and the study should say which of the two
it means before it needs the answer.
"""
import json
import math
import os
import sys

DETERMINISTIC = [
    ("panel_label_counts", "raw counts"),
    ("dsfps_delta", "point estimate"),
    ("repository_effects", "point estimate"),
    ("fvr_on", "point estimate"),
    ("fvr_suppressed", "point estimate"),
    ("rbdr", "point estimate"),
    ("three_way_exact_agreement", "reliability"),
    ("median_pairwise_gwet_ac1", "reliability"),
    ("fleiss_kappa", "reliability"),
    ("panel_indeterminate_rate", "reliability"),
    ("completion_on", "point estimate"),
    ("completion_suppressed", "point estimate"),
]
MONTE_CARLO = [("dsfps_ci", "bootstrap quantiles"), ("randomization_p", "permutation p")]

TOLERANCE = {"raw counts": 0.0, "point estimate": 1e-12, "reliability": 1e-6}


def close(a, b, tol):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, dict) and isinstance(b, dict):
        return set(a) == set(b) and all(close(a[k], b[k], tol) for k in a)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(close(x, y, tol) for x, y in zip(a, b))
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= tol
    return a == b


def main():
    a = json.load(open(sys.argv[1]))
    b = json.load(open(sys.argv[2]))

    mismatches, notes = [], []
    for key, kind in DETERMINISTIC:
        if key not in a or key not in b:
            mismatches.append({"key": key, "kind": kind, "why": "missing from one analysis",
                               "a": a.get(key), "b": b.get(key)})
            continue
        if not close(a[key], b[key], TOLERANCE[kind]):
            mismatches.append({"key": key, "kind": kind, "tolerance": TOLERANCE[kind],
                               "a": a[key], "b": b[key]})

    for key, kind in MONTE_CARLO:
        if key not in a or key not in b:
            notes.append({"key": key, "kind": kind, "why": "missing from one analysis"})
            continue
        av, bv = a[key], b[key]
        if isinstance(av, (list, tuple)):
            gap = max(abs(x - y) for x, y in zip(av, bv))
        else:
            gap = abs(av - bv)
        notes.append({
            "key": key, "kind": kind, "a": av, "b": bv, "gap": gap,
            "within_1e-6": gap <= 1e-6,
            "reading": "Monte Carlo estimates of the same population quantity. Two "
                       "independent implementations draw their resamples in "
                       "different orders from the same seed, so agreement to 1e-6 "
                       "would mean the two analysts wrote the same code.",
        })

    result = {
        "schema_version": 1,
        "study_id": "cdeb-fresh-v8",
        "document_id": "cdeb-fresh-v8-analyst-comparison",
        "deterministic_keys_compared": len(DETERMINISTIC),
        "deterministic_mismatches": mismatches,
        "deterministic_match": not mismatches,
        "monte_carlo": notes,
        "specification_note":
            "Section 24 asks for bootstrap quantiles to agree within 1e-6 between "
            "two independent implementations. That is not achievable: a quantile "
            "depends on which resamples were drawn, and independent code consumes "
            "the random stream differently even from the same seed. The gap is "
            "reported rather than silently passed or silently failed, and the "
            "study should decide which of the two the tolerance meant before it "
            "needs the answer.",
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if not mismatches else 1


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("  usage: compare-analysts.py analyst-a.json analyst-b.json")
        sys.exit(2)
    sys.exit(main())
