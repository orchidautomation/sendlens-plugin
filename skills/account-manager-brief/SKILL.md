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

## References

- `../workspace-health/references/evidence-classes.md`
- `../workspace-health/references/metric-basis.md`
- `../workspace-health/references/output-schema.md`

Read the evidence and output references before drafting a client-safe brief.

## When To Use

- Use this when the user asks what to tell a client, what needs attention today, what changed, or what an account manager should do next.
- If the user provides a campaign name or Instantly tag, scope the brief before ranking actions.
- Keep broad reads active-only by default. Include inactive or historical campaigns only when explicitly requested.

## Protocol

### Stage 1: Start Broad, Then Scope

- Start with `workspace_snapshot`, scoped by tag or campaign name when provided.
- Pull `analysis_starters(topic="account-manager-brief")` before custom analysis.
- Use `refresh_status` once only when a readiness/cache response asks for it.

### Stage 2: Build The Evidence Basis

- Use exact campaign/account/tag aggregates for the current read and action priority.
- For runway risks, use campaign-performance runway recipes before claiming when volume will run out.
- For deliverability risks, use workspace-health deliverability recipes before blaming copy or targeting.
- For copy, ICP, or reply-body conclusions, narrow to one campaign and switch to the relevant specialist skill before making detailed claims.

### Stage 3: Separate Internal And Client-Safe Language

- Internal action priority can mention operational details, coverage gaps, and evidence caveats.
- Client-facing briefs should state what matters, what is being done, and what the client needs to decide. Do not expose noisy implementation details unless they explain a clear ask or risk.
- Keep unsupported claims out of client-safe wording.

### Stage 4: Answer With Evidence Calibration

- Label internal claims with evidence classes from `../workspace-health/references/evidence-classes.md`.
- Preserve metric basis for rankings and runway.
- Always include an action queue ordered by urgency and impact.
- Include caveats only when they affect the recommendation or client-safe wording.

## Fallback Behavior

- If required SendLens MCP tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.
- If the evidence is too thin for a client claim, say what can be safely said and what needs a narrower campaign read.
- Do not use Bash, `jq`, shell DuckDB access, repository inspection, local cache files, or setup scripts as fallback analysis paths.

## Output Shape

- Current read: one short paragraph with wins and risks.
- Client-safe update: concise wording an AM can send.
- Action queue: ranked actions with owner/next step when inferable.
- Watchlist: campaigns or tags that need follow-up.
- Evidence basis and caveats: only limitations that materially affect the recommendation.

## Example Requests

- "What should I tell the client this week?"
- "Give me today's AM action queue."
- "Which campaigns need attention before the client notices?"
- "Draft a client-safe update for this tag."
