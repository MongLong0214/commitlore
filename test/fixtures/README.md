# Transcript format fixtures

## `claude-transcript-shape.jsonl`

Twenty records, one of each container shape, taken from a **real** Claude Code
transcript and sanitized before being committed (#1049).

| | |
|---|---|
| host | Claude Code **2.1.271** (the `version` field inside the records reads `2.1.263`, which is the build that wrote them) |
| platform | macOS 26.3, arm64 |
| source | `~/.claude/projects/<slug>/<session-id>.jsonl`, 47 MB at the time of capture |
| captured | 2026-09-18 |

### What was kept

The **shape**: every record `type` observed, the keys each type carries, the
block types inside `message.content`, and the host wrappers that make a record
something other than authored speech. That is what
`bench/jev/source-claude.ts` makes decisions about, so that is what a format
fixture has to preserve.

The twenty shapes, which is the list the reader is written against:

```
last-prompt  custom-title  agent-name  mode  permission-mode
file-history-snapshot  file-history-delta  attachment  system
queue-operation  bridge-session  atis-latch  pr-link
user:string  user:string:wrapped  user:text  user:tool_result
assistant:text  assistant:thinking  assistant:tool_use
```

### What was removed

Every word anybody wrote. Each text value was replaced with a synthetic
sentence of the same broad kind, ids and paths with fixed placeholders, and any
payload that could carry arbitrary content (`attachment`, `snapshot`, `backup`,
`atis`) with a typed stub. The sanitizer asserts that none of `commitlore`,
`Isaac`, `apikey`, `MongLong` or the real session id survives, and it fails
rather than writing a file that still contains one.

### Why it is worth committing

A hand-written fixture only tests the reader against what its author already
believed the format was. Two of the reader's exclusions exist *because* of what
this capture showed and nothing else would have:

- `<local-command-stdout>` arrives as `type: "user"` — command output wearing a
  conversation role, through a door that is not `tool_result`.
- `attachment` records carry injected context, so an old memory would otherwise
  be read as a new statement.

### Refreshing it

Re-run the sanitizer against a current transcript when the host's format
changes. Record the new host version in the table above; a fixture whose
provenance is unstated is a fixture nobody can judge.
