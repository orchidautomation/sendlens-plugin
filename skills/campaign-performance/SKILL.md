---
name: "campaign-performance"
description: "Compare campaigns, rank variants, and explain campaign-level winners and losers."
---

# Campaign Performance

Compare campaigns, rank variants, and explain campaign-level winners and losers.

## Tools In This Skill

- `workspace_snapshot`
- `analysis_starters`
- `list_tables`
- `list_columns`
- `analyze_data`

## Usage

- If the user provides a campaign name or Instantly tag, use that as the preferred scope before doing any ranking work.
- Pull `analysis_starters(topic="campaign-performance")` before custom analysis.
- Keep broad ranking reads active-only by default. Include inactive or historical campaigns only when the user explicitly asks for them.
- When SendLens MCP tools are available, stay inside the MCP tool surface. Do not inspect local files or query DuckDB through shell fallbacks.
- When the host supports delegated agents, use `campaign-analyst` after the workspace triage picks a campaign.
- If the user narrows to one campaign and needs fresher evidence, run `load_campaign_data` before custom analysis instead of refreshing the whole workspace.
- Use `campaign_analytics`, `step_analytics`, and `campaigns` for headline comparisons.
- Keep campaign ranking on exact campaign-level unique reply metrics when they are present.
- For step or variant ranking, check whether `step_analytics.unique_replies` has real coverage first. If it is sparse or mostly null for that campaign/workspace, switch to `opportunities` and `opportunity_rate_pct` instead of pretending step reply rate is exact.
- Use `step-fatigue-by-campaign` when the user asks where a sequence stops producing value. Preserve the recipe's `metric_basis` field in the answer.
- Use `campaign_variants` to connect step or variant performance back to actual copy templates.
- For lead-variable breakdowns, switch to `lead_payload_kv` and the ICP payload recipes after the campaign is fixed.
- Call out when a conclusion is based on exact aggregate metrics versus sampled evidence.
- Explicitly state which metric basis you used for sequence ranking: `unique_reply_rate` or `opportunity_rate`.

## Example Requests

- "Which campaign is winning?"
- "Which step gets the most replies?"
- "Which variant is outperforming the rest?"
- "Where should this sequence be shortened?"
