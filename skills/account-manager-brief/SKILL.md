---
name: "account-manager-brief"
description: "Create client-safe AM briefs, daily action queues, and risk summaries from SendLens evidence."
---

# Account Manager Brief

Create client-safe AM briefs, daily action queues, and risk summaries from SendLens evidence.

## Tools In This Skill

- `workspace_snapshot`
- `analysis_starters`
- `analyze_data`
- `refresh_status`

## Usage

- Use this when the user asks what to tell a client, what needs attention today, what changed, or what an account manager should do next.
- Start with `workspace_snapshot` for broad context, then pull `analysis_starters(topic="account-manager-brief")`.
- Stay inside the SendLens MCP tool surface. If required SendLens tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server. Do not inspect local files, run shell setup checks, parse cached outputs with `jq`, or query DuckDB through shell fallbacks.
- If the user provides a campaign name or Instantly tag, scope the brief before ranking actions.
- Keep broad reads active-only by default. Include inactive or historical campaigns only when the user explicitly asks for them.
- Separate internal action priority from client-safe language. Client-facing briefs should not expose noisy implementation details unless they explain a clear ask or risk.
- Always include an action queue ordered by urgency and impact.
- For runway risks, use campaign-performance runway recipes before claiming when volume will run out.
- For deliverability risks, use workspace-health deliverability recipes before blaming copy or targeting.
- For copy, ICP, or reply conclusions, narrow to one campaign and switch to the relevant specialist skill before making detailed claims.

## Output Shape

- Current read: one short paragraph with wins and risks.
- Client-safe update: concise wording an AM can send.
- Action queue: ranked actions with owner/next step when inferable.
- Watchlist: campaigns or tags that need follow-up.
- Caveats: only the evidence limitations that materially affect the recommendation.

## Example Requests

- "What should I tell the client this week?"
- "Give me today's AM action queue."
- "Which campaigns need attention before the client notices?"
- "Draft a client-safe update for this tag."
