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
- `load_campaign_data`
- `list_columns`
- `search_catalog`

## References

- `../workspace-health/references/evidence-classes.md`
- `../workspace-health/references/metric-basis.md`
- `../workspace-health/references/output-schema.md`
- `references/copy-reconstruction.md`
- `../reply-patterns/references/reply-hydration.md`

Read the evidence, output, and copy reconstruction references before making copy claims.

## When To Use

- Use this when the user asks to analyze copy, subject lines, step language, personalization, template quality, or how copy relates to replies.
- Keep deep analysis scoped to one campaign at a time. If the user starts broad, rank campaigns first and then narrow.
- If the user provides a campaign name or Instantly tag, treat it as the preferred filter before inspecting templates or reconstructed copy.

## Protocol

### Stage 1: Resolve And Load One Campaign

- Start with `workspace_snapshot` only when scope is broad or ambiguous.
- Pull `analysis_starters(topic="copy-analysis")` before custom analysis.
- If the user wants rendered copy, personalization safety, or campaign-specific reply evidence, run `load_campaign_data` for that campaign.

### Stage 2: Separate Copy Evidence Sources

- Use `campaign_variants` as the exact intended template source of truth.
- Use `rendered_outbound_context` or `rendered_outbound_sample` only as locally reconstructed sampled evidence.
- Use `reply_context` and `lead_evidence` to anchor recommendations in Instantly reply outcomes and the copy tied to those leads.
- If actual reply wording is required, switch to `reply-patterns` or use only rows already hydrated in `reply_context`; do not infer wording from reply status labels.

### Stage 3: Analyze Personalization Safely

- If the user asks whether personalization broke, run the `personalization-leak-audit` starter before custom analysis.
- If personalization quality depends on campaign-specific variables, inspect values through `lead_payload_kv` for that campaign rather than assuming shared payload columns.
- Preserve the reconstructed outbound caveat in any token leak or rendered-copy conclusion.

### Stage 4: Recommend With Cold-Email Discipline

- Tie every rewrite or test idea to evidence: exact template issue, sampled reconstruction problem, reply outcome pattern, hydrated reply-body theme, or explicit inference.
- Prefer concise, specific cold-email changes over generic marketing advice.
- Do not recommend a copy test if deliverability, sender health, lead supply, or launch QA blockers are the more plausible constraint.

## Fallback Behavior

- If required SendLens MCP tools are missing, stop and tell the user to reload or reinstall the plugin/MCP server.
- If rendered outbound or reply evidence is missing, say which evidence is missing and keep recommendations at template-review confidence.
- Do not use Bash, `jq`, shell DuckDB access, repository inspection, local cache files, or setup scripts as fallback analysis paths.

## Output Shape

- Verdict: copy health in one sentence.
- Evidence basis: exact templates, sampled reconstruction, reply outcomes, hydrated replies, or inference.
- What is helping.
- What is hurting.
- Specific rewrites or test ideas by step/variant.
- Caveats: only evidence limits that affect the recommendation.

## Example Requests

- "Analyze my copy."
- "Which subject lines are working?"
- "What should I change in step 0?"
- "Did any personalization variables leak through unresolved?"
