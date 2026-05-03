---
name: "icp-signals"
description: "Infer who responds best from exact aggregates plus sampled lead evidence, while keeping coverage caveats explicit."
---

# ICP Signals

Infer who responds best from exact aggregates plus sampled lead evidence, while keeping coverage caveats explicit.

## Tools In This Skill

- `workspace_snapshot`
- `analysis_starters`
- `list_columns`
- `analyze_data`

## Usage

- If the user provides a campaign name or Instantly tag, use that scope first before inspecting payload variables.
- Pull `analysis_starters(topic="icp-signals")` before custom analysis.
- Use SendLens MCP tools for analysis. Do not use bash, shell setup checks, cached-output parsing, direct DuckDB queries, local files, or repo source as a fallback. If the SendLens tools are unavailable, say SendLens needs to be reloaded or reconnected before analysis can continue; avoid mentioning MCP plumbing unless the user asks.
- Keep ICP analysis scoped to one campaign at a time unless the user explicitly asks for a cross-campaign comparison.
- If the user narrows to one campaign and wants better evidence, run `load_campaign_data` for that campaign first.
- Use exact campaign aggregates for performance baselines.
- Use `lead_evidence` and `lead_payload_kv` to generate segment hypotheses, not full-population claims.
- Preserve campaign-specific payload context; use the `lead_payload_kv` view and curated payload recipes instead of raw JSON table functions.
- Prefer `campaign-payload-key-inventory` before value-level analysis when the user has not named a payload key.
- Use `campaign-payload-presence-signals` to compare whether a key being present versus absent looks directionally meaningful in sampled evidence.
- Use `campaign-payload-key-signals` only after choosing one concrete key, and keep the answer framed as sampled/campaign-scoped.
- Do not assume payload keys are shared across campaigns just because two campaigns use similar enrichment concepts.
- Be explicit when the evidence is suggestive rather than statistically decisive.

## Example Requests

- "Which kinds of leads are replying?"
- "Are any countries or categories clearly stronger?"
- "What ICP signals show up in the replies?"
- "Which payload keys should we inspect first?"
