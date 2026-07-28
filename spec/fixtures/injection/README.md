# Injection scanner corpora

Keep these sets separate when reporting scanner results:

- Numbered `.txt` fixtures are pattern-authored positives. They prove each
  shipped pattern matches the examples its author designed for it; they are not
  an independent detection-rate estimate.
- `adversarial.json` is the issue #70 set written without reading
  `INJECTION_PATTERNS`. Report it separately from the pattern-authored set.
- `n*.txt` fixtures are benign negatives. False positives are measured only
  against this set, including the Korean, Japanese and Chinese records.
