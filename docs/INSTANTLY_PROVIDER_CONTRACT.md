# Instantly V2 Provider Contract

Date checked: 2026-08-05
Validated by: `SENDOSS-163` live response-shape harness (`scripts/validate-instantly-shapes.mjs`).
Status: live-validated for the read surfaces below against an authorized Instantly workspace. Sanitized structural fixtures live in `scripts/fixtures/instantly-client/`.

This is the read-only Instantly V2 provider contract for SendLens OSS. It is derived from live response shapes (HTTP 200 surfaces), local SendLens code (`plugin/instantly-client.ts`, `plugin/instantly-ingest.ts`), and the public Instantly API V2 docs. No credentials or customer values are recorded here or in fixtures.

## Auth and envelope

- Auth: `Authorization: Bearer <SENDLENS_INSTANTLY_API_KEY>`. The key is read from the environment only; it is never logged, committed, or echoed in errors/traces/fixtures.
- List envelope: `{ "items": [...], "next_starting_after": "<id>" }`. Pagination is cursor-based via `starting_after`; `limit` is honored.
- Array-envelope surfaces (`campaigns/analytics`, `campaigns/analytics/steps`, `campaigns/analytics/daily`) return a bare top-level array — no `items` wrapper, no cursor.

## Validated read surfaces (HTTP 200)

| Surface | Envelope | Notable item keys | Denominator / notes |
|---|---|---|---|
| `GET /campaigns` | items + cursor | id, name, status, sequences, email_list, daily_limit, core_variables, custom_variables | campaign inventory; `custom_variables`/`core_variables` are dynamic label→bool maps (redacted to `<label_key>`) |
| `GET /accounts` | items + cursor | email, first_name, last_name, warmup_status, provider_code, tracking_domain_name, status, stat_warmup_score | sender inventory; `email` is the account identity |
| `GET /subsequences?parent_campaign=<id>` | items | (scoped) | requires `parent_campaign` param |
| `GET /campaigns/analytics` | bare array | campaign-level aggregates | no envelope/cursor; denominator = per-campaign exact aggregates |
| `GET /campaigns/<id>` | object (single) | same shape as a campaigns item | single-campaign detail |
| `GET /campaigns/analytics/steps?campaign_id=<id>` | bare array | step/variant aggregates | step grain; requires `campaign_id` |
| `GET /campaigns/analytics/daily?campaign_id=<id>` | bare array | campaign/day metrics | day grain; requires `campaign_id` |
| `GET /lead-lists` | items + cursor | id, organization_id, name, timestamp_created | lead-list inventory |
| `GET /custom-tags` | items + cursor | id, label, description, organization_id | tag inventory |
| `GET /custom-tag-mappings` | items + cursor | id, tag_id, resource_id, resource_type, organization_id | tag-application map |
| `GET /emails` | items + cursor | id, message_id, subject, body, to_address_email_list, from_address_email, campaign_id, lead_id, eaccount, ue_type, step, is_unread | **`body` is a private message body** — fixture redacts to `<str>`; never stored raw |
| `GET /lead-labels` | items + cursor | id, label, interest_status, interest_status_label, use_with_ai | lead-label taxonomy |
| `GET /leads/list` (POST) | items + cursor | id, email, first_name, last_name, company_name, company_domain, status, email_open_count, email_reply_count, email_click_count, status_summary, campaign, payload, esp_code | lead sample; `payload` is a dynamic KV blob; counts are observed totals |
| `GET /inbox-placement-tests` | items (no cursor) | test rows | deliverability test inventory |
| `GET /accounts/warmup-analytics` (POST `{emails:[]}`) | `{email_date_data, aggregate_data}` | per-email date→metrics + aggregates | keyed by email (redacted to `<email_key>`); date keys redacted to `<date_key>` |

## Blocked / pending surfaces

| Surface | HTTP | State | Reason |
|---|---|---|---|
| `GET /accounts/analytics/daily?account_id=<email>` | 413 | blocked | request too large without a date range; validate with `date_from`/`date_to` in a later pass |
| `GET /inbox-placement-analytics?test_id=<id>` | — | pending | requires a `test_id`; harness lookup did not yield a usable test id in this workspace (record, do not assume unsupported) |

## Non-comparable / denominator rules

- Reply/open/click counts on leads (`email_reply_count`, `email_open_count`, `email_click_count`) are **observed totals**, not population totals — the 500-lead sample boundary applies (see `SENDOSS-164` contract §7). Max claim: `observed`/`sampled`, never `population`.
- `campaigns/analytics` aggregates are exact per-campaign (population scope). Cross-provider reply rates are **non-comparable** until provider-qualified.
- `emails.body` and `to_address_email_list`/`from_address_email` are private content/PII — never persisted raw; fixture carries only the shape (`<str>`).
- Warmup analytics are per-sender, keyed by email — blast-radius attribution must not assign shared-sender metrics to a single campaign without explicit bounds (`SENDOSS-169`).

## Smartlead parity note

Smartlead is **beta / live-untested** in this pass: `SENDOSS-163` validated Instantly live; Smartlead read surfaces remain official-doc + synthetic-fixture validated only (see `docs/SMARTLEAD_PROVIDER_CONTRACT.md`). Smartlead live validation is deferred until a Smartlead key is available; those surfaces are recorded as `blocked / live-validation-pending`, not healthy.

## Regenerating fixtures

```
# key sourced from an authorized client env; never committed
set -a; . <path-to-client>.env; set +a
node scripts/validate-instantly-shapes.mjs
node scripts/test-instantly-shape-fixtures.mjs   # privacy guard
```
