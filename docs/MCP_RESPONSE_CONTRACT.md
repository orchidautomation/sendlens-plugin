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

- `schema_version: "workspace_snapshot.v1"`
- exact workspace/campaign/account metrics
- bounded `campaigns` rows from `campaign_overview` for ranking and campaign selection
- bounded campaign coverage rows
- optional scope metadata for tag or campaign-name filters
- warnings when scoped output is capped or no active workspace exists

`setup_doctor`

- `schema_version: "sendlens_setup_doctor.v1"`
- setup status, demo mode, and local-cache/live-refresh/demo-seed capabilities
- `cache_freshness` with the refresh timestamp, relative age in seconds, and display label
- plugin root, DuckDB cache path, and state directory
- setup checks with pass/warn/fail/info statuses
- failures, warnings, docs, and next steps
- never prints secret values and never refreshes or mutates campaign data

`seed_demo_workspace`

- registered as a recovery/demo path even when production credentials are configured
- `schema_version: "sendlens_demo_seed.v1"`
- activates synthetic `demo_workspace` in the local cache
- includes campaign IDs, seed timestamp, evidence note, and next steps
- does not delete real workspace rows; real `refresh_data` can switch active analysis back to Instantly data

`load_campaign_data`

- refresh result for the requested campaign
- exact `campaign_overview`
- `human_reply_sample` grouped into positive, negative, and neutral buckets
- optional `rendered_outbound_sample`
- output caps and reconstruction warnings; when rendered outbound samples are included, preserve that they are locally reconstructed sample evidence, not byte-for-byte delivered email text

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

`fetch_reply_text`

- resolves exactly one campaign by `campaign_id` or unambiguous `campaign_name`
- writes exact inbound reply rows into `reply_emails`; default `sync_newest` mode fetches the newest page and upserts by email ID
- preserves pagination/cache state in `reply_email_hydration_state`
- returns `fetch_result` counts by `i_status`, new-vs-updated row counts, cursor/exhaustion state, readiness metadata, output limits, and a bounded `fetched_reply_sample`
- default statuses are `1`, `-1`, and `-2`; out-of-office status `0` is excluded unless explicitly requested

## Runtime Regression Coverage

Run `npm run test:mcp-response-contract` when changing MCP tools, response field names, warnings, caps, or this document. The test pins the response-contract terms that agents rely on for:

- `workspace_snapshot` exact metrics, campaign rows, coverage, warnings, output limits, and readiness
- `load_campaign_data` campaign overview, reply samples, rendered outbound reconstruction caveats, and output limits
- `analysis_starters` recipe metadata, exactness labels, SQL, and notes
- `analyze_data` rationale, row caps, truncation state, warnings, and rows
- `fetch_reply_text` hydration result metadata, sample caps, and bounded reply samples

## Exactness Rules

- `campaigns`, `campaign_analytics`, `step_analytics`, `campaign_variants`, `accounts`, `account_daily_metrics`, `custom_tags`, tag mapping views, `inbox_placement_tests`, and `inbox_placement_analytics` are exact local copies of Instantly-derived surfaces.
- `campaign_overview` is the preferred exact campaign rollup plus tracking settings, deliverability guardrail settings, and sample coverage metadata.
- `inbox_placement_test_overview` and `sender_deliverability_health` are exact semantic rollups over Instantly inbox placement analytics when those API surfaces are available.
- `reply_emails` contains exact inbound email rows fetched on demand from Instantly List email. It is intentionally not part of the session-start fast refresh.
- `reply_email_hydration_state` is exact local pagination state for continuing older reply fetches by campaign/status/thread mode. Use `sync_newest` or `restart` to check newly arrived replies above the saved cursor.
- `lead_evidence` contains full replied leads where available and bounded non-reply samples.
- `lead_payload_kv` expands sampled lead `custom_payload` into campaign-scoped key/value rows so ICP analysis can stay inside SendLens tools without raw JSON table functions.
- `reply_context` is lead outcome evidence joined to fetched inbound reply text when available, templates, and reconstructed outbound context.
- `rendered_outbound_context` is locally reconstructed copy, not byte-for-byte delivered email text.

## Structured Content Strategy

The next protocol step is to add host-compatible structured content alongside the existing JSON text, not instead of it.

Priority order:

1. `workspace_snapshot`: stable summary, exact metrics, campaign rows, coverage, freshness, warnings.
2. `load_campaign_data`: campaign overview, reply sample counts, rendered-copy limits.
3. `analysis_starters`: recipes as typed objects.
4. `analyze_data`: schema-light row payload plus metadata.

Compatibility rule:

- Keep text JSON as the canonical fallback until all target hosts preserve structured MCP content reliably.
- Add structured content only as an additive field.
- Do not change key names casually; if a key changes, update this document and the runtime tests in the same PR.
