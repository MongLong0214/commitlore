---
description: Read and write the repository's unattended-capture setting — commitlore auto status|on|off
argument-hint: "[status|on|off]"
---

!"${CLAUDE_PLUGIN_ROOT}/scripts/commitlore-run.sh" auto $ARGUMENTS

Report the output above exactly as it stands. The setting lives in
`.commitlore-policy.json` at the repository root and is committed with it, so
turning it on applies to everyone who clones the repository. Never edit that
file yourself — the command above is its only writer.
