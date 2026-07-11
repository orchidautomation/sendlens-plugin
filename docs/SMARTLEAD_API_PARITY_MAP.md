# Smartlead API Parity Map

Date checked: 2026-07-11

This is the first implementation map for adding Smartlead as a second data
source while preserving the current SendLens behavior. SendLens today is a
read-only local analytics layer over Instantly: it fetches campaign, sender,
tag, analytics, lead, reply, and inbox-placement evidence into DuckDB, then
serves MCP tools for workspace diagnosis.

Implementation contract: `docs/SMARTLEAD_PROVIDER_CONTRACT.md` is the
implementation-ready V1 provider contract produced from this parity map. Treat
it as the source of truth for SENDOSS-71 and SENDOSS-72 unless a newer contract
supersedes it.

Sources:

- Current SendLens code: `plugin/instantly-client.ts`, `plugin/instantly-ingest.ts`,
  `plugin/server.ts`, `plugin/constants.ts`, `pluxx.config.ts`
- Smartlead help-center API doc:
  https://helpcenter.smartlead.ai/en/articles/125-full-api-documentation
- Smartlead API reference pages:
  https://api.smartlead.ai/api-reference/campaigns/get-all,
  https://api.smartlead.ai/api-reference/analytics/overview,
  https://api.smartlead.ai/api-reference/campaigns/get-lead-history,
  https://api.smartlead.ai/api-reference/campaigns/get-leads-history-bulk

The 2026-07-11 audit also checked the complete official `llms-full.txt`
snapshot (`sha256: ab4c1a1bc65f3331b9d813f8509c67ca3b3014d80e4954e5d34fe7a6fe164a2b`),
the current rate-limit and error-handling guides, mailbox statistics, lead
lists, and Smart Delivery references. The raw snapshot is not committed.

## Current SendLens Shape

SendLens is special on Instantly because it combines these API surfaces into
one local, privacy-first analysis model:

- exact campaign directory and campaign configuration
- exact campaign aggregate, step/variant, and daily metrics
- exact sender account directory, daily account metrics, and warmup health
- exact campaign sender assignments from campaign detail
- exact custom tags and tag mappings for campaign/account scoping
- exact inbox placement tests and per-email placement/authentication analytics
- sampled or bounded lead evidence, including custom payload fields
- exact reply email bodies on demand, rate-limited through Instantly's email lane
- local reconstructed outbound copy from templates plus lead variables

Runtime MCP tools are intentionally read-oriented:

- `refresh_data`
- `load_campaign_data`
- `prepare_campaign_analysis`
- `fetch_reply_text`
- `workspace_snapshot`
- `list_tables`
- `list_columns`
- `search_catalog`
- `analysis_starters`
- `setup_doctor`
- `seed_demo_workspace`
- `refresh_status`
- `analyze_data`

## Existing Instantly Endpoint Inventory

| SendLens function | Instantly endpoint | What SendLens uses it for |
| --- | --- | --- |
| `listCampaignsPage` | `GET /campaigns` | Campaign directory, status, broad workspace selection |
| `validateApiKey` | `GET /campaigns?limit=1` | Setup probe without exposing the key |
| `listSubsequencesPage` | `GET /subsequences?parent_campaign=...` | Subsequence discovery where available |
| `getCampaignAnalytics` | `GET /campaigns/analytics` | Exact campaign aggregate metrics |
| `getCampaignDetails` | `GET /campaigns/{campaignId}` | Templates, sender assignments, schedule/settings |
| `getStepAnalytics` | `GET /campaigns/analytics/steps` | Exact step/variant metrics |
| `getDailyAnalytics` | `GET /campaigns/analytics/daily` | Exact campaign daily metrics |
| `listAccounts` | `GET /accounts` | Sending account inventory and settings |
| `listLeadLists` | `GET /lead-lists` | Lead list inventory, currently less central |
| `listCustomTags` | `GET /custom-tags` | Exact tag definitions |
| `listCustomTagMappings` | `GET /custom-tag-mappings` | Exact campaign/account tag assignments |
| `listLeadsPage` | `POST /leads/list` | Lead evidence, reply-signal scans, custom payload fields |
| `listEmails` | `GET /emails` | Exact inbound reply bodies and outbound email samples |
| `listLeadLabels` | `GET /lead-labels` | Lead label/category support where available |
| `getWarmupAnalytics` | `POST /accounts/warmup-analytics` | Per-account warmup/inbox-spam health |
| `getDailyAccountAnalytics` | `GET /accounts/analytics/daily` | Sender daily volume and bounce rates |
| `listInboxPlacementTestsPage` | `GET /inbox-placement-tests` | Inbox placement test definitions |
| `listInboxPlacementAnalyticsPage` | `GET /inbox-placement-analytics` | Per-email inbox/category/spam/auth results |

## Smartlead Foundation

Smartlead API base URL:

```text
https://server.smartlead.ai/api/v1
```

Authentication:

```text
?api_key=YOUR_API_KEY
```

This is a source-specific difference from Instantly, which uses an
`Authorization: Bearer ...` header. A Smartlead client should avoid logging
full URLs with query strings unless the API key is redacted first.

Rate-limit notes:

- The help-center page says rate limits vary by subscription plan and to
  contact support for plan-specific limits.
- The same page's error-handling section states `429` means the caller exceeded
  `10 requests per 2 seconds`, and recommends waiting at least 2 seconds before
  retrying.
- First client implementation should default to a conservative 10 requests per
  2 seconds sliding window, honor `429`, parse `Retry-After` if Smartlead sends
  it, and allow an env/config override once a customer's plan limit is known.

## Parity Map For Read-Only SendLens V1

The first Smartlead adapter should aim for read-only parity with the current
SendLens MCP behavior. Write endpoints exist in Smartlead, but they are not
needed for current SendLens and would change the product safety boundary.

| SendLens capability | Instantly source | Smartlead candidate | Parity | Notes |
| --- | --- | --- | --- | --- |
| Campaign directory | `GET /campaigns` | `GET /campaigns/?include_tags=true` | Strong | Smartlead returns campaign status, schedule, tracking settings, daily lead cap, client ID, parent campaign ID, and optional tags. No cursor documented for this endpoint. |
| Campaign detail | `GET /campaigns/{id}` | `GET /campaigns/{campaign_id}` | Strong | Field names differ but schedule/settings are present. |
| Campaign templates/variants | Campaign detail plus local extraction | `GET /campaigns/{campaign_id}/sequences` | Strong | Smartlead sequences expose sequence number, delays, subject, HTML body, and variant labels. This may be cleaner than Instantly detail parsing. |
| Campaign aggregate analytics | `GET /campaigns/analytics` | `GET /campaigns/{campaign_id}/analytics` and possibly `GET /analytics/overall-stats-v2` | Medium | Smartlead appears campaign-scoped for top-level campaign analytics; current API reference uses `overall-stats-v2` for global date-range analytics while help-center mentions `/analytics/overview`. Verify live response shapes before schema work. |
| Campaign daily metrics | `GET /campaigns/analytics/daily` | `GET /campaigns/{campaign_id}/analytics-by-date` | Medium | Smartlead date range is documented with a max 30-day span. SendLens may need chunking for longer lookbacks. |
| Step/variant analytics | `GET /campaigns/analytics/steps` | `GET /campaigns/{campaign_id}/statistics?email_sequence_number=...` | Partial | Smartlead statistics can filter by sequence number and email status. Need live fixture to confirm whether variant-level counts are present or only sequence/status rows. |
| Sending accounts | `GET /accounts` | `GET /email-accounts/?offset=0&limit=100` | Strong | Smartlead uses offset pagination and max page size 100. |
| Per-campaign sending accounts | Campaign detail assignment extraction | `GET /campaigns/{campaign_id}/email-accounts` | Strong | This is explicit in Smartlead and should simplify `campaign_accounts`. |
| Account warmup health | `POST /accounts/warmup-analytics` | `GET /email-accounts/{email_account_id}/warmup-stats` | Medium | Smartlead returns last 7 days. Instantly batches up to 100 emails per request. Smartlead requires per-account calls unless another bulk endpoint exists. |
| Account daily metrics | `GET /accounts/analytics/daily` | Global analytics `email health by domain and individual account`, plus warmup stats | Partial | Smartlead's documented global analytics includes account/domain health, but exact per-account daily send/bounce equivalent needs live validation. |
| Lead evidence | `POST /leads/list` | `GET /campaigns/{campaign_id}/leads?offset=0&limit=100` | Strong | Smartlead exposes status, contact info, custom fields, and engagement metrics. Use offset pagination. |
| Lead lookup/backfill | `POST /leads/list` with `ids` or `contacts` | `GET /leads/{lead_id}` and `GET /leads/?email=...` | Strong | Smartlead has both ID and email-based lead lookups in docs. |
| Reply bodies | `GET /emails?email_type=received&i_status=...` | `GET /campaigns/{campaign_id}/leads/{lead_id}/message-history` or bulk `POST /campaigns/{campaign_id}/message-history-for-leads/...` | Medium | Smartlead message history can return full thread context. Bulk endpoint can reduce per-lead API cost, but its path includes a documented static segment that must be verified live. |
| Reply categories/outcomes | Instantly `i_status` and lead state | Lead `category_id/category_name`, email stats, global analytics positive replies | Medium | Need mapping from Smartlead categories to SendLens `positive`, `negative`, `neutral`, `wrong_person`, `ooo`. Do not infer sentiment from text in V1. |
| Outbound delivered/reconstructed copy | `GET /emails` outbound sample plus templates | Message history plus sequences/templates | Medium | If message history includes sent body text, expose it only through a new exact outbound surface or schema/MCP migration. If not, reconstruct from sequence templates plus lead custom fields. |
| Custom tags | `GET /custom-tags`, `GET /custom-tag-mappings` | Campaign list with `include_tags=true` | Partial | Campaign tags are available inline. Need separate evidence for account tags, lead tags, or tag definitions/mappings outside campaigns. |
| Lead lists | `GET /lead-lists` | Documented Smartlead lead-list reads | Later | Available but outside the V1 normalized refresh because campaign leads cover the current analysis contract. |
| Inbox placement tests | `GET /inbox-placement-tests`, `GET /inbox-placement-analytics` | Smart Delivery reads on separate `smartdelivery.smartlead.ai` service | Provider-specific parity | SendLens ingests test/run aggregates, sender/provider/region metrics, and authentication/blacklist diagnostics when authorized. It does not claim per-email parity. |
| Webhooks | Not used by SendLens V1 | `POST/GET/PUT/DELETE /webhooks` | Later | Useful for future incremental sync, but not needed for read-only local refresh parity. |

## Parity Clarification

Smartlead is close enough for a useful read-only SendLens V1, but it is not
strictly 1:1 with Instantly. The headline is:

- Core campaign, lead, sender, sequence/template, reply-history, and basic
  analytics surfaces are strong or medium parity.
- Smart Delivery placement analytics use a separate support-gated service.
  SendLens reads it when authorized and records an explicit unsupported
  capability without breaking core refresh when access is absent.
- A few other areas need normalization or live-shape validation: step/variant
  analytics, account daily metrics, campaign/account tags, reply outcome labels,
  and the exact global analytics endpoint name.

So the product framing should be "Smartlead parity for core outbound analysis,
with provider-specific deliverability evidence," not "every Instantly table has
an identical Smartlead endpoint."

## Smartlead Endpoints Worth Implementing First

V1 adapter minimum for useful SendLens parity:

1. `GET /campaigns/?include_tags=true`
2. `GET /campaigns/{campaign_id}`
3. `GET /campaigns/{campaign_id}/sequences`
4. `GET /campaigns/{campaign_id}/analytics`
5. `GET /campaigns/{campaign_id}/analytics-by-date`
6. `GET /campaigns/{campaign_id}/statistics`
7. `GET /campaigns/{campaign_id}/email-accounts`
8. `GET /email-accounts/?offset=0&limit=100`
9. `GET /email-accounts/{email_account_id}/warmup-stats`
10. `GET /campaigns/{campaign_id}/leads?offset=0&limit=100`
11. `GET /leads/{lead_id}`
12. `GET /leads/?email=...`
13. `GET /campaigns/{campaign_id}/leads/{lead_id}/message-history?show_plain_text_response=true`
14. `POST /campaigns/{campaign_id}/message-history-for-leads/...`
15. `GET /analytics/overall-stats-v2`

Do not implement Smartlead write endpoints in this phase:

- campaign create/update/delete
- sequence save
- account create/update/warmup configuration
- lead add/update/pause/resume/delete/unsubscribe
- inbox reply/forward/send-test
- webhook mutation

Those are valuable platform capabilities, but they would move SendLens from
read-only analysis into campaign operations.

## Adapter Design Notes

Recommended implementation shape:

- Add a provider boundary such as `plugin/providers/instantly-client.ts` and
  `plugin/providers/smartlead-client.ts`, or keep the current Instantly file
  intact and add `plugin/smartlead-client.ts` first for a smaller diff.
- Keep provider-specific auth, pagination, rate limiting, and response parsing
  inside the client layer.
- Normalize into the existing DuckDB tables/views where semantics match.
- Add Smartlead-specific nullable/raw JSON columns only when exact fields do
  not map cleanly.
- Add `SENDLENS_PROVIDER=instantly|smartlead` and
  `SENDLENS_SMARTLEAD_API_KEY` rather than overloading the existing Instantly
  env var.
- Preserve demo mode and existing Instantly behavior by default.
- Redact Smartlead query-string API keys in traces, errors, setup doctor output,
  and HTTP logs.

## Dual-Provider Client Model

Some clients will run campaigns from both Instantly and Smartlead for sender,
domain, mailbox, or platform diversification. SendLens should treat that as a
single client workspace with multiple source providers, not as two unrelated
workspaces.

Recommended model:

- Add a source-provider dimension to ingested rows: use a new field such as
  `source_provider` with values like `instantly` and `smartlead`. Do not reuse
  existing mailbox-provider fields such as `sendlens.accounts.provider`.
- Preserve raw source IDs in provider-specific columns or composite IDs:
  `provider_campaign_id`, `provider_account_id`, `provider_lead_id`.
- Use a stable composite campaign key for cross-provider tables:
  `campaign_source_id = source_provider || ':' || provider_campaign_id`.
- Keep source-native raw JSON for provider-specific fields that do not normalize
  cleanly.
- Keep one client/workspace cache that can contain both providers, with refresh
  metadata by provider.

Cross-provider analysis rules:

- Compare campaigns across providers only on normalized metrics with matching
  definitions: sends, replies, bounces, positive replies, lead count, open/click
  counts when tracking is enabled.
- Recompute rates from normalized counts where possible. Do not blindly compare
  provider-native rates because Smartlead and Instantly may use different
  denominators or unique/raw definitions.
- Keep provider-specific evidence surfaces. Example: `inbox_placement` can be
  exact for Instantly and unavailable for Smartlead; Smartlead exact outbound
  `message_history` requires a new explicit surface before MCP exposure.
- Deduplicate lead/person analysis by normalized email and domain across
  providers, but keep campaign membership and reply events source-specific.
- Detect overlap risks: same lead, same domain, or same company being contacted
  from both providers within an unsafe window.
- Support provider-balanced views: "what is working overall?", "what is working
  in Instantly?", "what is working in Smartlead?", and "is diversification
  helping or just splitting volume?"

Tables/views should eventually expose both provider-scoped and client-wide
answers:

- `campaign_overview`: add `source_provider`, `provider_campaign_id`, and
  `campaign_source_id`.
- `accounts` and `campaign_accounts`: add source-provider/native-id fields so
  sender utilization can be compared without ID collisions while preserving
  `accounts.provider` as the mailbox/email-service provider field.
- `lead_evidence` and `reply_context`: add provider fields and normalized lead
  identity fields such as `normalized_email`, `normalized_domain`, and
  `company_domain` where available.
- `sampling_runs`: track provider, refresh mode, and unsupported surfaces.
- Add a small provider capability view, for example
  `provider_capabilities`, so agents can explain why Smartlead lacks
  `inbox_placement_*` rows instead of treating it as stale data.

Operationally, the MCP tools can stay the same. The right abstraction is:

- `refresh_data(provider?: "instantly" | "smartlead" | "all")`
- `workspace_snapshot(provider?: "instantly" | "smartlead" | "all")`
- `load_campaign_data(campaign_source_id=...)`

If the user passes a campaign name and it matches both providers, the tool
should return an ambiguity response with provider-qualified matches rather than
guessing.

## Known Smartlead Implementation Risks

- Rate limits are less explicit than Instantly's current limiter. Start with
  10 requests per 2 seconds and 429 backoff, then tune per plan.
- Smartlead uses offset pagination on several list endpoints, while Instantly
  uses cursor pagination. The adapter should not reuse cursor assumptions.
- Smartlead analytics docs have a naming mismatch between the help-center
  `/analytics/overview` quick reference and the current API reference
  `/analytics/overall-stats-v2`. Use the API reference endpoint first and
  verify against a live key before locking schema.
- Smartlead campaign list has inline tags, but no checked equivalent for
  Instantly's global custom tag mappings across account/campaign resources.
- Smart Delivery documents placement-test reads on a separate support-gated
  host; V1 reads provider-specific exact evidence when authorized and reports
  the capability as unsupported rather than inferring health when access is absent.
- Smartlead message-history endpoints may be better than Instantly reply fetches
  for thread context, but they require lead IDs. The refresh flow should first
  fetch campaign leads, then hydrate reply/message history only for reply-signal
  leads or bounded samples.

## Suggested Build Order

1. Add Smartlead env/config and setup-doctor validation without changing the
   default provider.
2. Add `smartlead-client` with redacted logging, 10-requests/2-seconds limiter,
   `Retry-After` support, offset pagination helpers, and response-shape tests.
3. Implement a read-only Smartlead refresh path for campaign directory,
   campaign detail, sequences, campaign analytics, campaign leads, email
   accounts, and warmup stats.
4. Normalize into existing `campaigns`, `campaign_variants`,
   `campaign_analytics`, `campaign_daily_metrics`, `accounts`,
   `campaign_accounts`, `sampled_leads`, `lead_payload_kv`, and
   `sampling_runs`.
5. Add reply/message-history hydration for one campaign, then map into
   `reply_emails` and `reply_email_context`.
6. Keep Instantly `inbox_placement_*` per-email views provider-specific. Add
   Smartlead delivery tables/views for exact aggregate and diagnostic evidence,
   with a support-gated capability fallback when access is absent.
7. Run provider-specific fixtures through the existing MCP response contract and
   prompt-contract tests.
