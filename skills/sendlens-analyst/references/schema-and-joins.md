# Schema And Safe Joins

Use MCP schema tools for the current source of truth. This file records the stable semantic map and join rules the analyst should not rediscover.

## Semantic Surfaces

- Campaign: `campaign_overview`, `campaigns`, `campaign_analytics`, `campaign_daily_metrics`.
- Step and template: `step_analytics`, `campaign_variants`.
- Sender: `campaign_accounts`, `accounts`, `account_daily_metrics`.
- Tag: `campaign_tags`, `account_tags`, tag coverage, volume, utilization, and trend views.
- Deliverability: Instantly inbox-placement views and Smartlead Smart Delivery views.
- Lead and ICP: `lead_evidence`, `lead_payload_kv`.
- Replies: `reply_email_context` after hydration; `reply_context` for replied-lead outcomes and copy-path context.
- Copy: `campaign_variants` for intended templates; `rendered_outbound_context` for sampled local reconstruction.
- Provider overlap: `provider_overlap_risk` and `provider_overlap_risk_details`.

## Join Rules

- Always include `workspace_id`.
- In provider-mixed data, also join on `source_provider` and provider-qualified campaign identity. Prefer `campaign_source_id` when both surfaces expose it.
- Join campaign/day facts by campaign identity plus `date`.
- Join campaign/step/variant facts by campaign identity plus `step` and `variant`; include `sequence_index` when the source distinguishes multiple sequences.
- Join sender facts by `workspace_id`, `source_provider`, and normalized account email or provider account ID.
- Use `campaign_tags` and `account_tags` rather than reconstructing raw tag mappings.
- Normalize email casing before lead, reply, or reconstructed-outbound joins.
- Use `lead_payload_kv` rather than authoring raw JSON table functions.

## Grain And Evidence

- `campaign_overview`: one row per provider-qualified campaign; exact aggregates plus sampling coverage.
- `campaign_daily_metrics`: one row per campaign/day when the provider exposes it.
- `step_analytics`: one row per campaign/step/variant when available.
- `campaign_variants`: intended template evidence, usually campaign/sequence/step/variant.
- `account_daily_metrics`: one row per provider-qualified account/day.
- `lead_evidence` and `lead_payload_kv`: sampled campaign-scoped evidence, never population totals.
- `reply_email_context`: one row per fetched inbound reply email with explicit context gaps.
- `rendered_outbound_context`: sampled reconstruction, never exact delivered email text.

Before custom SQL, call `search_catalog` for concepts and `list_columns` for the chosen table. Prefer a curated `analysis_starters` recipe when one matches the question.
