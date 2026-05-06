# `workspace-health`

Diagnoses overall workspace health, reply-rate issues, bounce risk, account quality, and the next actions to take.

Related: [catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user asks what is working or not working in an Instantly workspace.
- Reply rate, bounce rate, active campaign count, account health, or sender risk needs a first pass.
- The user wants a tag-scoped or campaign-name-scoped triage.
- The team needs to choose which campaign deserves deeper analysis next.

## Primary Surfaces

- Skill source: `skills/workspace-health/SKILL.md`
- Command: `/workspace-health`
- Default agent: `workspace-triager`
- MCP tools: `refresh_data`, `workspace_snapshot`, `analysis_starters`, `analyze_data`

## Expected Flow

1. Start with `workspace_snapshot`, optionally scoped by exact Instantly tag or campaign-name fragment.
2. Pull `analysis_starters(topic="workspace-health")` before custom SQL.
3. Keep broad reads active-only unless the user asks for inactive or historical campaigns.
4. For deliverability questions, combine account health and inbox-placement evidence before blaming copy or targeting.
5. Use `inbox_placement_analytics_labeled` when provider, recipient geography, or recipient type labels matter.
6. End with specific actions ordered by likely impact.

## Output Shape

- Current read: what is healthy, weak, or uncertain.
- Top risks: reply, bounce, sender, lead supply, or data coverage.
- Campaigns to inspect next: ranked with the reason each matters.
- Recommended actions: short, concrete, and ordered.
- Caveats: only evidence limitations that materially affect the answer.

## Evidence Boundaries

Campaign/account headline metrics are exact only when they come from exact aggregate surfaces. Inbox-placement rows are exact test evidence when available, but missing inbox-placement data means no local test evidence was available. It does not prove sender health is clean.
