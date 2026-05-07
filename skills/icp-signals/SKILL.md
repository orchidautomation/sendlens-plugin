---
name: "icp-signals"
description: "Use when analyzing which leads, segments, payload fields, or ICP hypotheses respond best within campaign evidence."
---

# ICP Signals

Infer who responds best from exact aggregates plus sampled lead evidence, while keeping coverage caveats explicit.

## Tools In This Skill

- `workspace_snapshot`
- `analysis_starters`
- `list_columns`
- `search_catalog`
- `analyze_data`
- `load_campaign_data`

## References

- `../workspace-health/references/evidence-classes.md`
- `../workspace-health/references/output-schema.md`
- `references/payload-analysis.md`

Read the evidence and payload references before making a segment claim.

## When To Use

- Use this when the user asks which kinds of leads reply, which segments look stronger or weaker, what payload keys matter, or which ICP test to run next.
- Keep ICP analysis scoped to one campaign at a time unless the user explicitly asks for a cross-campaign comparison.
- If the user provides a campaign name or Instantly tag, use that scope first before inspecting payload variables.

## Protocol

### Stage 1: Resolve One Campaign

- Start with `workspace_snapshot` when scope is broad or ambiguous.
- Pull `analysis_starters(topic="icp-signals")` before custom analysis.
- If the user narrows to one campaign and wants better evidence, run `load_campaign_data` for that campaign.

### Stage 2: Establish Baseline

- Use exact campaign aggregates for performance baselines and campaign context.
- Use `lead_evidence` and `lead_payload_kv` to generate segment hypotheses, not full-population claims.
- If schema is uncertain, use `search_catalog` or `list_columns` before `analyze_data`.

### Stage 3: Inspect Payloads Safely

- Preserve campaign-specific payload context.
- Treat payload keys, `job_title`, and similar fields as metadata supplied by uploaded lead lists or campaign custom fields. Do not imply Instantly failed to enrich a lead when a field is blank.
- Prefer `campaign-payload-key-inventory` before value-level analysis when the user has not named a payload key.
- Use `campaign-payload-presence-signals` to compare whether a key being present versus absent looks directionally meaningful in sampled evidence.
- Use `campaign-payload-key-signals` only after choosing one concrete key.
- Use the `lead_payload_kv` view and curated payload recipes instead of raw JSON table functions.

### Stage 4: Calibrate Segment Claims

- Treat payload and lead evidence as sampled unless an exact aggregate surface supports the claim.
- Do not assume payload keys are shared across campaigns just because two campaigns use similar lead-metadata concepts.
- Be explicit when evidence is suggestive rather than statistically decisive.
- Convert strong sampled signals into test recommendations, not absolute targeting rules.

## Fallback Behavior

- If required SendLens MCP tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.
- If sample sizes or lead metadata are too thin, recommend updating future uploaded lead lists with richer fields, such as job title, function, seniority, company category, geography, list source, and campaign-specific triggers, so future analysis can segment more reliably.
- Do not use Bash, `jq`, shell DuckDB access, repository inspection, local cache files, raw JSON functions, or setup scripts as fallback analysis paths.

## Output Shape

- Verdict: the strongest segment hypothesis.
- Evidence basis: exact baseline plus sampled payload/lead evidence.
- Stronger segments.
- Weaker or risky segments.
- Payload keys worth testing next.
- Experiment recommendation.
- Caveats.

## Example Requests

- "Which kinds of leads are replying?"
- "Are any countries or categories clearly stronger?"
- "What ICP signals show up in the replies?"
- "Which payload keys should we inspect first?"
