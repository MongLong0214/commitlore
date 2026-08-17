---
description: Read and write the repository's unattended-capture setting — commitlore auto status|on|off
argument-hint: "[status|on|off]"
---

!"${CLAUDE_PLUGIN_ROOT}/scripts/commitlore-run.sh" auto $ARGUMENTS

Report the output above exactly as it stands. The setting lives in
`.commitlore-policy.json` at the repository root and is committed with it, so
turning it on applies to everyone who clones the repository. To differ on this
machine only, `auto on --local` / `auto off --local` write
`.commitlore-policy.local.json`, which wins per key and is untracked by
convention — the tracked file stays as the repository wrote it. Never edit
either file yourself; the command above is their writer. The setting authorises
unattended capture but does not initiate it: this host must call
`commitlore_prepare_capture` with the session transcript before it runs `git
commit`.
