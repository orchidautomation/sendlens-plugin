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
- `search_catalog`
- `analyze_data`
- `load_campaign_data`

## References

- `../workspace-health/references/evidence-classes.md`
- `../workspace-health/references/metric-basis.md`
- `../workspace-health/references/output-schema.md`

Read the evidence and metric-basis references before ranking campaigns, steps, variants, or runway.

## When To Use

- Use this when the user asks which campaign is winning, why one campaign is underperforming, how much runway remains, which step/variant performs best, or where sequence fatigue appears.
- If the user provides a campaign name or Instantly tag, use that as preferred scope before doing ranking work.
- Keep broad ranking reads active-only by default. Include inactive or historical campaigns only when explicitly requested.

## Protocol

### Stage 1: Start And Scope

- Start with `workspace_snapshot`, scoped by `campaign_name` or `instantly_tag` when provided.
- Pull `analysis_starters(topic="campaign-performance")` before custom analysis.
- Use `workspace_snapshot.campaigns` for the first campaign ranking pass.
- Use `analyze_data` only when the user asks for a custom metric, the snapshot is too narrow, or a starter recipe needs execution.

### Stage 2: Choose The Evidence Surface

- Use `campaign_overview`, `campaign_analytics`, `campaign_daily_metrics`, `step_analytics`, `campaign_variants`, and tag views for exact aggregate comparisons.
- If schema is uncertain, use `search_catalog` or `list_columns` before `analyze_data`.
- If the user narrows to one campaign and needs fresher campaign evidence, run `load_campaign_data` for that campaign instead of refreshing the whole workspace.
- When the host supports delegated agents, use `campaign-analyst` only after workspace triage picks one campaign.

### Stage 3: Apply Metric-Basis Discipline

- Keep campaign ranking on exact campaign-level unique reply metrics when available.
- For step or variant ranking, check whether `step_analytics.unique_replies` has real coverage. If sparse or mostly null, switch to opportunities and `opportunity_rate_pct`.
- Use `step-fatigue-by-campaign` for sequence fatigue and preserve the recipe's `metric_basis` field in the answer.
- Explicitly state whether a ranking uses `unique_reply_rate`, `opportunity_rate`, exact reply outcomes, sampled evidence, or reconstructed outbound.
- Use `campaign_variants` to connect step/variant metrics back to actual intended templates.

### Stage 4: Handle Runway Correctly

- For runway, exhaustion, "out of leads", capacity, or throttle questions, do not answer from leads remaining alone.
- Report new-lead runway, volume runway, schedule-adjusted pace, and real capacity when relevant.
- Distinguish "out of new prospects" from "out of send volume"; follow-up steps can continue after step 0 is exhausted.

### Stage 5: Narrow Specialist Questions

- For copy conclusions, narrow to one campaign and switch to `copy-analysis`.
- For lead-variable breakdowns, narrow to one campaign and switch to `icp-signals`.
- For actual reply wording, narrow to one campaign and switch to `reply-patterns`.

### Stage 6: Answer With Evidence Calibration

- Call out whether conclusions are `exact_aggregate`, `sampled_evidence`, `reconstructed_outbound`, `hydrated_reply_body`, or `inference`.
- Do not overstate sampled lead or reconstructed outbound evidence.
- Use the output schema reference unless the user asks for a table.

## Fallback Behavior

- If required SendLens MCP tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.
- If query output is truncated, add tighter filters, aggregate, or report the limitation.
- Do not use Bash, `jq`, shell DuckDB access, repository inspection, local cache files, or setup scripts as fallback analysis paths.

## Example Requests

- "Which campaign is winning?"
- "How much runway do we have before this tag runs out of leads?"
- "Does current capacity change campaign runway?"
- "Which step gets the most replies?"
- "Which variant is outperforming the rest?"
- "Where should this sequence be shortened?"
