const SOURCE = 'bench/results/deterministic-20260729T032652Z.md';

/** The measured cost boundary; avoided rejected-path work has not been measured. */
export const renderEconomicCase = (): readonly string[] => [
  '## 10. Economic case: measured costs, unmeasured benefit',
  '',
  `Source: \`${SOURCE}\`. These are deterministic measurements, not a benefit estimate.`,
  '',
  '- Capture one accepted record: the harvest prompt contract is **6,110 bytes / 1,524 tokens / 105.18 ms p50**; `harvest-verify` is **132.05 ms p50**.',
  '- Per commit: the `commit-msg` hook adds **228.48 ms p50** and the injection hook adds **119.53 ms p50**.',
  '- Query: indexed `context` at 100,000 commits is **496.15 ms p50**.',
  '',
  'The capture measurement also has 923 verify-input tokens and 330 cache-read tokens; it does not measure model generation tokens.',
  '',
  'Threshold form, in a cost unit you choose: **prevented re-proposals required = measured cost / your estimate of work saved by one prevented re-proposal**. The measured numerator is the applicable capture, hook, or query cost above. The denominator is intentionally not supplied.',
  '',
  'That benefit term is unmeasured: this project has not observed a re-proposal being prevented. Issue #141 added rejected-path counters to make the work observable, but no run has used them. No computed break-even value is published.',
  '',
];
