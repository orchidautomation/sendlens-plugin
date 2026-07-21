# `icp-signals`

Finds campaign-scoped lead segment hypotheses from exact aggregates plus sampled lead and payload evidence.

Related: [catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user asks who responds best.
- Segment variables such as industry, role, company size, geography, category, or uploaded custom metadata may explain outcomes.
- The user needs a testable ICP hypothesis rather than a broad workspace claim.

## Primary Surfaces

- Analyst module: `skills/sendlens-analyst/references/replies-icp-and-copy.md`
- Command: `/icp-signals`
- Default agent: `icp-auditor`
- MCP tools: `workspace_snapshot`, `analysis_starters`, `list_columns`, `analyze_data`, plus `load_campaign_data` for one-campaign work

## Expected Flow

1. Scope to one campaign unless the user explicitly asks for cross-campaign comparison.
2. Pull `analysis_starters(topic="icp-signals")`.
3. Use exact campaign aggregates for the performance baseline.
4. Use `lead_evidence` and `lead_payload_kv` for sampled segment hypotheses.
5. Run `campaign-metadata-coverage` before value-level analysis when no exact key is named.
6. Use normalized keys and metadata families to discover aliases, then group by the original exact payload key. Report sparse and non-scalar coverage rather than silently excluding it.

## Output Shape

- Strongest observed segment signals.
- Weak or risky segments.
- Payload keys worth inspecting next.
- Suggested segment test.
- Coverage caveats and sample-size limitations.

## Evidence Boundaries

`lead_payload_kv` is campaign-scoped. It preserves exact provider keys and values while adding normalized-key, metadata-family, scalar/type, and JSON columns for discovery. Do not assume payload keys are shared across campaigns or customers, silently merge aliases, or treat arrays/objects as scalar cohorts. Frame findings as hypotheses when they come from sampled lead evidence, even if the directional pattern is useful.
