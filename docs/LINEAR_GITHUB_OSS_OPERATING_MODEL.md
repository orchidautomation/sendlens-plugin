# SendLens OSS Issue Operating Model

This document defines how `sendlens-plugin` should use GitHub and Linear without leaking private strategy, customer context, or internal product thinking into public issue threads.

## Goal

Keep the open-source repo easy to contribute to while keeping sensitive product, GTM, pricing, competitive, and customer information private.

## Core Principle

Treat public GitHub issues and any Linear issue synced to them as public-facing operational surfaces.

Treat internal Linear issues and private docs as the only place for:

- pricing and monetization thinking
- competitive teardown and positioning
- customer names, workspaces, and account details
- candid internal bug commentary
- launch strategy and GTM sequencing
- architecture or roadmap notes that should not be published yet

## Recommended Team Structure

Use two separate Linear work surfaces:

1. `SendLens OSS`
- Purpose: public OSS intake and GitHub-synced issue triage
- Source of truth for community-reported bugs, feature requests, and visible status updates

2. `SendLens`
- Purpose: private product, GTM, architecture, launch, and monetization work
- Source of truth for internal follow-ups, strategy, and sensitive decisions

If needed, add a private project inside the internal team for launch and monetization work:

- `GTM: Positioning & Launch`

## GitHub Sync Recommendation

For the public `sendlens-plugin` repo:

1. Connect the repo to the `SendLens OSS` Linear team.
2. Prefer one-way GitHub-to-Linear sync by default.
3. Only enable two-way issue/comment sync if you intentionally want public updates mirrored from Linear back to GitHub.

Why:

- one-way sync preserves triage convenience inside Linear
- it reduces the chance of accidental public replies from internal Linear discussion
- it keeps GitHub as the public intake surface and Linear as the internal action surface

## Issue Handling Pattern

For every meaningful public OSS issue:

1. Let the GitHub issue sync into `SendLens OSS`.
2. Triage the public issue there.
3. If the issue needs sensitive discussion, create a second internal Linear issue in `SendLens`.
4. Link the internal issue to the public OSS issue with a relation.
5. Keep the public issue clean, concise, and safe for outside readers.

## What Belongs In Public OSS Issues

Safe:

- bug summary
- repro steps
- expected vs actual behavior
- safe implementation notes
- public roadmap intent
- status updates that are acceptable for outside users

Unsafe:

- monetization strategy
- private customer examples
- named workspace diagnostics
- API keys, secrets, or internal infra details
- candid competitive analysis
- rough internal opinions
- launch sequencing or pricing experiments

## What Belongs In Internal Linear Issues

- deeper diagnosis
- real business context
- customer pain and commercial implications
- pricing thoughts
- competitor framing
- feature packaging debates
- messy early thinking
- internal screenshots and sensitive attachments

## Blocks / Agent Guidance

When delegating work to Blocks or any agent:

- use `SendLens OSS` issues only for public-safe OSS work
- use internal `SendLens` issues for strategy, GTM, product packaging, or anything you would not want mirrored into GitHub
- do not ask the agent to continue sensitive discussion inside a synced OSS thread

## Comment Rules

Assume any comment on a GitHub-synced OSS issue may become visible to the wrong audience.

Before commenting on a synced issue, ask:

1. Would I be fine with this being read by users, contributors, competitors, or future customers?
2. Does this contain a private business judgment rather than a public implementation update?
3. Would this be better as an internal linked issue instead?

If the answer to any of those is uncomfortable, move the discussion internal.

## Suggested Naming Pattern

Public synced issue:

- `OSS: MCP tools not registering in Codex`

Internal linked issue:

- `Internal: diagnose Codex MCP registration failure for OSS issue #123`

This makes it visually obvious which thread is safe for public-style discussion and which is not.

## Default Rule Of Thumb

Public repo issues are for:

- software behavior
- contributor communication
- externally safe status

Internal Linear issues are for:

- why it matters
- how it affects launch
- whether it changes pricing, packaging, or positioning
- anything commercially sensitive

## Practical Outcome

This lets SendLens:

- stay open-source and contributor-friendly
- keep GitHub useful as public intake
- preserve internal honesty and speed in Linear
- avoid doxxing strategy, product judgment, customer context, or GTM thinking

## Short Version

Do not use the same synced issue for both community discussion and internal business thinking.

Use:

- GitHub + `SendLens OSS` for public-safe issue handling
- internal `SendLens` issues and private docs for everything sensitive
