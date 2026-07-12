# `campaign-performance`

Compares campaigns, ranks steps and variants, explains winners and losers, and handles runway or capacity questions.

Related: [catalog](../CATALOG.md), [trust and privacy](../TRUST_AND_PRIVACY.md), [synthetic examples](../examples/SYNTHETIC_OUTPUTS.md).

## Use When

- The user asks which campaign is winning.
- A campaign, tag, step, variant, sequence, runway, capacity, or lead exhaustion question comes up.
- The user needs prioritization across campaigns before deeper copy, ICP, or reply analysis.

## Primary Surfaces

- Analyst module: `skills/sendlens-analyst/references/workspace-and-performance.md`
- Command: `/campaign-performance`
- Default agent: `campaign-analyst`
- MCP tools: `workspace_snapshot`, `analysis_starters`, `list_tables`, `list_columns`, `analyze_data`, `load_campaign_data`, `prepare_campaign_analysis`

## Expected Flow

1. Use campaign name or Instantly tag as the preferred scope when provided.
2. Pull `analysis_starters(topic="campaign-performance")`.
3. Use `workspace_snapshot.campaigns` for the first ranking pass.
4. Use exact campaign and account aggregate tables for headline comparisons.
5. If the user narrows to one campaign and needs fresher evidence, run `load_campaign_data`.
6. Before one-campaign working/not-working, winner, scale, or kill claims, run `prepare_campaign_analysis`.
7. Report aggregate unique human replies separately from the selected List Email body surface: statuses, OOO exclusion, `fetch_latest_of_thread`, the stored context latest-thread basis, per-status fetched/hydrated counts, exhaustion, and the aggregate-to-hydrated gap from `reply_coverage_summary`.

## Output Shape

- Ranking or verdict.
- Metric basis used.
- Winners and underperformers.
- Runway/capacity read when relevant.
- Next campaign or test to inspect.
- Caveats about exact aggregate metrics versus sampled evidence.
- Neutral coverage language when selected hydration buckets and the campaign aggregate differ; exhausted selected buckets do not prove every aggregate reply was hydrated, and maximum depth does not guarantee gap recovery.

## Evidence Boundaries

For step or variant ranking, state whether the basis is `unique_reply_rate` or `opportunity_rate`. If step-level unique replies are sparse or null, use opportunity rate rather than pretending exact step reply-rate coverage exists.

For runway, separate exact lead-supply evidence from observed new-lead contact activity and send volume. Exact uncontacted lead supply is unknown unless a provider-specific remaining-lead field is available; multi-step sequences can continue follow-ups after step 0 is exhausted.
