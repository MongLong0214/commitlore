# Source authorization for the CDEB corpus

CDEB reads real decision records out of real repositories and publishes what it
finds. §3.3 requires repository ownership and decision authorship to be
disclosed, and CDEB-10 lists privacy authorization among the things that must
exist before the corpus is sealed. This file is that authorization, and the
`source_authorization_id` in each repository's freeze entry (§6.1) points here.

A public repository is not consent to be studied. Visibility and authorization
are different things, and the study needs the second one named by the person who
holds it — not inferred from the first.

## Granted

The owner of the repositories below authorized their use as CDEB source data,
and authorized publishing the result transparently, including repository
ownership and decision authorship, on 2026-08-11.

| authorization_id | repository | owner |
|---|---|---|
| `auth-owner-2026-08-11` | agent-operator-score | MongLong0214 |
| `auth-owner-2026-08-11` | logic-pro-mcp | MongLong0214 |
| `auth-owner-2026-08-11` | stock-ai-newsletter | MongLong0214 |
| `auth-owner-2026-08-11` | hermes-agent (fork) | MongLong0214 |

## What the authorization does not extend to

**Commits authored by other people.** `hermes-agent` is a fork of an upstream
project, and the substantial majority of its recent history is upstream authors'
work pulled in — 1,052 of the commits in one recent week. The owner can
authorize the use of their own repository and their own decisions; they cannot
authorize on behalf of upstream contributors. Any task drawn from that
repository must rest on a record the owner authored, and §3.2's candidate
registry field `decision_source_refs` is where that is checked rather than
assumed.

**The CommitLore repository itself.** §3.3 excludes it from the primary corpus,
and no authorization changes that. It is excluded because the product's own
decisions are not independent of the product being measured, which is a
methodological exclusion rather than a permission one.

## Consequence for what the result may say

Every authorized repository is operated by the same person who authored this
benchmark and the product it measures. That is §3.3's **Tier B**, and the rule
attached to it is not optional: the result must read *"four author-operated
repositories"* and must not describe itself as independent external validation.

Tier A would require at least two repositories where the decision author or
accepting reviewer differs from the benchmark and product author. Nothing here
reaches that, and no wording may imply otherwise.

## Corpus arithmetic, stated plainly

> **Amended 2026-08-19 (#771): §3.3 now requires four.** The paragraph below
> described the state under the original five, and the arithmetic it reports is
> still what was counted. What changed is the requirement, not the census —
> and the task quota did not move, so §3.2 rule 5 is not what this went around:
> candidates are abundant (71, 27, 29 and 17 with an explicit rejection reason
> against a quota of 30), and it is repositories that were short.
>
> The rule-5 argument is not what this rests on, and §3.3's amendment says so:
> a threshold was lowered, and the reason it is not post-hoc selection is that
> no valid result has ever been produced — `test/cdeb-pilot-tasks.test.ts`
> carries a deliberately failing control showing an untouched tree scores a
> success. Read that paragraph, not this one, for the load-bearing claim.

§3.3 required five repositories, and the exclusion of the CommitLore repository
leaves four authorized ones. A fifth was needed before the corpus could be sealed,
and §3.2's rule 5 is explicit about what may not be done to close that gap:
when candidates are short, the study stops rather than lowering the bar or
creating records for it.
