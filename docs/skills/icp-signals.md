# `icp-signals`

Finds campaign-scoped lead segment hypotheses from exact aggregates plus sampled lead and payload evidence.

Related: [catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user asks who responds best.
- Segment variables such as industry, role, company size, geography, category, or uploaded custom metadata may explain outcomes.
- The user needs a testable ICP hypothesis rather than a broad workspace claim.

## Primary Surfaces

- Skill source: `skills/icp-signals/SKILL.md`
- Command: `/icp-signals`
- Default agent: `icp-auditor`
- MCP tools: `workspace_snapshot`, `analysis_starters`, `list_columns`, `analyze_data`, plus `load_campaign_data` for one-campaign work

## Expected Flow

1. Scope to one campaign unless the user explicitly asks for cross-campaign comparison.
2. Pull `analysis_starters(topic="icp-signals")`.
3. Use exact campaign aggregates for the performance baseline.
4. Use `lead_evidence` and `lead_payload_kv` for sampled segment hypotheses.
5. Inventory payload keys before value-level analysis when no key is named.

## Output Shape

- Strongest observed segment signals.
- Weak or risky segments.
- Payload keys worth inspecting next.
- Suggested segment test.
- Coverage caveats and sample-size limitations.

## Evidence Boundaries

`lead_payload_kv` is campaign-scoped. Do not assume payload keys are shared across campaigns or customers. Frame findings as hypotheses when they come from sampled lead evidence, even if the directional pattern is useful.
