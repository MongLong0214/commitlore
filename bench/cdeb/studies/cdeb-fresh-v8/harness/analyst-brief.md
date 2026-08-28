# Independent analysis (ANALYST-B)

You are the second, independent analyst on a study. Another analyst has already
implemented the same specification. You have not been given their code and must
not go looking for it.

## What is here

```
SAP.md               the frozen statistical analysis plan, verbatim
sealed/rows/         340 sealed coding rows, one row.json each
sealed/judgements/   1,020 sealed judgements, three per packet
```

## What to do

Implement the plan in `SAP.md` from scratch, in this directory, and report the
numbers it asks for. Write your own code; there is none here to start from.

Details the plan states and are easy to skim past:

- a row's arm is `arm`, its pairing unit is `candidate_id` × `repetition`, and it
  links to its judgements through `packet_id`
- `completion.completed` and `functional_pass` are on the row
- a row may carry `retry_lineage`; the plan says what to do with it

## What to report

One JSON object at the end, with exactly these keys:

```
panel_label_counts        {label: count} over the 340 episodes
dsfps_delta               the primary effect, a float
dsfps_ci                  [lower, upper], 2000 bootstrap replicates, seed 20260828
randomization_p           2000 permutations, seed 20260828
repository_effects        {repository_id: effect}
fvr_on, fvr_suppressed    functional-violation rates per arm
rbdr, rbdr_lower          or null with a reason if undefined
three_way_exact_agreement
median_pairwise_gwet_ac1
fleiss_kappa
panel_indeterminate_rate
completion_on, completion_suppressed
notes                     anything the plan left you to decide, and what you decided
```

Do the reading and the implementation first, and emit the object once at the end.
Never emit a placeholder or a value that says you have not computed it yet: a
schema-complete answer carrying "TBD" reads as a result and is worse than saying
you could not compute something.

If the plan names a quantity without defining it, say so in `notes` and return
null for it rather than inventing a formula. That is not a failure — the first
analyst invented one on the dry run and the invention was the thing worth
catching.
