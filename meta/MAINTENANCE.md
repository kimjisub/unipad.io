# Maintenance loop

UniPad is maintained by one person who cannot hold three platforms in their head
at once. This file is the contract an agent works under so that a session can
pick the work up cold, without the maintainer re-explaining anything.

## What actually goes wrong

Inbound is low — roughly four to six items a year — so the failure mode is not
backlog, it is silence. A reproducible crash report sat four months without a
reply; a feature request sat a month until the reporter wrote "hello?". Optimise
for never leaving someone unanswered, not for throughput.

## Where work arrives from

| Channel | How to read it | Status |
|---|---|---|
| GitHub issues and PRs, all three repos | `gh` | working |
| Play Store reviews | Play Developer API, `reviews.list`, service account | verified working |
| App Store reviews | App Store Connect API, `customerReviews`, ES256 JWT | verified working |
| Play crash and ANR clusters | Play Developer Reporting API | **needs the API enabled in GCP project 215327865638** |
| Firebase Crashlytics | no read API; only reachable via BigQuery export | not wired |
| Self-directed | parity check, build health, dependencies | manual |

GitHub and the stores carry different populations. Contributors file issues;
long-time users leave reviews. A one-star review reading "the trace option is
really confusing" will never appear on GitHub, and is still a product signal.

Fold store signals into GitHub issues so there is one queue — label them
`from:play-review`, `from:appstore-review`, `from:vitals`. Only convert reviews
at three stars or below, or ones describing a reproducible bug; positive reviews
are counted, not filed, or the queue fills with praise.

## Autonomy boundary

Do without asking: comment, label, review PRs, open draft PRs, run builds,
reproduce bugs, update this directory.

Draft and get approval before publishing: replies to store reviews. They are
public, hard to retract, and tone carries the app's reputation.

Always ask: merging, pushing to a default branch, production releases, closing
issues or PRs, anything touching UniPack compatibility, and anything with a
licensing or copyright question.

UniPack compatibility is the project's invariant. Contributors have said as much
themselves. Never trade it away automatically.

## Interrupt the maintainer immediately for

Security problems, store rejections, and any contributor blocked for more than a
week. Everything else waits for a batch.

## Releasing

`meta/store-deploy/` holds the deploy skill. Android and iOS both ship from a
local machine because the credentials live in 1Password and the signing material
is local. Read `meta/store-deploy/SKILL.md` before running it; it documents
several environment traps that cost a full afternoon to find once already.

Verified working end to end on 2026-07-28: Play internal track and TestFlight.

## Ground rules learned the hard way

- Run the thing. Seven real defects in the deploy path were invisible to review
  and obvious on first execution.
- A zero exit code from a shell pipeline is the exit code of the last command.
  Check the tool's own output, not `$?` after a pipe.
- Do not truncate a failing build's log. The cause is usually above the summary.
