# Contributing to CommitLore

Thanks for looking. This project is MIT, free forever, and has no commercial tier — contributions stay in the commons.

## The one rule that matters

**No claim without evidence.** This applies to code, docs, and this repo's own commits:

- Performance numbers come from `bench/` runs, not estimates.
- "It works" means you ran it and can paste the output.
- If you didn't test something, say so — `Unverified:` is a first-class trailer here for a reason.

A PR that says "should fix it" gets sent back. A PR that says "reproduced the failure with this script, here's the output before and after" gets merged.

## Where to start

1. Read [`docs/adr/`](docs/adr/) first — the ADRs carry the *why*, including what we deliberately rejected. Proposals that re-litigate a settled ADR need to address its Ruled-out list.
2. Pick an [open issue](https://github.com/MongLong0214/commitlore/issues). Ticket specs live in [`docs/tickets/`](docs/tickets/) with module paths, signatures, and acceptance criteria — enough to implement from.
3. Comment on the issue before starting anything large, so two people don't build the same thing.

## Committed artifact

The installable bundle has one canonical Linux builder. See
[`docs/CANONICAL-BUILD.md`](docs/CANONICAL-BUILD.md) before rebuilding `dist/`;
`npm run build` on another platform can produce different bytes.

## Commit messages: we dogfood the protocol

This repo uses CommitLore trailers in its own history. Try it:

```bash
git log --format='%h %(trailers:key=Ruled-out,valueonly)'
```

For non-trivial commits, capture what the diff can't show:

```text
<imperative summary — why, not what>

<optional body>

Limit: <external limit that shaped this>
Ruled-out: <alternative> | <why it lost>
Certainty: firm|tentative|guess
Blast: local|module|system
Undo: easy|costly|permanent
Warn: <warning for whoever touches this next>
Verified: <what you actually verified>
Unverified: <known gaps>
```

Trivial commits (typos, formatting) get no trailers — noise costs more than it returns. The full vocabulary is in [`spec/SPEC.md`](spec/SPEC.md).

### Dogfooding is enforced, not aspirational

`test/dogfood.test.ts` runs the validator over this repository's real history and fails the build on any violation. It checks that every in-scope record validates clean, carries a unique `Record-Id`, resolves its `Follows:`/`Supersedes:` references, and cites `Evidence:` paths that actually exist.

The in-scope range is **derived, not configured**: it starts at the oldest commit whose record declares `CommitLore-Version:`. Nothing needs updating as history grows, because a hand-maintained cutoff is the first thing to go stale.

**When it fails there are exactly two honest resolutions**, and either way the reasoning gets recorded in the fixing commit:

| The commit was wrong | The rule was wrong |
|---|---|
| Fix the practice. Amend if unpushed; otherwise land a correcting record that `Supersedes:` it. | Change `spec/SPEC.md`, change the schema, **add a fixture that locks in the new rule**, and say in the commit why the old rule was wrong. |

Editing the test to look away is neither. If you find yourself weakening an assertion to get green, that is the signal to pick one of the two columns instead.

This loop has already changed the spec once: `Evidence:` originally required a `#anchor`, and the first records written against the spec — in this repository — hit that rule immediately. Citing a whole file is a normal citation and is exactly as checkable, so the grammar was relaxed and [`spec/fixtures/valid/12-evidence-bare-path.txt`](spec/fixtures/valid/12-evidence-bare-path.txt) plus [`spec/fixtures/invalid/06-format-evidence-not-a-citation.txt`](spec/fixtures/invalid/06-format-evidence-not-a-citation.txt) now pin both sides of the new boundary.

The same loop covers the README: its example commit is [a fixture](spec/fixtures/valid/11-readme-example.txt), and `spec/verify.sh` fails if the two drift apart or if the vocabulary table stops matching SPEC §3. Documentation claims that can be checked by machine are checked by machine.

## Alternative implementations are welcome

The conformance suite is the contract, not our code. If you want a Rust or Go implementation of the protocol, pass `spec/fixtures/` and `spec/contract-cases/` and it's a valid CommitLore implementation. Please open an issue so we can link it.

## Pull requests

- Keep the change scoped to one ticket or one bug. Refactors that ride along with a fix get asked to split.
- Tests are part of the change, not a follow-up. Every ticket spec lists what to test.
- Match the surrounding code — TypeScript strict, named exports, kebab-case filenames, camelCase functions. No new abstraction layers "for later."
- CI runs build, lint, and tests. Red CI means not ready, no exceptions.

## Reporting a security issue

CommitLore's threat model treats commit messages as an untrusted instruction channel for agents ([ADR-0005](docs/adr/ADR-0005-trust-minimal.md)). If you find a way to get a hostile `Warn:` past the demotion rules or the injection heuristics, that's a security bug — please open a private security advisory on GitHub rather than a public issue.

## License

By contributing, you agree your work is licensed under [MIT](LICENSE).
