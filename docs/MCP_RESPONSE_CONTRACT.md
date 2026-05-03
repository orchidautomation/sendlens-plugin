# MCP Response Contract

SendLens returns JSON in MCP text content today because that is the most portable shape across Claude Code, Cursor, Codex, and OpenCode. Agents should still treat the payloads as structured JSON and preserve the evidence limits in their final answers.

## Contract Goals

- keep every response machine-readable even when delivered as text
- expose freshness and readiness when a startup refresh is still settling
- make exact, sampled, hybrid, and reconstructed evidence explicit
- keep output bounded so agents do not receive unbounded warehouse dumps
- preserve host compatibility before adopting MCP structured content fields

## Common Fields

Where relevant, SendLens responses should include:

- `readiness`: session-start wait or timeout metadata
- `output_limits`: row, sample, or character caps applied by the tool
- `warnings`: coverage, truncation, cache-lock, or reconstruction caveats
- `row_count`: returned row count for custom SQL results
- `result_truncated`: whether more rows existed beyond the cap
- `campaign_overview`: exact campaign aggregate surface for one-campaign work
- `coverage`: ingest mode and sample coverage by campaign
- `rows`: query result rows for `analyze_data`

## Tool-Specific Shape

`workspace_snapshot`

- exact workspace/campaign/account metrics
- bounded campaign coverage rows
- optional scope metadata for tag or campaign-name filters
- warnings when scoped output is capped or no active workspace exists

`load_campaign_data`

- refresh result for the requested campaign
- exact `campaign_overview`
- `human_reply_sample` grouped into positive, negative, and neutral buckets
- optional `rendered_outbound_sample`
- output caps and reconstruction warnings

`analysis_starters`

- recipe metadata
- recipe `exactness`: `exact`, `sampled`, or `hybrid`
- SQL with explicit placeholders
- notes the agent must preserve when answering

`analyze_data`

- caller rationale
- guarded SQL result rows
- `row_count`, `result_truncated`, and output limits
- warnings when caps are hit

## Exactness Rules

- `campaigns`, `campaign_analytics`, `step_analytics`, `campaign_variants`, `accounts`, `account_daily_metrics`, `custom_tags`, and tag mapping views are exact local copies of Instantly-derived surfaces.
- `campaign_overview` is the preferred exact campaign rollup plus sample coverage metadata.
- `lead_evidence` contains full replied leads where available and bounded non-reply samples.
- `reply_context` is lead outcome evidence joined to templates and reconstructed outbound context.
- `rendered_outbound_context` is locally reconstructed copy, not byte-for-byte delivered email text.

## Structured Content Strategy

The next protocol step is to add host-compatible structured content alongside the existing JSON text, not instead of it.

Priority order:

1. `workspace_snapshot`: stable summary, exact metrics, coverage, freshness, warnings.
2. `load_campaign_data`: campaign overview, reply sample counts, rendered-copy limits.
3. `analysis_starters`: recipes as typed objects.
4. `analyze_data`: schema-light row payload plus metadata.

Compatibility rule:

- Keep text JSON as the canonical fallback until all target hosts preserve structured MCP content reliably.
- Add structured content only as an additive field.
- Do not change key names casually; if a key changes, update this document and the runtime tests in the same PR.

