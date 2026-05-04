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
- Use `workspace_snapshot.campaigns` for the first campaign ranking pass. Fall through to `analyze_data` only when the user asks for a custom metric or the snapshot output is too narrow for the question.
- Keep broad ranking reads active-only by default. Include inactive or historical campaigns only when the user explicitly asks for them.
- Stay inside the SendLens MCP tool surface. If required SendLens tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server. Do not inspect local files, run shell setup checks, parse cached outputs with `jq`, or query DuckDB through shell fallbacks.
- When the host supports delegated agents, use `campaign-analyst` after the workspace triage picks a campaign.
- If the user narrows to one campaign and needs fresher evidence, run `load_campaign_data` before custom analysis instead of refreshing the whole workspace.
- Use `campaign_analytics`, `step_analytics`, and `campaigns` for headline comparisons.
- For runway, exhaustion, "out of leads", capacity, or throttle questions, do not answer from leads remaining alone. Pull the runway recipes and report:
  - new-lead runway: uncontacted leads divided by observed new-lead contact pace
  - volume runway: remaining sequence/follow-up tail based on step count, sent-by-step distribution, and step delays
  - schedule-adjusted pace: observed sending weekdays and campaign-attributed daily history, not a naive 7-calendar-day average
  - real capacity: recent observed peak and sender/account coverage before treating configured campaign `daily_limit` as deliverable capacity
- Explicitly distinguish "out of new prospects" from "out of send volume"; a multi-step sequence can keep sending follow-ups after step 0 is exhausted.
- Keep campaign ranking on exact campaign-level unique reply metrics when they are present.
- For step or variant ranking, check whether `step_analytics.unique_replies` has real coverage first. If it is sparse or mostly null for that campaign/workspace, switch to `opportunities` and `opportunity_rate_pct` instead of pretending step reply rate is exact.
- Use `step-fatigue-by-campaign` when the user asks where a sequence stops producing value. Preserve the recipe's `metric_basis` field in the answer.
- Use `campaign_variants` to connect step or variant performance back to actual copy templates.
- For lead-variable breakdowns, switch to `lead_payload_kv` and the ICP payload recipes after the campaign is fixed.
- Call out when a conclusion is based on exact aggregate metrics versus sampled evidence.
- Explicitly state which metric basis you used for sequence ranking: `unique_reply_rate` or `opportunity_rate`.

## Example Requests

- "Which campaign is winning?"
- "How much runway do we have before this tag runs out of leads?"
- "Does current capacity change campaign runway?"
- "Which step gets the most replies?"
- "Which variant is outperforming the rest?"
- "Where should this sequence be shortened?"
