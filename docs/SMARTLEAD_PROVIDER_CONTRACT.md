# Smartlead V1 Provider Contract

Date checked: 2026-07-11

Status: implemented V1 contract with official-document and synthetic-fixture
validation. Live customer-shape validation remains deferred.

This document converts `docs/SMARTLEAD_API_PARITY_MAP.md` into the read-only
Smartlead V1 provider contract for SendLens OSS. It is based on public
Smartlead documentation, local SendLens code inspection, and synthetic
fixture/contract validation. It must not require live Smartlead access.

## Sources Checked

Local SendLens surfaces:

- `plugin/instantly-client.ts`
- `plugin/instantly-ingest.ts`
- `plugin/server.ts`
- `plugin/local-db.ts`
- `docs/SMARTLEAD_API_PARITY_MAP.md`
- `docs/MCP_RESPONSE_CONTRACT.md`

Public Smartlead sources:

- `https://api.smartlead.ai/llms.txt`
- `https://api.smartlead.ai/llms-full.txt`
- `https://api.smartlead.ai/api-reference/campaigns/get-all`
- `https://api.smartlead.ai/api-reference/campaigns/get-by-id`
- `https://api.smartlead.ai/api-reference/campaigns/get-sequences`
- `https://api.smartlead.ai/api-reference/campaigns/get-analytics`
- `https://api.smartlead.ai/api-reference/campaigns/get-analytics-by-date`
- `https://api.smartlead.ai/api-reference/campaigns/statistics`
- `https://api.smartlead.ai/api-reference/campaigns/get-email-accounts`
- `https://api.smartlead.ai/api-reference/campaigns/get-leads`
- `https://api.smartlead.ai/api-reference/campaigns/get-lead-history`
- `https://api.smartlead.ai/api-reference/campaigns/get-leads-history-bulk`
- `https://api.smartlead.ai/api-reference/email-accounts/get-all`
- `https://api.smartlead.ai/api-reference/email-accounts/warmup-stats`
- `https://api.smartlead.ai/api-reference/analytics/overview`
- `https://api.smartlead.ai/api-reference/analytics/campaign-performance`
- `https://api.smartlead.ai/api-reference/analytics/provider-performance`
- `https://api.smartlead.ai/guides/rate-limits`
- `https://api.smartlead.ai/guides/error-handling`
- `https://api.smartlead.ai/api-reference/campaign-statistics/mailbox-statistics`
- `https://api.smartlead.ai/api-reference/smart-delivery/list-tests`

The complete official `llms-full.txt` snapshot was fetched on 2026-07-11 and
hashed as `ab4c1a1bc65f3331b9d813f8509c67ca3b3014d80e4954e5d34fe7a6fe164a2b`.
The raw snapshot remains excluded from version control.

## Contract Summary

Smartlead V1 should provide read-only SendLens parity for core outbound
analysis:

- campaign directory, detail, status, schedule, tracking, tags, and sending
  limits
- sequence templates and variants
- campaign aggregate metrics
- campaign date-range metrics
- sequence-level or email-level statistics that can back step analytics
- campaign sender account assignments
- workspace sender account inventory and warmup health
- campaign lead evidence with engagement flags and custom fields
- reply and outbound message history for reply-signal leads or bounded samples
- provider-wide analytics client methods for future use; V1 refresh does not
  normalize or claim those client-only surfaces

Smartlead V1 must not implement write or operations endpoints:

- campaign create/update/delete/status mutation
- sequence save/update
- email account create/update/warmup mutation
- lead add/update/pause/resume/delete/unsubscribe/category mutation
- inbox reply/forward/send-test
- webhook create/update/delete

Smartlead V1 reads inbox-placement evidence from the separate support-gated
Smart Delivery API at `https://smartdelivery.smartlead.ai`. SendLens maps exact
test definitions, run counts, provider/region and sender aggregates, and
authentication/blacklist diagnostics into Smartlead-specific tables and views.
It does not fabricate Instantly-style per-email placement rows from Smartlead
aggregates. A valid Standard API key without Smart Delivery access remains a
valid core provider configuration and records `inbox_placement=unsupported`.

## Provider Identity Rules

SendLens currently assumes native Instantly IDs in many tables and MCP inputs.
Smartlead support must add a provider dimension before Smartlead rows are mixed
with Instantly rows.

Required identity fields:

| Field | Rule |
| --- | --- |
| `source_provider` | Literal source provider id: `instantly` or `smartlead`. This must be a new provider/source column or provider-aware view field. Do not reuse `sendlens.accounts.provider`, which currently means mailbox/email-service provider. |
| `provider_campaign_id` | Native campaign id as a string. For Smartlead this is the numeric `id` serialized as text. |
| `campaign_source_id` | Stable composite key: `source_provider || ':' || provider_campaign_id`, for example `smartlead:12345`. |
| `provider_account_id` | Native sender account id as a string. Smartlead uses numeric account ids. |
| `provider_lead_id` | Native lead id as a string. |
| `normalized_email` | Lowercased email for cross-provider lead and sender dedupe. |
| `normalized_domain` | Lowercased domain extracted from email when no company domain is present. |
| `source_raw_json` | Redacted raw source payload for fields that do not normalize cleanly. Must not include mailbox connection fields. |

MCP selector rules:

| Current selector | V1 provider-safe contract |
| --- | --- |
| `campaign_id` | Keep supported for Instantly compatibility. For Smartlead rows, accept `campaign_source_id` or provider-qualified campaign id. |
| `campaign_name` | If name matches more than one provider or campaign, return an ambiguity error with provider-qualified candidates. Do not guess. |
| `refresh_data(campaign_ids)` | Preserve existing Instantly behavior. Add a provider selector only in the implementation issue. |
| `load_campaign_data` and `fetch_reply_text` | Prefer `campaign_source_id` in new provider-aware flows. Preserve existing `campaign_id` for old Instantly callers. |

Existing Instantly behavior must remain the default unless the user explicitly
selects Smartlead through config or a provider parameter.

## Access, Logging, Rate Limits, And Pagination

| Concern | Contract |
| --- | --- |
| Base URL | `https://server.smartlead.ai/api/v1` for the read-only V1 API. |
| Access parameter | Smartlead uses a query-string access parameter. Client code must add it centrally and must redact it from logs, errors, traces, and thrown URLs. |
| Env | Add a dedicated Smartlead access env var and a provider selector. Do not overload the existing Instantly access env var. |
| Validation probe | Use `GET /campaigns/` with `include_tags=true` and a small timeout. Treat 401/403 as invalid, and 429/5xx/network as unreachable. Do not print the access value. |
| Rate limit | Start at 50 requests/minute and 8 concurrent requests by default. Smartlead docs list Standard at 60/min and recommend using 80 percent of the limit. |
| Burst limit | Enforce a 10 requests/second default burst gate for Standard accounts. Keep plan limits configurable. |
| Timeout and retry | Apply a 30-second request timeout. Retry 429, 500, 502, and 503 with exponential backoff and jitter. Honor `Retry-After` when present and never wait less than the exponential backoff. Also parse response-body retry seconds as a fallback. |
| Headers | Capture rate-limit limit, remaining, and reset headers when present for trace diagnostics. |
| Pagination | Use offset/limit for Smartlead list endpoints. Do not reuse Instantly cursor helpers. |
| Page sizes | Campaign leads max 100 per docs. Email accounts max 100 per docs. Campaign statistics max 1000 per docs. Campaign mailbox stats max 20 per docs. |
| Sensitive fields | Smartlead email account responses can include mailbox connection fields. Never persist those fields in DuckDB normalized tables, raw JSON, traces, fixtures, or test snapshots. |

## Endpoint Mapping

| SendLens capability | Smartlead endpoint | Parameters | Expected response shape | Normalize into | Parity |
| --- | --- | --- | --- | --- | --- |
| Access probe | `GET /campaigns/` | `include_tags=true` | Direct array of campaigns in docs, while some examples mention wrappers. Client must accept direct array and common wrapped forms. | setup-doctor result only | Strong |
| Campaign directory | `GET /campaigns/` | `include_tags=true`, optional `client_id` | Campaign objects with `id`, `user_id`, `created_at`, `updated_at`, `status`, `name`, `track_settings`, `scheduler_cron_value`, `min_time_btwn_emails`, `max_leads_per_day`, `stop_lead_settings`, `send_as_plain_text`, `parent_campaign_id`, `client_id`, `tags`. | `campaigns`, `custom_tags`, `custom_tag_mappings` | Strong |
| Campaign detail | `GET /campaigns/{campaign_id}` | `include_tags=true` | Single campaign object, sometimes shown as direct object and sometimes as wrapped data. Client must unwrap. | `campaigns` update/merge | Strong |
| Sequences/templates | `GET /campaigns/{campaign_id}/sequences` | access value only | Wrapped data array with `seq_number`, `subject`, `email_body`, and `sequence_variants[]`. | `campaign_variants` | Strong |
| Campaign aggregate analytics | `GET /campaigns/{campaign_id}/analytics` | campaign id | Object with `campaign_id`, `campaign_name`, `total_sent`, `total_opened`, `total_clicked`, `total_replied`, rates, bounce/unsubscribe rates. | `campaign_analytics` | Medium |
| Campaign daily/range metrics | `GET /campaigns/{campaign_id}/analytics-by-date` | `start_date`, `end_date` ISO timestamps | Object for the requested range, not a documented per-day row array. Use as range metrics unless live fixture proves per-day rows. | `campaign_daily_metrics` only after shape validation; otherwise coverage note | Medium |
| Step/sequence statistics | `GET /campaigns/{campaign_id}/statistics` | `offset`, `limit`, optional `email_sequence_number`, `email_status`, sent-time filters | Docs conflict: one section shows sequence aggregate rows; another shows overall object plus detailed email statistics fields. Client must fixture both. | `step_analytics`; detailed email event rows need a separate diagnostic surface if exposed | Partial |
| Campaign mailbox statistics | `GET /campaigns/{campaign_id}/mailbox-statistics` | `offset`, `limit` max 20, optional date range/timezone/client id | Mailbox-scoped campaign stats. | `campaign_accounts`, account rollups if row shape supports it | Medium |
| Campaign sending accounts | `GET /campaigns/{campaign_id}/email-accounts` | campaign id | Email account rows associated with one campaign. | `campaign_account_assignments`, `campaign_accounts` view | Strong |
| Workspace email accounts | `GET /email-accounts/` | `offset`, `limit`, optional filters, `fetch_campaigns=true` | Direct array with `id`, `from_email`, `from_name`, `type`, `client_id`, `campaign_count`, `message_per_day`, `daily_sent_count`, `warmup_details`, `tags`, optional `campaign_ids`, plus connection fields that must be dropped. | `accounts`, `custom_tags`, `custom_tag_mappings`, optional `campaign_account_assignments` | Strong |
| Account warmup stats | `GET /email-accounts/{email_account_id}/warmup-stats` | account id | `total_sent`, `spam_count`, `reputation_score`, `daily_stats[]` for last 7 days. | `accounts.warmup_score`, `account_daily_metrics` partial | Medium |
| Campaign leads | `GET /campaigns/{campaign_id}/leads` | `offset`, `limit` max 100, optional `status`, `emailStatus`, `lead_category_id`, date filters | `{total,leads,offset,limit}` with lead contact fields, `status`, `category_id`, `category_name`, `email_stats`, `custom_fields`. | `sampled_leads`, `lead_payload_kv` | Strong |
| Lead lookup by id | `GET /leads/{lead_id}` | lead id | Single lead row. | backfill into `sampled_leads` | Medium |
| Lead lookup by email | `GET /leads/` | email query | Search result by email with associated campaign data. | backfill into `sampled_leads` | Medium |
| Message history | `GET /campaigns/{campaign_id}/leads/{lead_id}/message-history` | optional `event_time_gt`, plain-text response flag | `{messages:[...]}` with `id`, `subject`, `direction`, `sent_at` or `received_at`, and optional body fields when plain-text output works. | `reply_emails`; exact outbound history requires a new surface or schema/MCP migration | Medium |
| Bulk message history | `POST /campaigns/{campaign_id}/message-history-for-leads/bbfbdsFGHlBr76ruhjvh6fhHL` | `lead_ids` body, optional event time | `{data:{lead_id:[messages]}}`. Static path segment is docs-confirmed but live-untested. | `reply_emails`; exact outbound history requires a new surface or schema/MCP migration | Medium |
| Global overall analytics | `GET /analytics/overall-stats-v2` | `start_date`, `end_date`, optional timezone/client/campaign ids | Wrapped `overall_stats` with raw counts, unique counts, rates, positive replies. | Client-only in V1; not normalized or claimed by refresh. | Partial |
| Campaign performance analytics | `GET /analytics/campaign/overall-stats` | date range, timezone, optional client/campaign ids, limit/offset/full-data flag | Wrapped `campaign_wise_performance[]`. | Client-only in V1; not normalized or claimed by refresh. | Partial |
| Provider performance | `GET /analytics/mailbox/provider-wise-overall-performance` | date range, timezone/client/campaign filters | Provider-level mailbox performance. | Client-only in V1; not normalized or claimed by refresh. | Later |
| Smart Delivery placement tests | Read and read-equivalent endpoints on `https://smartdelivery.smartlead.ai` | separate host, support-gated | Test/run, provider/region, sender, authentication, blacklist, IP, and spam-filter evidence. Message content and raw reply headers are excluded. | `smartlead_delivery_tests`, `smartlead_delivery_evidence`, Smartlead delivery views | Supported when authorized; explicit unsupported capability otherwise |

## Normalized Table Contract

### `campaigns`

| Field | Smartlead source |
| --- | --- |
| `id` | `campaign_source_id` once provider-aware schema lands. Until then, Smartlead implementation must not mix with Instantly rows in the same cache without schema migration. |
| `source_provider` | `smartlead` in a new provider-aware column or view field. |
| `provider_campaign_id` | `String(campaign.id)`. |
| `organization_id` | `client_id` when present, else `user_id` as a best-effort workspace owner id. |
| `name` | `name`. |
| `status` | Normalize `ACTIVE`, `PAUSED`, `STOPPED`, `ARCHIVED`, `DRAFTED` to existing status labels without changing existing Instantly mapping. |
| `daily_limit` | `max_leads_per_day` or detail `sending_limit`. |
| `text_only` / `first_email_text_only` | `send_as_plain_text`. |
| `open_tracking` | `false` when `track_settings` includes `DONT_EMAIL_OPEN`, else `true`. |
| `link_tracking` | `false` when `track_settings` includes `DONT_LINK_CLICK`, else `true`. |
| `stop_on_reply` | `stop_lead_settings == REPLY_TO_AN_EMAIL`. |
| `schedule_timezone` | `scheduler_cron_value.tz`. |
| `timestamp_created` | `created_at`. |
| `timestamp_updated` | `updated_at`. |

### `campaign_variants`

| Field | Smartlead source |
| --- | --- |
| `sequence_index` | Zero-based ordinal from the returned sequence order. |
| `step` | `seq_number`. |
| `variant` | `0` for base sequence body; one-based index or variant id mapping for `sequence_variants[]`. Store native variant id in raw JSON if added later. |
| `step_type` | `email`. |
| `delay_value` | `seq_delay_details.delay_in_days` when present. Current get-sequences examples omit delay; live validation required. |
| `delay_unit` | `days`. |
| `subject` | `subject` or variant `subject`. |
| `body_text` | HTML-stripped `email_body`; preserve original HTML in raw JSON only if a raw column is added. |

### `campaign_analytics`

| Field | Smartlead source |
| --- | --- |
| `leads_count` | Campaign detail `total_leads` or statistics `total_leads`. |
| `contacted_count` | `contacted`, `leads_contacted`, or `unique_lead_count`, depending on endpoint shape. Prefer exact contacted when present. |
| `emails_sent_count` | `total_sent`, `sent`, or `overall_stats.sent`. |
| `open_count` | `total_opened` or `opened`. |
| `open_count_unique` | `unique_open_count` when present; otherwise null. |
| `reply_count` | `total_replied`, `replied`. |
| `reply_count_unique` | Use distinct-lead count only when documented; otherwise null and recompute rates from raw counts where appropriate. |
| `link_click_count` | `total_clicked` or `clicked`. |
| `bounced_count` | `bounced` or derived from rate only if raw count exists. Do not store rate-derived counts. |
| `unsubscribed_count` | `unsubscribed` when present. |
| `total_interested` | `positive_replied` or campaign response positive count, with evidence label that category is mutable. |

### `campaign_daily_metrics`

Smartlead docs confirm date-range analytics but do not clearly confirm that
`GET /campaigns/{campaign_id}/analytics-by-date` returns one row per day.
Implementation must not invent per-day rows from a range response.

Use one of these strategies:

1. If live or synthetic fixture confirms daily rows, map each row into
   `campaign_daily_metrics`.
2. If endpoint returns only a range aggregate, store no daily rows and add a
   `sampling_runs.coverage_note` explaining that Smartlead range analytics are
   available but daily rows were not confirmed.
3. Use global day-wise analytics only if the response can be safely filtered to
   campaign ids and mapped to campaign/date rows.

### `step_analytics`

Smartlead has a documented `statistics` endpoint with `email_sequence_number`
and `email_status` filters, but response examples conflict. V1 implementation
must fixture both shapes:

- sequence aggregate rows with `sequence_number`, `sent`, `opened`, `clicked`,
  `replied`, `unsubscribed`, `bounced`
- detailed email-level rows with `lead_email`, `sequence_number`, `sent_time`,
  `is_opened`, `is_clicked`, `is_replied`, `is_bounced`

Normalize only counts that are present. Do not fabricate variant-level analytics
unless Smartlead returns variant ids or the sequence variant can be resolved from
message/template evidence.

### `accounts` And `account_daily_metrics`

| Field | Smartlead source |
| --- | --- |
| `email` | `from_email`, lowercased for identity comparisons but preserve display casing if schema supports it later. |
| `provider` | Existing `sendlens.accounts.provider` is mailbox/email-service provider and is exposed through `sendlens.campaign_accounts`. Smartlead account `type` may map here only as the mailbox provider value. Never write `smartlead` into this field. |
| `source_provider` | Required new provider/source column or provider-aware view field before Smartlead rows can share the same cache with Instantly rows. If the schema is not migrated, Smartlead account rows must stay isolated from existing Instantly account rows. |
| `provider_account_id` | Required new column or mapping table field for Smartlead numeric account ids. Existing account lookup views resolve accounts by `email`, not provider account id. |
| `daily_limit` | `message_per_day`. |
| `sending_gap` | `minTimeToWaitInMins`. |
| `first_name` / `last_name` | Split `from_name` only if no direct fields are available; otherwise leave nullable. |
| `warmup_status` | `warmup_details.status`. |
| `warmup_score` | Parse `warmup_details.warmup_reputation` percentage or use `warmup-stats.reputation_score`. |
| `total_sent_30d` | Do not derive from `daily_sent_count`, which is a today metric. Use mailbox analytics if a date-range account rollup is validated. |
| `account_daily_metrics` | Map `warmup-stats.daily_stats` as warmup evidence only; do not treat warmup `sent` as campaign send volume. |

### `campaign_account_assignments`

Use `GET /campaigns/{campaign_id}/email-accounts` as the strongest source.
When `GET /email-accounts/?fetch_campaigns=true` returns `campaign_ids`, it can
backfill assignments for workspace metadata. Use `provider_account_id` as the
assignment key and `from_email` as `account_email`.

### `custom_tags` And `custom_tag_mappings`

Smartlead campaign tags are available on campaign list/detail when
`include_tags=true`. Email account tags are always included on email account
rows. Preserve the current SendLens lookup keys unless a schema/view migration is
part of the implementation issue:

| Resource | Mapping |
| --- | --- |
| Campaign tag | Existing views require numeric `resource_type = 2` and `resource_id` matching `sendlens.campaigns.id`. After the provider-aware campaign migration, that id may be `campaign_source_id`; before that migration, do not store Smartlead campaign tags in a mixed cache. |
| Account tag | Existing views require numeric `resource_type = 1` and `resource_id` as the account email because `sendlens.account_tags` exposes `resource_id AS account_email`. Do not use Smartlead provider account ids here unless the tag views and downstream recipes are migrated. |
| Lead tag | Not in V1 unless a read-only lead tag mapping endpoint is explicitly added and fixture-backed. |

If Smartlead needs native ids on tag mappings, add explicit columns such as
`source_provider` and `provider_resource_id`, or a provider mapping table, then
update `campaign_tags`, `account_tags`, tag-scoped query recipes, and MCP
contract tests in the same implementation PR.

### `sampled_leads`

| Field | Smartlead source |
| --- | --- |
| `id` | `provider_lead_id`. |
| `email` | `email`. |
| `first_name` / `last_name` | direct fields. |
| `company_name` | direct field. |
| `company_domain` | direct field if present, else derive from email domain only for `normalized_domain`, not as company fact. |
| `status` | Values such as `STARTED`, `INPROGRESS`, `COMPLETED`, `PAUSED`, `STOPPED`. |
| `email_open_count` | `1` or null from `email_stats.is_opened`; exact counts only if statistics endpoint returns counts. |
| `email_reply_count` | `1` or null from `email_stats.is_replied`; exact counts only if message history/statistics returns counts. |
| `email_click_count` | `1` or null from `email_stats.is_clicked`; exact counts only if counts are present. |
| `lt_interest_status` | Do not reuse Instantly numeric status values. Add provider-aware outcome mapping or keep null and use `reply_outcome_label` views from category fields. |
| `timestamp_last_contact` | `last_contacted_at`, then documented `last_sent_time`, then legacy `timestamp_last_contact`. |
| `timestamp_last_reply` | Message history latest inbound `received_at` or statistics reply event when available. |
| `job_title`, `personalization` | Direct field when returned, else the matching `custom_fields` key. |
| `website` | Documented native `website`, else the matching `custom_fields` key. |
| `phone` | Documented native `phone_number` (including camel-case/legacy variants), else `custom_fields.phone_number` or `custom_fields.phone`. |
| `custom_payload` | Full `custom_fields` object plus documented native `phone_number`, `website`, `location`, `linkedin_profile`, and `company_url` when present. If a native value conflicts with the same custom key, keep the custom value under its original key and expose the native value as `smartlead_native_<key>`. If that fallback key is occupied, append a numeric suffix rather than overwriting either value. Smartlead status/category context is also retained. |
| `sample_source` | `smartlead_campaign_leads`, `smartlead_replied_leads`, or `smartlead_message_history_backfill`. |

`lead_payload_kv` expands this payload without discarding original keys or JSON values. Additive normalized-key, metadata-family, value-type, scalar, and normalized-scalar columns support discovery; exact source keys remain authoritative for grouping and template interpretation.

### `reply_emails`, Reconstructed Outbound, And Exact Outbound History

Use message history for exact thread evidence. Normalize by message direction,
without changing evidence semantics of existing reconstructed outbound surfaces:

| Direction | Target surface |
| --- | --- |
| `inbound` | `reply_emails` |
| `outbound` with exact body text | New explicit exact outbound surface, for example `outbound_message_history`, or a documented schema and MCP response contract migration. Do not store exact delivered bodies in `sampled_outbound_emails` under the current contract. |
| `outbound` without body text | Reconstruct from `campaign_variants` plus `custom_fields` and store only as reconstructed sample evidence in `sampled_outbound_emails`. |

Message ids may be non-unique across leads in examples. Store ids as
`smartlead:{campaign_id}:{lead_id}:{message_id}` if needed to avoid collisions.

Current `sampled_outbound_emails` has no `evidence_label` column, and current
MCP guidance documents it as locally reconstructed outbound context. If
Smartlead exact outbound bodies are exposed in V1, the implementation must add
schema, views, MCP response contract language, and tests that keep exact
message-history evidence separate from reconstructed outbound evidence.

### `sampling_runs` And Provider Capabilities

Add or expose a provider capability record so MCP tools can explain empty tables
without treating them as stale cache:

| Capability | Smartlead V1 |
| --- | --- |
| `campaign_directory` | supported |
| `campaign_detail` | supported |
| `campaign_sequences` | supported |
| `campaign_analytics` | supported, medium confidence |
| `campaign_daily_metrics` | partial until daily row shape is validated |
| `step_analytics` | partial until statistics row shape is validated |
| `sender_accounts` | supported |
| `account_campaign_assignments` | supported |
| `account_warmup` | supported, last 7 days |
| `account_daily_campaign_metrics` | partial |
| `lead_evidence` | supported |
| `reply_message_history` | supported, medium confidence |
| `exact_outbound_history` | partial; requires a new exact outbound surface before MCP exposure |
| `custom_tags` | partial for campaign/account only |
| `lead_lists` | later |
| `inbox_placement` | supported when the key is authorized for Smart Delivery; explicit support-gated `unsupported` otherwise |
| `webhooks` | later, not read-only refresh |

## Live-Shape Unknowns

| Unknown | Why it matters | Required handling without live access |
| --- | --- | --- |
| Campaign list wrapper | Docs say direct array, but generated examples sometimes assume wrapped campaigns. | Client parser accepts direct array and common wrapped variants. Fixture all variants. |
| Campaign analytics shape | Campaign-scoped analytics and global analytics have different field names and rate semantics. | Normalize only documented raw counts. Recompute rates locally for SendLens answers. |
| `analytics-by-date` granularity | Docs show a date range object, not guaranteed daily rows. | Do not populate `campaign_daily_metrics` unless fixture confirms rows. |
| `statistics` shape | Docs conflict between sequence aggregate, campaign aggregate, and detailed email statistics. | Build a parser that supports aggregate sequence rows and detailed email rows, with nulls for unavailable fields. |
| Message history bodies | Example omits body fields even with plain-text output documented. | Treat body as optional. Inbound exact bodies map to `reply_emails`; outbound exact bodies require a new exact outbound surface, while missing outbound bodies fall back to reconstruction. |
| Bulk message-history static suffix | Docs include `bbfbdsFGHlBr76ruhjvh6fhHL` in the path. | Keep endpoint behind one client method and mark live-untested. Unit-test URL construction exactly from docs. |
| Reply category mapping | Smartlead categories are mutable and workspace-defined. | Use `category_id/category_name` as evidence. Do not infer positive/negative from reply text in V1. |
| Account daily campaign metrics | Warmup stats are not campaign sends. Mailbox stats/global mailbox analytics need live shape validation. | Keep account daily campaign metrics null or partial until fixture-backed. |
| Smart Delivery placement | Separate host and access model; provider/region reports are aggregates rather than Instantly-style per-email rows. | Use Smartlead-specific exact tables/views when authorized. Mark `inbox_placement` support-gated `unsupported` only when the initial delivery probe returns 401/403/404. |

## No-Live-Access Validation Strategy

Brandon does not have live Smartlead access. Implementation issues must validate
without calling Smartlead.

Required local validation:

1. Add synthetic Smartlead fixture payloads derived from public docs. Fixture
   names should include endpoint and shape, for example
   `campaigns.direct-array.json`, `campaigns.wrapped-data.json`,
   `statistics.sequence-aggregate.json`, and `statistics.email-detail.json`.
2. Test URL construction separately from HTTP execution. Assert the access
   query parameter is appended but redacted in trace/error output.
3. Test rate-limit behavior with fake 429 responses covering `Retry-After`,
   response-body retry seconds, and fallback exponential backoff.
4. Test offset pagination for leads, email accounts, and statistics with
   empty-page, exact-page, and short-page termination.
5. Test normalizers into SendLens tables using synthetic fixtures. Do not call
   Smartlead from tests.
6. Test conditional capability reporting: authorized Smart Delivery reads must
   surface exact Smartlead-specific evidence; support-gated 401/403/404 must
   surface `inbox_placement=unsupported` without producing stale or fake
   Instantly-style per-email rows.
7. Run existing MCP response contract tests to prove old tool shapes remain
   valid for Instantly and demo mode.

Optional live validation, only when access exists:

1. Run a read-only probe against `GET /campaigns/` with tags included.
2. Capture redacted response shape summaries only: endpoint, status, top-level
   keys, row count, nested key names, and pagination metadata.
3. Do not commit raw customer payloads, email addresses, mailbox connection
   fields, cookies, or reply bodies.
4. Convert redacted shape summaries into synthetic fixtures before code relies
   on them.

## Implementation Dependency Notes

- SENDOSS-71 and SENDOSS-72 should wait for this contract unless an interim
  provider contract is explicitly produced.
- The first code issue should add provider config, Smartlead client primitives,
  redaction, rate limiting, parsers, and fixtures without changing the default
  Instantly path.
- The ingest issue should add provider-aware identity fields before mixing
  Smartlead rows into the existing DuckDB schema.
- The schema issue must preserve current account and tag lookup semantics:
  `accounts.provider` remains mailbox provider, account tags keep email
  resource ids with numeric resource type `1`, and campaign tags keep numeric
  resource type `2` until their views are migrated.
- Exact Smartlead outbound message bodies require a new explicit surface or a
  schema plus MCP contract migration before agents can treat them as delivered
  outbound evidence.
- PR review should verify that no Smartlead query-string access value can appear
  in logs, thrown errors, trace files, snapshots, or docs.
