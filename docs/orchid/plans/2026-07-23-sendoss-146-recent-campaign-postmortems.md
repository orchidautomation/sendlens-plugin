---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
issue: SENDOSS-146
related_issue: SENDOSS-96
date: 2026-07-23
title: Recent Campaign Postmortem Hydration
type: feat
---

# Recent Campaign Postmortem Hydration

## Decision

Implement the SENDOSS-146 contract without a new product decision:

- Keep `workspace_snapshot` and operational KPIs active-only by default.
- Add explicit campaign inventory scopes: `active`, `active_or_recent`, and `all`.
- For normal unscoped Instantly refreshes, hydrate campaign details for campaigns that are active/running or have confirmed sends in the inclusive 30-day recency window.
- Store only bounded recency evidence in the local campaign directory. Do not expand whole-campaign hydration into unlimited lead, email, reply, or rendered outbound downloads.
- Mark Smartlead recent-activity coverage as unavailable until a safe provider-wide recency selector is implemented. Do not infer Smartlead parity from unrelated aggregate endpoints.

This resolves the issue’s contract; no material migration or product choice remains ambiguous.

## Provider Contract

### Instantly

Instantly supports bounded campaign analytics over date ranges and batches campaign ids through the existing client. Use `GET /api/v2/campaigns/analytics` with campaign ids plus `start_date` and `end_date`, then select inactive campaigns only when the provider confirms `emails_sent_count > 0` in the window. The API accepts multiple campaign ids and date filters, so this remains a bounded discovery pass rather than lead/email hydration.

Instantly campaign schedule payloads may include timezone fields. The recency window should be stored as calendar dates and include a timezone evidence field when the campaign exposes one. If no provider/account timezone is available before detail hydration, use a documented UTC fallback and mark that fallback in stored evidence.

### Smartlead

Smartlead has date-range analytics endpoints, but the current V1 provider refresh does not implement a safe provider-wide recent selector. `active_or_recent` must not silently claim Smartlead parity. Store or return provider capability coverage as `unavailable` for `recent_activity` with a coverage note explaining that Smartlead recent paused-campaign auto-hydration is not implemented in this release.

## Data Model

Add nullable fields to `sendlens.campaigns` and expose them through `sendlens.campaign_overview`:

- `detail_selection_reason`: `active`, `recent_sends`, `exact_id`, or `directory_only`.
- `recent_activity_coverage`: `available`, `unavailable`, or `not_evaluated`.
- `recent_activity_window_start` / `recent_activity_window_end`.
- `recent_activity_timezone` and `recent_activity_timezone_source`.
- `recent_sent_count`.
- `recent_activity_evaluated_at`.
- `recent_activity_source`.

Use an additive schema migration and bump the cache owner schema version so older local caches rebuild or migrate cleanly. Existing active-only reads must continue to work when these nullable fields are absent or null.

## Refresh Behavior

For unscoped Instantly refresh:

1. List all campaigns.
2. Fetch lifetime aggregate campaign analytics as today for directory truth.
3. Fetch date-ranged campaign analytics for all listed campaign ids over the inclusive 30-day window.
4. Select campaigns for normal bounded detail hydration when:
   - campaign status is active/running, or
   - recent analytics row has confirmed sent count greater than zero.
5. Store every campaign directory row, including recency coverage and the selected reason.
6. Hydrate selected campaigns through the existing bounded bundle path.

For exact-id refreshes from `load_campaign_data`, keep the current bounded campaign refresh and mark the response metadata as exact-id scoped. Exact refreshes should not clear or fabricate broad recent-activity coverage.

For Smartlead unscoped refresh, keep the current active-only selector and persist/report `recent_activity` capability as unavailable.

## Snapshot Behavior

Add `campaign_scope` to `workspace_snapshot`:

- `active` (default): current behavior, active campaigns only; operational totals and warnings remain active-only.
- `active_or_recent`: include active campaigns plus inactive campaigns selected by confirmed recent sends. Return selection reason and recency evidence in campaign rows. Operational `exact_metrics` remain active-only.
- `all`: return directory inventory only. Include stored aggregate metrics when present but describe rows as inventory rows, not fully hydrated campaign context.

Refresh responses and `load_campaign_data` metadata should identify provider, scope, selection counts, reasons, recency window, and bounded/incomplete coverage where applicable.

## Privacy And Bounds

This change stores only campaign-level status, aggregate counts, date windows, provider/source coverage labels, and non-sensitive campaign metadata already present in the local directory. It must not add client identifiers, API keys, raw campaign data, recipient data, message bodies, raw private replies, or unbounded lead/email downloads to logs, docs, fixtures, or responses.

Trace logs may include only counts, elapsed times, provider names, scope names, and capability coverage labels. They must not include raw provider ids beyond already-supported scoped campaign ids.

## Acceptance Tests

Add focused coverage for:

- Active campaigns are still selected and included by default.
- A paused/inactive Instantly campaign with `recent_sent_count > 0` in the inclusive 30-day window is selected for normal bounded hydration and appears in `active_or_recent`.
- A paused/inactive campaign with zero recent sends remains directory-only and is excluded from `active_or_recent`.
- Missing or null recent analytics is treated as unknown/unavailable, not zero.
- Boundary dates use `as_of_date - 29 days` through `as_of_date`.
- `workspace_snapshot` default `active` totals remain active-only.
- `workspace_snapshot` `all` is explicit directory inventory.
- Smartlead provider capabilities truthfully report recent activity unavailable.
- Schema migration updates existing caches additively.
- Privacy/static tests confirm no raw recipient/message bodies or keys are introduced.

Run the repository-required validation tier for provider/data/privacy changes: focused tests, `npm run test:plugin:smoke`, `npm run validate:plugin`, `npm run lint:plugin`, and prefer `npm run test:plugin` if runtime permits.

## Autofix Label

The planned code and schema changes are additive and same-branch repairable. If the PR is opened from this repo branch, add `ai:autofix-enabled`.

## Sources

- Linear `SENDOSS-146` and related `SENDOSS-96`.
- Instantly campaign analytics docs: `GET /api/v2/campaigns/analytics` supports campaign ids plus `start_date` and `end_date`.
- Instantly campaign docs: campaign schedule payloads include timezone fields.
- Smartlead campaign analytics-by-date and overall stats docs: date-range analytics exist, but this release does not normalize them into a provider-wide recent paused-campaign selector.
- Existing SendLens docs and code: `docs/SMARTLEAD_PROVIDER_CONTRACT.md`, `docs/MCP_RESPONSE_CONTRACT.md`, `plugin/instantly-client.ts`, `plugin/instantly-ingest.ts`, `plugin/smartlead-ingest.ts`, `plugin/local-db.ts`, and `plugin/summary.ts`.
