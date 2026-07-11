# SENDOSS-98 — Smart Delivery read parity

Date: 2026-07-11
Linear: SENDOSS-98
Branch: `codex/sendoss-97-smartlead-parity-audit`
PR target: `codex/smartlead-api-parity-map`

## Outcome

Extend the existing Smartlead parity PR with support-gated, read-only Smart Delivery evidence. Preserve the Standard API ingest when Smart Delivery access is absent, and do not add any Smartlead mutation path.

## Product boundary

- Read/read-equivalent only. Documented list/report endpoints that use POST with an empty body are reads.
- Never call create manual/automated test, stop test, bulk delete, or folder create/delete endpoints.
- Do not ingest raw test email bodies or raw reply headers. They are unnecessary for placement analysis and broaden the privacy surface.
- Keep Standard API account warmup/reputation health separate from Smart Delivery inbox-placement evidence.
- Smart Delivery uses a separate support-gated host. A valid Standard API key can therefore yield `inbox_placement=unsupported` without making core refresh fail.

## Official source receipts

All URLs were checked against Smartlead's current official API reference on 2026-07-11. No credentials or customer data are retained in these receipts.

| Surface | Official source | Ingestion decision |
| --- | --- | --- |
| List tests | https://api.smartlead.ai/api-reference/smart-delivery/list-tests | Ingest; POST is read-equivalent |
| Test detail | https://api.smartlead.ai/api-reference/smart-delivery/test-details | Ingest definition metadata |
| Schedule history | https://api.smartlead.ai/api-reference/smart-delivery/schedule-history | Ingest exact run counts |
| Provider report | https://api.smartlead.ai/api-reference/smart-delivery/provider-report | Ingest provider aggregate rates/counts |
| Geo report | https://api.smartlead.ai/api-reference/smart-delivery/geo-report | Ingest region aggregate rates/counts |
| Sender report | https://api.smartlead.ai/api-reference/smart-delivery/sender-report | Ingest sender aggregate rates/reputation |
| Sender list | https://api.smartlead.ai/api-reference/smart-delivery/sender-list | Ingest sender membership metadata |
| SPF details | https://api.smartlead.ai/api-reference/smart-delivery/spf-details | Ingest exact per-seed checks |
| DKIM details | https://api.smartlead.ai/api-reference/smart-delivery/dkim-details | Ingest exact per-seed checks |
| rDNS details | https://api.smartlead.ai/api-reference/smart-delivery/rdns-report | Ingest exact per-seed checks |
| IP blacklist | https://api.smartlead.ai/api-reference/smart-delivery/blacklists | Ingest blacklist evidence |
| Domain blacklist | https://api.smartlead.ai/api-reference/smart-delivery/domain-blacklist | Ingest exact per-seed checks |
| IP analytics | https://api.smartlead.ai/api-reference/smart-delivery/ip-details | Ingest diagnostic rows |
| Spam filters | https://api.smartlead.ai/api-reference/smart-delivery/spam-filter-report | Ingest diagnostic rows |
| Mailbox summary | https://api.smartlead.ai/api-reference/smart-delivery/mailbox-summary | Ingest workspace sender/provider placement counts |
| Test email content | https://api.smartlead.ai/api-reference/smart-delivery/test-email-content | Exclude unnecessary message content |
| Reply headers | https://api.smartlead.ai/api-reference/smart-delivery/reply-headers | Exclude unnecessary raw header content |
| Mutation endpoints | Official Smart Delivery create/stop/delete/folder references | Exclude entirely |

## Implementation

1. Reuse the hardened Smartlead transport with a separate `https://smartdelivery.smartlead.ai/api/v1` base URL. Keep query-key redaction, timeout, bounded retry, Retry-After behavior, concurrency, and rate limiting.
2. Add only read/read-equivalent client methods. Treat 401/403/404 from the initial list probe as support-gated unavailability after Standard API access succeeds.
3. Fetch the entire bounded Smart Delivery snapshot before opening the DuckDB transaction. A transient or per-test fetch failure aborts refresh and preserves the prior snapshot.
4. Normalize definitions and heterogeneous reports into provider-specific local tables with exact numeric fields plus allowlisted raw JSON. Do not fabricate per-email placement outcomes from aggregate reports.
5. On successful full refresh, delete stale Smart Delivery rows and insert the new snapshot in the same transaction as the core snapshot. Scoped campaign refresh leaves Smart Delivery rows and capability state untouched.
6. Expose provider-aware semantic views/query recipes for test/run placement, sender health, and authentication/blacklist evidence. Update workspace counts and capability language.
7. Update contracts, setup/troubleshooting, synthetic fixtures, host bundles, and source receipts.

## Validation

- Client regressions: separate host, empty-body read POST, redaction, retry/timeout, support-gated status.
- Ingest regressions: accessible snapshot, unsupported access, transient preservation, stale deletion, scoped-refresh preservation, no mutation routes.
- View/MCP regressions: exact aggregate semantics, sender health, auth/blacklist evidence, empty-data caveat.
- `npm run test:plugin:smoke`
- `npm run validate:plugin`
- `npm run lint:plugin`
- `npm run test:plugin`
- relevant Codex/Claude CLI/Desktop bundle validation
- `git diff --check`
- independent implementation review and resolution before PR update

## Release hold

Push the release-ready PR update and keep `ai:autofix-enabled`. Do not merge or release until the coordinator confirms the parity-base merge sequence.
