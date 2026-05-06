# `copy-analysis`

Analyzes campaign templates, reconstructed outbound copy, and reply outcomes to explain what copy is helping or hurting.

Related: [catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user asks for subject-line, body-copy, template, or personalization critique.
- The user wants concrete rewrite guidance grounded in campaign evidence.
- Personalization variables may be unresolved, sparse, or mismatched.

## Primary Surfaces

- Skill source: `skills/copy-analysis/SKILL.md`
- Command: `/copy-analysis`
- Default agent: `copy-auditor`
- MCP tools: `workspace_snapshot`, `analysis_starters`, `analyze_data`, plus `load_campaign_data` for one-campaign work

## Expected Flow

1. Scope to one campaign before deep copy analysis.
2. Pull `analysis_starters(topic="copy-analysis")`.
3. Load the campaign when rendered copy or campaign-specific reply evidence is needed.
4. Use `campaign_variants` as the intended template source of truth.
5. Use `rendered_outbound_context` for local personalization QA.
6. Use `reply_context` and `lead_evidence` to connect reply outcomes back to copy.

## Output Shape

- What is likely helping.
- What is likely hurting.
- Personalization or variable issues.
- Step/variant-specific recommendations.
- Suggested rewrite or test idea.
- Caveat on reconstructed versus delivered copy.

## Evidence Boundaries

Rendered outbound copy is locally reconstructed from templates and stored lead variables. Treat it as analysis and QA evidence, not guaranteed byte-for-byte delivered email text. If personalization depends on campaign-specific variables, inspect `lead_payload_kv` inside the campaign rather than assuming global payload columns.
