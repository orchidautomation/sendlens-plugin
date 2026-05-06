# `account-manager-brief`

Creates client-safe account-manager briefs, daily action queues, and risk summaries from SendLens evidence.

Related: [catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user asks what to tell a client.
- An AM needs today's action queue.
- A workspace or tag needs a concise status update with risks and asks.
- Internal findings need to be converted into client-safe language.

## Primary Surfaces

- Skill source: `skills/account-manager-brief/SKILL.md`
- Command: `/account-manager-brief`
- Default agent: `workspace-triager`
- MCP tools: `workspace_snapshot`, `analysis_starters`, `analyze_data`, `refresh_status`

## Expected Flow

1. Start with `workspace_snapshot` for broad context.
2. Pull `analysis_starters(topic="account-manager-brief")`.
3. Scope by campaign name or Instantly tag when provided.
4. Use campaign-performance runway recipes before making runway claims.
5. Use workspace-health deliverability recipes before attributing weak replies to copy or targeting.
6. Switch to copy, ICP, or reply specialists before making detailed claims in those lanes.

## Output Shape

- Current read: short wins and risks.
- Client-safe update: wording an AM can send or adapt.
- Internal action queue: ranked by urgency and impact.
- Watchlist: campaigns or tags needing follow-up.
- Caveats: only evidence limits that affect the recommendation.

## Evidence Boundaries

Separate internal action priority from client-facing wording. Do not expose noisy implementation details unless they explain a clear client ask, risk, or next step.
