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
- optional `provider` input: `all`, `instantly`, or `smartlead`
- `source_provider_scope`, `provider_breakdown`, and `provider_capabilities` for mixed-provider workspaces
- bounded `campaigns` rows from `campaign_overview` for ranking and campaign selection
- bounded campaign coverage rows
- `rate_caveats` when cross-provider rates are recomputed from normalized counts
- optional scope metadata for tag or campaign-name filters
- warnings when scoped output is capped or no active workspace exists

`setup_doctor`

- `schema_version: "sendlens_setup_doctor.v1"`
- setup status, demo mode, and local-cache/live-refresh/demo-seed capabilities
- provider setup metadata in `capabilities`: `source_provider_mode`, `source_providers`, `source_provider_config_valid`, provider key configured flags, and provider key validated flags
- `cache_freshness` with the refresh timestamp, relative age in seconds, and display label
- plugin root, DuckDB cache path, and state directory
- setup checks with pass/warn/fail/info statuses
- failures, warnings, docs, and next steps
- never prints secret values, redacts Smartlead query-string access values, and never refreshes or mutates campaign data

`seed_demo_workspace`

- registered as a recovery/demo path even when production credentials are configured
- `schema_version: "sendlens_demo_seed.v1"`
- activates synthetic `demo_workspace` in the local cache
- includes provider-aware campaign IDs, seed timestamp, evidence note, and next steps
- demo rows are synthetic only and include provider-qualified Instantly/Smartlead campaigns, duplicate campaign names across providers for ambiguity handling, and an unsupported Smartlead inbox-placement capability row
- does not delete real workspace rows; real `refresh_data` can switch active analysis back to configured provider data

`load_campaign_data`

- accepts a provider-qualified or native campaign ID; `SENDLENS_PROVIDER=all` requires a provider-qualified campaign ID
- scoped refresh metadata for the requested campaign; the broad refresh result is only returned when `include_refresh_metadata=true`
- exact `campaign_overview`
- `human_reply_sample` grouped into positive, negative, and neutral buckets
- compact `rendered_outbound_summary` with row counts and redacted preview metadata
- optional raw `rendered_outbound_sample` only when `include_rendered_outbound=true`; the default response must not include recipient-level fields such as `to_email`, `from_email`, or raw rendered body rows
- output caps and reconstruction warnings; preserve that rendered outbound evidence is locally reconstructed sample evidence, not byte-for-byte delivered email text

`analysis_starters`

- recipe metadata
- recipe `exactness`: `exact`, `sampled`, or `hybrid`
- compact recipe index by default with `output_shape`, `returned_count`, `page`, `page_size`, `has_more`, and `next_page`
- `recipe_id` exact lookup for one full recipe
- `mode="full"` bounded pages with SQL and explicit placeholders
- notes the agent must preserve when answering are included with full recipes

`analyze_data`

- caller rationale
- guarded SQL result rows
- `row_count`, `result_truncated`, and output limits
- warnings when caps are hit

`fetch_reply_text`

- resolves exactly one campaign by `campaign_id` or unambiguous `campaign_name`
- ambiguous provider-qualified campaign selectors return `campaign_id`, `source_provider`, `provider_campaign_id`, `campaign_source_id`, and `campaign_name` matches instead of guessing
- writes exact inbound reply rows from supported provider reply surfaces into `reply_emails`; default `sync_newest` mode fetches the newest page and upserts by email ID
- preserves pagination/cache state in `reply_email_hydration_state`
- returns `fetch_result` counts by `i_status`, new-vs-updated row counts, cursor/exhaustion state, readiness metadata, output limits, and a bounded `fetched_reply_sample`
- default statuses are `1`, `-1`, and `-2`; out-of-office status `0` is excluded unless explicitly requested

`prepare_campaign_analysis`

- `schema_version: "campaign_analysis_preparation.v1"`
- resolves exactly one campaign by `campaign_id` or unambiguous `campaign_name`
- ambiguous provider-qualified campaign selectors return provider-qualified matches instead of guessing
- default `analysis_depth` is balanced: statuses `1`, `-1`, and `-2`, up to 3 email pages/status, and target 30 stored non-auto reply bodies/status
- calls the same rate-conscious email lane as `fetch_reply_text`; it is not part of session-start refresh
- backfills lead context through `/leads/list` contacts/ids after reply bodies are stored
- returns `fetch_result`, `lead_context_backfill`, `hydration_coverage`, `context_gap_counts`, exact `campaign_overview`, bounded `reply_email_context_sample`, recommended next recipes, warnings, and output limits
- `reply_email_context_sample` is redacted by default: full `reply_body_text`, raw email address fields, and long quoted bodies are omitted while short redacted `reply_body_preview` values preserve diagnostic signal
- `reply_evidence_detail` defaults to `redacted_preview`; full reply bodies and raw email addresses require explicit opt-in with `full_reply_bodies`

## Runtime Regression Coverage

Run `npm run test:mcp-response-contract` when changing MCP tools, response field names, warnings, caps, or this document. The test pins the response-contract terms that agents rely on for:

- `workspace_snapshot` exact metrics, campaign rows, coverage, warnings, output limits, and readiness
- `workspace_snapshot` provider-scoped/all-provider outputs, provider capability rows, cross-provider rate caveats, and unsupported Smartlead inbox placement limitations
- `load_campaign_data` provider-qualified/native campaign handling, the `SENDLENS_PROVIDER=all` provider-qualified ID requirement, campaign overview, reply samples, rendered outbound reconstruction caveats, and output limits
- campaign selector ambiguity responses with provider-qualified matches
- provider overlap-risk public views for sampled cross-provider duplicate email/domain/company exposure
- `analysis_starters` recipe metadata, exactness labels, SQL, and notes
- `analyze_data` rationale, row caps, truncation state, warnings, and rows
- `fetch_reply_text` hydration result metadata, sample caps, and bounded reply samples
- `prepare_campaign_analysis` premium-depth coverage, context gaps, backfill metadata, warnings, output limits, and bounded redacted reply-email samples unless full evidence is explicitly requested

## Exactness Rules

- `campaigns`, `campaign_analytics`, `step_analytics`, `campaign_variants`, `accounts`, `account_daily_metrics`, `custom_tags`, and tag mapping views are exact provider-qualified local copies where the configured provider exposes those surfaces.
- `inbox_placement_tests` and `inbox_placement_analytics` are exact local copies of Instantly-derived inbox-placement surfaces.
- `campaign_overview` is the preferred exact campaign rollup plus tracking settings, deliverability guardrail settings, and sample coverage metadata.
- `inbox_placement_test_overview` and `sender_deliverability_health` are exact semantic rollups over Instantly inbox placement analytics when those API surfaces are available.
- `reply_emails` contains exact inbound email rows fetched from provider reply surfaces. Instantly rows are fetched on demand through List email; Smartlead rows can come from bounded message-history hydration during campaign refresh. Exact body text is present only when the provider returned body fields.
- `reply_email_hydration_state` is exact local pagination state for continuing older reply fetches by campaign/status/thread mode. Use `sync_newest` or `restart` to check newly arrived replies above the saved cursor.
- `lead_evidence` contains reply-signal leads found during bounded lead scans, explicit reply-email backfills, and bounded non-reply samples.
- `lead_payload_kv` expands sampled lead `custom_payload` into campaign-scoped key/value rows so ICP analysis can stay inside SendLens tools without raw JSON table functions.
- `provider_overlap_risk` and `provider_overlap_risk_details` are sampled cross-provider overlap primitives. They identify repeated normalized email/domain/company exposure across providers, expose both the overall sampled span and the closest cross-provider contact window, and are not full suppression or CRM dedupe audits unless all relevant campaigns were fully scanned.
- `reply_context` is lead outcome evidence joined to fetched inbound reply text when available, templates, and reconstructed outbound context.
- `reply_email_context` is email-anchored fetched reply context; use it after premium hydration because exact reply bodies remain visible even when lead/template context is missing.
- `rendered_outbound_context` is locally reconstructed copy, not byte-for-byte delivered email text. Smartlead outbound message-history rows are counted in coverage, but rendered outbound bodies stay reconstructed from templates plus lead variables unless a future exact outbound surface is added.

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
