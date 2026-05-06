# `campaign-launch-qa`

Checks whether a campaign is ready to launch, scale, resume, clone, or hand off.

Related: [catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user asks whether a campaign is ready to turn on.
- A campaign is about to scale, resume, clone, or move to an AM/client handoff.
- Sender setup, lead supply, templates, tracking, schedule, or sender health need blocker review.

## Primary Surfaces

- Skill source: `skills/campaign-launch-qa/SKILL.md`
- Command: `/campaign-launch-qa`
- Default agent: `campaign-analyst`
- MCP tools: `workspace_snapshot`, `analysis_starters`, `analyze_data`, `load_campaign_data`

## Expected Flow

1. Pull `analysis_starters(topic="campaign-launch-qa")`.
2. Use the provided campaign name or campaign ID as the scope.
3. Check blockers before polish.
4. Pair with copy analysis when the user asks about personalization safety.
5. Apply cold-email best-practice rules when interpreting tracking and bounce risk.

## Output Shape

- Verdict: `ready`, `ready_with_warnings`, or `blocked`.
- Blockers: issues that should stop launch.
- Warnings: issues that can launch only with eyes open.
- Ready checks: what looks correct.
- Next actions: exact fixes in priority order.

## Evidence Boundaries

Do not mark a campaign ready when sender inventory, lead supply, or templates are missing. Missing inbox-placement evidence should be described as missing evidence, not a clean sender-health result.
