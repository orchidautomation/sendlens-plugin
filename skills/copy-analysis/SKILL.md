---
name: "copy-analysis"
description: "Analyze campaign templates, rendered outbound samples, and reply outcomes to explain copy performance."
---

# Copy Analysis

Analyze campaign templates, rendered outbound samples, and reply outcomes to explain copy performance.

## Tools In This Skill

- `workspace_snapshot`
- `analysis_starters`
- `analyze_data`

## Usage

- If the user provides a campaign name or Instantly tag, treat that as the preferred filter before inspecting templates or reconstructed copy.
- Pull `analysis_starters(topic="copy-analysis")` before custom analysis.
- When SendLens MCP tools are available, stay inside the MCP tool surface. Do not inspect local files or query DuckDB through shell fallbacks.
- Keep deep analysis scoped to one campaign at a time. If the user starts broad, rank campaigns first and then narrow.
- If the user wants rendered copy or campaign-specific reply evidence, run `load_campaign_data` for that campaign first.
- Use `campaign_variants` as the intended copy source of truth.
- Use `sampled_outbound_emails` only to verify how the copy rendered in practice.
- If the user asks whether personalization broke, use the `personalization-leak-audit` analysis starter before writing a custom query.
- Use `reply_context` and `lead_evidence` to anchor recommendations in Instantly reply outcomes and the copy tied to those leads.
- If personalization quality depends on campaign-specific variables, inspect those values through `custom_payload` for that campaign rather than assuming shared payload columns.
- Treat rendered outbound copy as locally reconstructed evidence, not exact delivered email text.
- Recommend changes through a cold-email best-practices lens, not generic marketing advice.

## Example Requests

- "Analyze my copy."
- "Which subject lines are working?"
- "What should I change in step 0?"
- "Did any personalization variables leak through unresolved?"
